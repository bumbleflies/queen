import { describe, it, expect, beforeEach, beforeAll, vi, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { trialBalance } from '../../lib/accounting/balances';
import { defaultBookingText } from '../../lib/accounting/bankBooking';
import { adminCaller, initLedgerModels, resetLedgerDb, sentInvoice, skipIfNoDb } from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({ enqueueFileInvoice: vi.fn(async () => {}) }));
const listReceiptFiles = vi.hoisted(() => vi.fn(async (): Promise<{ id: string; name: string; link: string }[]> => []));
vi.mock('../../services/receiptsDrive', () => ({ listReceiptFiles }));
vi.mock('../../services/driveForUser', () => ({ driveForUser: vi.fn(async () => ({})) }));

let seq = 0;
async function tx(over: Record<string, unknown> = {}) {
  seq += 1;
  return BankTransaction.create({
    fireflyJournalId: `${900 + seq}:0`,
    date: new Date(2026, 0, 30),
    amountCents: 11900,
    description: 'Lizenz Januar',
    counterpartyName: 'Software Ltd',
    direction: 'out',
    ...over,
  });
}

beforeAll(async () => {
  await initLedgerModels();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  vi.clearAllMocks();
  await resetLedgerDb();
  await Supplier.deleteMany({});
  await Counter.deleteMany({ _id: 'supplier' });
});

describe('defaultBookingText', () => {
  it('prefers the supplier name and trims to 200 chars', () => {
    expect(defaultBookingText({ counterpartyName: 'X', description: 'Rechnung 1' }, 'Lieferant')).toBe('Lieferant · Rechnung 1');
    expect(defaultBookingText({ description: 'a'.repeat(300) })).toHaveLength(200);
  });
});

describe('bookings', () => {
  it('book posts Aufwand + Vorsteuer an Bank and removes the tx from the inbox', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(t._id)]);
    const res = await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0.19, mode: 'normal' });
    expect(res.entryNumber).toMatch(/^2026-\d{5}$/);
    expect(await caller.bookings.inbox({ year: 2026 })).toEqual([]);
    const booked = await caller.bookings.booked({ year: 2026 });
    expect(booked).toHaveLength(1);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(-11900);
    expect(tb.rows.find((r) => r.account === '1406')?.balanceCents).toBe(1900);
  });

  it('book reverseCharge posts 1407/3837 and keeps 1800 at gross', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx({ amountCents: 16842 });
    await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0.19, mode: 'reverseCharge' });
    const tb = trialBalance(await JournalEntry.find({}));
    const bal = (a: string) => tb.rows.find((r) => r.account === a)?.balanceCents;
    expect(bal('1800')).toBe(-16842);
    expect(bal('1407')).toBe(3200);
    expect(bal('3837')).toBe(-3200);
    expect(bal('6837')).toBe(16842);
  });

  it('reverseCharge on an incoming tx is a BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    const t = await tx({ direction: 'in' });
    await expect(
      adminCaller().bookings.book({ bankTxId: String(t._id), account: '8400', vatRate: 0.19, mode: 'reverseCharge' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('refuses double booking, booking an invoice-matched tx, and assigning a booked tx to an invoice', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx({ direction: 'in', description: 'Erstattung' });
    await caller.bookings.book({ bankTxId: String(t._id), account: '4930', vatRate: 0, mode: 'normal' });
    await expect(
      caller.bookings.book({ bankTxId: String(t._id), account: '4930', vatRate: 0, mode: 'normal' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const invoice = await sentInvoice(caller);
    await expect(
      caller.bank.assign({ bankTxId: String(t._id), invoiceId: String(invoice._id) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const paid = await tx({ direction: 'in', amountCents: invoice.totals.grossCents });
    await caller.bank.assign({ bankTxId: String(paid._id), invoiceId: String(invoice._id) });
    await expect(
      caller.bookings.book({ bankTxId: String(paid._id), account: '4930', vatRate: 0, mode: 'normal' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('inbox includes deposits ignored in Bankabgleich and excludes covered invoice payments', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const ignored = await tx({ direction: 'in', ignored: true, description: 'Steuererstattung' });
    const ids = (await caller.bookings.inbox({ year: 2026 })).map((r) => r.id);
    expect(ids).toContain(String(ignored._id));
  });

  it('rememberRule creates a supplier that suggests the same booking next time', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const first = await tx({ counterpartyIban: 'IE29 AIBK 9311 5212 3456 78' });
    await caller.bookings.book({ bankTxId: String(first._id), account: '6837', vatRate: 0, mode: 'normal', rememberRule: true });
    const supplier = await Supplier.findOne({});
    expect(supplier).toMatchObject({ kreditorNumber: 70000, name: 'Software Ltd', defaultAccount: '6837', defaultVatRate: 0 });
    expect(supplier?.ibans).toEqual(['IE29AIBK93115212345678']);
    await tx({ counterpartyIban: 'IE29AIBK93115212345678', date: new Date(2026, 1, 28) });
    const [row] = await caller.bookings.inbox({ year: 2026 });
    expect(row.suggestion).toMatchObject({ kreditorNumber: 70000, account: '6837', matchedBy: 'iban' });
  });

  it('bookBulk books items with a suggestion and reports the others without stopping', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Bank', purposePatterns: ['Abrechnung vom'], defaultAccount: '6855', defaultVatRate: 0 });
    const a = await tx({ description: 'Abrechnung vom 29.01.2026', amountCents: 824 });
    const b = await tx({ description: 'Abrechnung vom 27.02.2026', amountCents: 824, date: new Date(2026, 1, 28) });
    const c = await tx({ description: 'Unbekannt' });
    const results = await caller.bookings.bookBulk({ bankTxIds: [String(a._id), String(c._id), String(b._id)] });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toMatch(/Kein Vorschlag/);
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(c._id)]);
  });

  describe('history suggestions', () => {
    const IBAN = 'DE02120300000000202051';

    it('stream suggests from history when no rule matches', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      const row = (await caller.bookings.stream({ year: 2026 })).find((r) => r.id === String(b._id));
      expect(row).toMatchObject({ state: 'open', suggestion: { matchedBy: 'history', account: '6837', vatRate: 0.19, mode: 'normal' } });
    });

    it('skips reversed entries', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      await caller.bookings.unbook({ bankTxId: String(a._id), reason: 'falsch' });
      const inbox = await caller.bookings.inbox({ year: 2026 });
      expect(inbox.find((r) => r.id === String(b._id))?.suggestion).toBeNull();
    });

    it('rules win over history', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6640', vatRate: 0.19, mode: 'normal' });
      await caller.suppliers.create({ name: 'Hoster', ibans: [IBAN], defaultAccount: '6837', defaultVatRate: 0.19 });
      const inbox = await caller.bookings.inbox({ year: 2026 });
      expect(inbox.find((r) => r.id === String(b._id))?.suggestion).toMatchObject({ matchedBy: 'iban', account: '6837' });
    });

    it('bookBulk books history suggestions without supplierId', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      const [res] = await caller.bookings.bookBulk({ bankTxIds: [String(b._id)] });
      expect(res.ok).toBe(true);
      expect((await BankTransaction.findById(b._id))?.supplierId).toBeUndefined();
      const booked = (await caller.bookings.booked({ year: 2026 })).find((r) => r.id === String(b._id));
      expect(booked?.lines.map((x) => x.account).sort()).toEqual(['1406', '1800', '6837']);
    });
  });

  it('bookBulk attaches a clearly matching receipt and books without one otherwise', async (ctx) => {
    skipIfNoDb(ctx);
    process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
    listReceiptFiles.mockResolvedValue([
      { id: 'h10', name: 'Hoster_2026-10-16_100000123456.pdf', link: 'https://drive/h10' },
      { id: 'h09', name: 'Hoster_2026-09-16_100000654321.pdf', link: 'https://drive/h09' },
    ]);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Hoster', namePatterns: ['Hoster'], defaultAccount: '6837', defaultVatRate: 0.19 });
    const a = await tx({ counterpartyName: 'Hoster GmbH', description: 'Invoice No. 100000123456', date: new Date(2026, 9, 21), amountCents: 1213 });
    const b = await tx({ counterpartyName: 'Hoster GmbH', description: 'Invoice No. 100000999999', date: new Date(2026, 10, 21), amountCents: 1213 });
    const results = await caller.bookings.bookBulk({ bankTxIds: [String(a._id), String(b._id)] });
    expect(results.map((r) => r.error ?? 'ok')).toEqual(['ok', 'ok']);
    expect(results.map((r) => r.receipt)).toEqual([true, false]);
    expect((await BankTransaction.findById(a._id))?.receipt).toMatchObject({ driveFileId: 'h10', fileName: 'Hoster_2026-10-16_100000123456.pdf' });
    expect((await BankTransaction.findById(b._id))?.receipt?.driveFileId).toBeUndefined();
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
  });

  it('bookBulk still books when Drive is unavailable', async (ctx) => {
    skipIfNoDb(ctx);
    process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
    listReceiptFiles.mockRejectedValue(new Error('no token'));
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Hoster', namePatterns: ['Hoster'], defaultAccount: '6837', defaultVatRate: 0.19 });
    const a = await tx({ counterpartyName: 'Hoster GmbH', description: 'Invoice No. 100000123456' });
    expect((await caller.bookings.bookBulk({ bankTxIds: [String(a._id)] }))[0].ok).toBe(true);
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
  });

  it('receiptMatches returns the clear receipt per open row and degrades without Drive', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
    listReceiptFiles.mockResolvedValue([
      { id: 'h10', name: 'Hoster_2026-10-16_100000123456.pdf', link: 'https://drive/h10' },
      { id: 'h09', name: 'Hoster_2026-09-16_100000654321.pdf', link: 'https://drive/h09' },
    ]);
    const a = await tx({ counterpartyName: 'Hoster GmbH', description: 'Invoice No. 100000123456', date: new Date(2026, 9, 21), amountCents: 1213 });
    const vague = await tx({ counterpartyName: 'Jemand', description: 'Irgendwas', date: new Date(2026, 9, 21) });
    const ignored = await tx({ description: 'Invoice No. 100000654321', ignored: true });
    const booked = await tx({ description: 'Invoice No. 100000654321' });
    await caller.bookings.book({ bankTxId: String(booked._id), account: '6837', vatRate: 0.19, mode: 'normal' });

    const res = await caller.bookings.receiptMatches({ year: 2026 });
    expect(res.available).toBe(true);
    expect(res.matches).toEqual({ [String(a._id)]: { id: 'h10', name: 'Hoster_2026-10-16_100000123456.pdf', link: 'https://drive/h10' } });
    expect(res.matches[String(vague._id)]).toBeUndefined();
    expect(res.matches[String(ignored._id)]).toBeUndefined();
    expect(listReceiptFiles).toHaveBeenCalledTimes(1);

    listReceiptFiles.mockRejectedValue(new Error('no token'));
    expect(await caller.bookings.receiptMatches({ year: 2026 })).toEqual({ available: false, matches: {} });
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    expect(await caller.bookings.receiptMatches({ year: 2026 })).toEqual({ available: false, matches: {} });
  });

  it('unbook reverses the entry and returns the tx to the inbox; setReceipt stores metadata', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    await caller.bookings.book({
      bankTxId: String(t._id),
      account: '6837',
      vatRate: 0.19,
      mode: 'normal',
      receipt: { driveFileId: 'f1', fileName: '20260130 - Lizenz.pdf', link: 'https://drive/f1' },
    });
    expect((await caller.bookings.stats({ year: 2026 })).missingReceipts).toBe(0);
    await caller.bookings.setReceipt({ bankTxId: String(t._id), receipt: null, receiptMissingReason: 'Eigenbeleg folgt' });
    expect((await BankTransaction.findById(t._id))?.receiptMissingReason).toBe('Eigenbeleg folgt');
    await caller.bookings.unbook({ bankTxId: String(t._id), reason: 'falsches Konto' });
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(t._id)]);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.every((r) => r.balanceCents === 0)).toBe(true);
  });

  it('stats counts open, booked and missing receipts', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    await tx();
    await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0, mode: 'normal' });
    expect(await caller.bookings.stats({ year: 2026 })).toEqual({ open: 1, booked: 1, missingReceipts: 1 });
  });

  it('stream returns every tx of the year with its state and joined details', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Bank', purposePatterns: ['Abrechnung vom'], defaultAccount: '6855', defaultVatRate: 0 });
    const expense = await tx({ description: 'Abrechnung vom 29.01.2026', amountCents: 824 });
    const ignored = await tx({ direction: 'in', ignored: true, description: 'Steuererstattung' });
    const invoice = await sentInvoice(caller);
    const payment = await tx({ direction: 'in', amountCents: invoice.totals.grossCents, description: 'Lizenz' });
    await caller.bank.assign({ bankTxId: String(payment._id), invoiceId: String(invoice._id) });
    await caller.bookings.book({ bankTxId: String(expense._id), account: '6837', vatRate: 0, mode: 'normal' });

    const rows = (await caller.bookings.stream({ year: 2026 })) as unknown as {
      id: string;
      state: string;
      ignored: boolean;
      direction: string;
      suggestion: unknown;
      entry?: { entryNumber: string; lines: { account: string; debitCents: number; creditCents: number }[] };
      invoice?: { invoiceNumber: string; status: string };
    }[];
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(rows).toHaveLength(3);

    const expenseRow = byId.get(String(expense._id))!;
    expect(expenseRow.state).toBe('booked');
    expect(expenseRow.entry?.entryNumber).toMatch(/^2026-\d{5}$/);
    expect(expenseRow.entry?.lines).toEqual([{ account: '1800', debitCents: 0, creditCents: 824 }, { account: '6837', debitCents: 824, creditCents: 0 }]);

    const paymentRow = byId.get(String(payment._id))!;
    expect(paymentRow.state).toBe('invoice');
    expect(paymentRow.invoice).toMatchObject({ invoiceNumber: invoice.invoiceNumber, status: 'paid' });

    const ignoredRow = byId.get(String(ignored._id))!;
    expect(ignoredRow).toMatchObject({ state: 'open', ignored: true });

    // 2025 tx must not leak into the 2026 stream
    await tx({ date: new Date(2025, 5, 1) });
    expect((await caller.bookings.stream({ year: 2026 })).length).toBe(3);
  });

  it('balanceCheck reports the ledger 1800 balance and an error when Firefly is not configured', async (ctx) => {
    skipIfNoDb(ctx);
    vi.stubEnv('FIREFLY_URL', '');
    vi.stubEnv('FIREFLY_PAT', '');
    vi.stubEnv('FIREFLY_GLS_ACCOUNT_ID', '');
    const caller = adminCaller();
    const t = await tx();
    await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0, mode: 'normal' });
    const res = await caller.bookings.balanceCheck({ year: 2026 });
    expect(res.ledgerCents).toBe(-11900);
    expect(res.bankCents).toBeNull();
    expect(res.error).toMatch(/Firefly/);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });
});
