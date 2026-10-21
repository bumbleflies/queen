import { describe, it, expect, beforeEach, beforeAll, afterEach, vi, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Invoice } from '../../models/Invoice';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { FiscalYear } from '../../models/FiscalYear';
import { Supplier } from '../../models/Supplier';
import { runReconcile } from '../../cron/reconcile';
import { openTransactions } from '../../lib/accounting/bankCoverage';
import {
  reconcileBankTransaction,
  reconcilePendingTransactions,
  reversePayment,
} from '../../lib/reconcile';
import { initLedgerModels, resetLedgerDb } from './helpers/ledgerFixtures';

const listReceiptFiles = vi.hoisted(() => vi.fn(async (): Promise<{ id: string; name: string; link: string }[]> => []));
vi.mock('../../services/receiptsDrive', () => ({ listReceiptFiles }));
vi.mock('../../services/driveForUser', () => ({ driveForUser: vi.fn(async () => ({})), driveForCron: vi.fn(async () => ({})) }));
const ask = vi.hoisted(() => vi.fn(async (_prompt: string): Promise<{ text: string; model: { providerID: string; id: string } }> => ({ text: '', model: { providerID: 'free', id: 'm1' } })));
const opencode = vi.hoisted(() => ({ enabled: false }));
vi.mock('../../services/OpencodeClient', () => ({ opencodeFromEnv: () => (opencode.enabled ? { ask } : null) }));
const receiptText = vi.hoisted(() => vi.fn(async (): Promise<string> => 'Laden KG Rechnung 11,90 EUR'));
vi.mock('../../services/receiptText', () => ({ receiptText }));

function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}

function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  if (!dbAvailable()) return;
  await Invoice.init();
  await BankTransaction.init();
  await initLedgerModels();
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Invoice.deleteMany({});
  await BankTransaction.deleteMany({});
  await Supplier.deleteMany({});
  await resetLedgerDb(); // seeds accounts for the ledger hooks
  listReceiptFiles.mockReset();
  listReceiptFiles.mockResolvedValue([]);
});

const clientId = new mongoose.Types.ObjectId();

async function makeInvoice(overrides: Record<string, unknown> = {}) {
  return Invoice.create({
    invoiceNumber: '20260829-01',
    legacy: false,
    kind: 'invoice',
    clientId,
    customerNumber: 10009,
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    title: 'Beratung',
    servicePeriod: '08.2026',
    paymentTermDays: 30,
    status: 'sent',
    totals: { netCents: 8403, vatCents: 1597, grossCents: 10000 },
    payments: [],
    reconcileState: 'unmatched',
    footerNotes: [],
    ...overrides,
  });
}

async function makeTx(overrides: Record<string, unknown> = {}) {
  return BankTransaction.create({
    fireflyJournalId: '101:0',
    date: new Date('2026-08-30T00:00:00Z'),
    amountCents: 10000,
    currency: 'EUR',
    description: 'Verwendungszweck: 10009-20260829-01',
    ignored: false,
    ...overrides,
  });
}

describe('reconcile (DB)', () => {
  it('never matches a withdrawal even with a valid Verwendungszweck', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx({ direction: 'out' });

    await reconcilePendingTransactions();
    expect((await reconcileBankTransaction(tx)).outcome).toBe('unmatched');

    const after = await BankTransaction.findById(tx._id);
    expect(after!.matchedInvoiceId).toBeFalsy();
    expect((await Invoice.findById(invoice._id))!.status).toBe('sent');
  });

  it('exact payment marks the invoice paid and links the transaction', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('paid');

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('matched');
    expect(updated!.paidAt).toEqual(tx.date);
    expect(updated!.payments).toHaveLength(1);

    const linked = await BankTransaction.findById(tx._id);
    expect(linked!.matchedInvoiceId!.toString()).toBe(invoice._id.toString());
    expect(linked!.matchMethod).toBe('reference');
  });

  it('two partial payments reach paid on the second run', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    await makeTx({ fireflyJournalId: '101:0', amountCents: 4000 });

    await reconcilePendingTransactions();
    const afterFirst = await Invoice.findById(invoice._id);
    expect(afterFirst!.status).toBe('sent');
    expect(afterFirst!.reconcileState).toBe('partial');
    expect(afterFirst!.payments).toHaveLength(1);

    await makeTx({ fireflyJournalId: '102:0', amountCents: 6000 });
    await reconcilePendingTransactions();
    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('matched');
    expect(updated!.payments).toHaveLength(2);
  });

  it('an overpayment is flagged and the invoice stays paid', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx({ amountCents: 12000 });

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('overpaid');

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('overpaid');
  });

  it('a wrong customer number is left for the manual queue', async (ctx) => {
    skipIfNoDb(ctx);
    await makeInvoice();
    const tx = await makeTx({ description: 'Verwendungszweck: 99999-20260829-01' });

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('unmatched');
    expect((await BankTransaction.findById(tx._id))!.matchedInvoiceId ?? null).toBeNull();
  });

  it('re-running reconcile is a no-op for an already matched transaction', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();
    await reconcileBankTransaction(tx);

    const counts = await reconcilePendingTransactions();
    expect(counts).toEqual({ matched: 0, partial: 0, unmatched: 0 });
    expect((await Invoice.findById(invoice._id))!.payments).toHaveLength(1);
  });

  it('bank.unassign reverses the payment, status and reconcileState', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();
    await reconcileBankTransaction(tx);

    const result = await adminCaller().bank.unassign({ bankTxId: tx._id.toString() });
    expect(result.matchedInvoiceId ?? null).toBeNull();

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.payments).toHaveLength(0);
    expect(updated!.status).toBe('sent');
    expect(updated!.paidAt ?? null).toBeNull();
    expect(updated!.reconcileState).toBe('unmatched');
  });

  it('reversePayment keeps a partial state when other payments remain', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const a = await makeTx({ fireflyJournalId: '101:0', amountCents: 4000 });
    const b = await makeTx({ fireflyJournalId: '102:0', amountCents: 3000 });
    await reconcileBankTransaction(a);
    await reconcileBankTransaction(b);

    await reversePayment(invoice._id, '101:0');
    const updated = await Invoice.findById(invoice._id);
    expect(updated!.payments).toHaveLength(1);
    expect(updated!.reconcileState).toBe('partial');
    expect(updated!.status).toBe('sent');
  });
});

describe('auto-booking in the daily reconcile (DB)', () => {
  const IBAN = 'DE02120300000000202051';
  const NOW = new Date(2026, 9, 22, 7, 30);
  let seq = 0;

  async function outTx(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return BankTransaction.create({
      fireflyJournalId: `${700 + seq}:0`,
      date: new Date(2026, 9, 16),
      amountCents: 1190,
      currency: 'EUR',
      direction: 'out',
      description: `Invoice No. 1000${seq}`,
      counterpartyName: 'Hoster GmbH',
      counterpartyIban: IBAN,
      ignored: false,
      ...overrides,
    });
  }

  async function flaggedRule(overrides: Record<string, unknown> = {}) {
    return Supplier.create({
      kreditorNumber: 70000,
      name: 'Hoster',
      ibans: [IBAN],
      namePatterns: ['Hoster'],
      defaultAccount: '6837',
      defaultVatRate: 0.19,
      defaultMode: 'normal',
      autoBook: true,
      ...overrides,
    });
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const bankEntries = () => JournalEntry.find({ 'source.kind': 'bank', active: true });

  it('auto-books flagged IBAN rules and records the count', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule();
    await outTx();
    await outTx();
    const byName = await outTx({ counterpartyIban: null });

    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.error ?? null).toBeNull();
    expect(run.autoBooked).toBe(2);
    expect(run.autoBookFailed).toBe(0);
    const entries = await bankEntries();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.createdBy)).toEqual(['auto:reconcile', 'auto:reconcile']);
    expect((await openTransactions(2026)).map((t) => String(t._id))).toEqual([String(byName._id)]);
    const stream = await adminCaller().bookings.stream({ year: 2026 });
    expect(stream.filter((r) => r.state === 'booked').map((r) => r.state === 'booked' && r.entry.auto)).toEqual([true, true]);
  });

  it('second run books nothing new', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule();
    await outTx();
    await outTx();
    await runReconcile({ skipSync: true, now: NOW });
    const again = await runReconcile({ skipSync: true, now: NOW });
    expect(again.autoBooked).toBe(0);
    expect(await bankEntries()).toHaveLength(2);
  });

  it('never re-books a transaction whose booking was reversed', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule();
    const t = await outTx();
    expect((await runReconcile({ skipSync: true, now: NOW })).autoBooked).toBe(1);
    await adminCaller().bookings.unbook({ bankTxId: String(t._id), reason: 'falsch' });
    const again = await runReconcile({ skipSync: true, now: NOW });
    expect(again.autoBooked).toBe(0);
    expect(again.autoBookFailed).toBe(0);
    expect((await openTransactions(2026)).map((x) => String(x._id))).toEqual([String(t._id)]);
  });

  it('never books incoming transactions', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule();
    const incoming = await outTx({ direction: 'in' });
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.autoBooked).toBe(0);
    expect((await openTransactions(2026)).map((x) => String(x._id))).toEqual([String(incoming._id)]);
  });

  it('leaves rules without the flag alone', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule({ autoBook: false });
    await outTx();
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.autoBooked).toBe(0);
    expect(await bankEntries()).toHaveLength(0);
  });

  it('skips closed fiscal years', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'closed' });
    await flaggedRule();
    const old = await outTx({ date: new Date(2025, 11, 30) });
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.autoBooked).toBe(0);
    expect(run.autoBookFailed).toBe(0);
    expect((await openTransactions(2025)).map((t) => String(t._id))).toEqual([String(old._id)]);
  });

  it('books open transactions of earlier years that are not closed', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'open' });
    await flaggedRule();
    await outTx({ date: new Date(2025, 11, 30) });
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.autoBooked).toBe(1);
  });

  it('attaches a clearly matching receipt', async (ctx) => {
    skipIfNoDb(ctx);
    vi.stubEnv('QUEEN_RECEIPTS_FOLDER_ID', 'root');
    listReceiptFiles.mockResolvedValue([{ id: 'h1', name: 'Hoster_2026-10-16_100000123456.pdf', link: 'https://drive/h1' }]);
    await flaggedRule();
    const t = await outTx({ description: 'Invoice No. 100000123456' });
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.autoBooked).toBe(1);
    expect(run.autoBookWarning ?? null).toBeNull();
    expect((await BankTransaction.findById(t._id))?.receipt?.driveFileId).toBe('h1');
  });

  it('Drive failure books without receipt and warns', async (ctx) => {
    skipIfNoDb(ctx);
    vi.stubEnv('QUEEN_RECEIPTS_FOLDER_ID', 'root');
    listReceiptFiles.mockRejectedValue(new Error('invalid_grant'));
    await flaggedRule();
    const t = await outTx();
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.error ?? null).toBeNull();
    expect(run.autoBooked).toBe(1);
    expect(run.autoBookWarning).toMatch(/invalid_grant/);
    expect((await BankTransaction.findById(t._id))?.receipt?.driveFileId).toBeUndefined();
  });

  it('counts per-row failures without failing the run', async (ctx) => {
    skipIfNoDb(ctx);
    await flaggedRule({ defaultAccount: '6837' });
    await outTx();
    // a rule pointing at an account archived after it was saved makes the posting fail
    await mongoose.connection.collection('accounts').updateOne({ number: '6837' }, { $set: { archived: true } });
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.error ?? null).toBeNull();
    expect(run.autoBooked).toBe(0);
    expect(run.autoBookFailed).toBe(1);
  });
});

describe('receipt reading in the daily reconcile (DB)', () => {
  const NOW = new Date(2026, 9, 22, 7, 30);

  beforeEach(() => {
    receiptText.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    opencode.enabled = false;
    ask.mockReset();
  });

  async function openWithReceipt(n: number, overrides: Record<string, unknown> = {}) {
    const number = String(100000000 + n);
    await BankTransaction.create({
      fireflyJournalId: `${800 + n}:0`,
      date: new Date(2026, 9, 16),
      amountCents: 1190,
      currency: 'EUR',
      direction: 'out',
      description: `Rechnung ${number}`,
      counterpartyName: 'Laden KG',
      ignored: false,
      ...overrides,
    });
    return { id: `f${n}`, name: `Laden_2026-10-16_${number}.pdf`, link: `https://drive/f${n}` };
  }

  it('reconcile reads at most 10 receipts and never books them', async (ctx) => {
    skipIfNoDb(ctx);
    vi.stubEnv('QUEEN_RECEIPTS_FOLDER_ID', 'root');
    opencode.enabled = true;
    ask.mockResolvedValue({
      text: JSON.stringify({ vendor: 'Laden KG', totalCents: 1190, lines: [{ vatRate: 0.19, grossCents: 1190, account: '6837' }] }),
      model: { providerID: 'free', id: 'm1' },
    });
    const files = [];
    for (let n = 1; n <= 12; n++) files.push(await openWithReceipt(n));
    // a rule suggestion means no reading is needed
    await Supplier.create({ kreditorNumber: 70001, name: 'Regel', namePatterns: ['Regel AG'], defaultAccount: '6820', defaultVatRate: 0.19 });
    files.push(await openWithReceipt(13, { counterpartyName: 'Regel AG' }));
    listReceiptFiles.mockResolvedValue(files);

    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.error ?? null).toBeNull();
    expect(run.receiptsRead).toBe(10);
    expect(ask).toHaveBeenCalledTimes(10);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'bank' })).toBe(0);
    expect(await BankTransaction.countDocuments({ 'receiptReading.status': 'ok' })).toBe(10);
    expect((await BankTransaction.findOne({ counterpartyName: 'Regel AG' }))?.receiptReading).toBeUndefined();

    const second = await runReconcile({ skipSync: true, now: NOW });
    expect(second.receiptsRead).toBe(2);
    expect(ask).toHaveBeenCalledTimes(12);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'bank' })).toBe(0);
    const stream = await adminCaller().bookings.stream({ year: 2026 });
    expect(stream.filter((r) => r.state === 'open' && r.suggestion?.matchedBy === 'receipt')).toHaveLength(12);
  });

  it('reading trouble never fails the run, and without a key nothing is read', async (ctx) => {
    skipIfNoDb(ctx);
    vi.stubEnv('QUEEN_RECEIPTS_FOLDER_ID', 'root');
    listReceiptFiles.mockResolvedValue([await openWithReceipt(1)]);
    const off = await runReconcile({ skipSync: true, now: NOW });
    expect(off.receiptsRead).toBe(0);
    expect(receiptText).not.toHaveBeenCalled();

    opencode.enabled = true;
    ask.mockRejectedValue(new Error('all models failed'));
    const run = await runReconcile({ skipSync: true, now: NOW });
    expect(run.error ?? null).toBeNull();
    expect(run.receiptsRead).toBe(1);
    expect((await BankTransaction.findOne({}))?.receiptReading?.status).toBe('failed');

    listReceiptFiles.mockRejectedValue(new Error('invalid_grant'));
    expect((await runReconcile({ skipSync: true, now: NOW })).error ?? null).toBeNull();
  });
});
