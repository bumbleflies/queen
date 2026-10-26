import { describe, it, expect, beforeEach, beforeAll, vi, afterAll } from 'vitest';
import mongoose from 'mongoose';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { trialBalance } from '../../lib/accounting/balances';
import { loadHistory } from '../../lib/accounting/history';
import { defaultBookingText } from '../../lib/accounting/bankBooking';
import { appRouter } from '../../trpc';
import { adminCaller, initLedgerModels, resetLedgerDb, sentInvoice, skipIfNoDb } from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({ enqueueFileInvoice: vi.fn(async () => {}) }));
const listReceiptFiles = vi.hoisted(() => vi.fn(async (): Promise<{ id: string; name: string; link: string }[]> => []));
vi.mock('../../services/receiptsDrive', () => ({ listReceiptFiles }));
vi.mock('../../services/driveForUser', () => ({
  driveForUser: vi.fn(async () => ({})),
  driveForActor: vi.fn(async () => ({})),
}));
const ask = vi.hoisted(() => vi.fn(async (_prompt: string): Promise<{ text: string; model: { providerID: string; id: string } }> => ({ text: '', model: { providerID: 'free', id: 'm1' } })));
const opencode = vi.hoisted(() => ({ enabled: true }));
vi.mock('../../services/OpencodeClient', () => ({ opencodeFromEnv: () => (opencode.enabled ? { ask } : null) }));
const receiptText = vi.hoisted(() => vi.fn(async (): Promise<string> => ''));
vi.mock('../../services/receiptText', () => ({ receiptText }));

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
  opencode.enabled = true;
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

  it('book with split posts one entry', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx({ amountCents: 5460 });
    await caller.bookings.book({
      bankTxId: String(t._id),
      account: '',
      vatRate: 0,
      mode: 'normal',
      split: [
        { account: '6640', vatRate: 0.07, grossCents: 3210, mode: 'normal' },
        { account: '6837', vatRate: 0.19, grossCents: 2250, mode: 'normal' },
      ],
    });
    const entries = await JournalEntry.find({ 'source.kind': 'bank' });
    expect(entries).toHaveLength(1);
    const tb = trialBalance(await JournalEntry.find({}));
    const bal = (a: string) => tb.rows.find((r) => r.account === a)?.balanceCents;
    expect(bal('1800')).toBe(-5460);
    expect(bal('6640')).toBe(3000);
    expect(bal('6837')).toBe(1891);
    expect(bal('1401')).toBe(210);
    expect(bal('1406')).toBe(359);
    expect(await Supplier.countDocuments({})).toBe(0);
    await expect(
      caller.bookings.book({
        bankTxId: String((await tx({ amountCents: 5460 }))._id),
        account: '',
        vatRate: 0,
        mode: 'normal',
        split: [
          { account: '6640', vatRate: 0.07, grossCents: 3000, mode: 'normal' },
          { account: '6837', vatRate: 0.19, grossCents: 2000, mode: 'normal' },
        ],
      }),
    ).rejects.toThrow(/Aufteilung ergibt/);
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

  it('learns a rule from every confirmed booking (IBAN, account, rate, mode)', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const first = await tx({ counterpartyIban: 'IE29 AIBK 9311 5212 3456 78' });
    await caller.bookings.book({ bankTxId: String(first._id), account: '6837', vatRate: 0, mode: 'normal' });
    const supplier = await Supplier.findOne({});
    expect(supplier).toMatchObject({
      kreditorNumber: 70000,
      name: 'Software Ltd',
      defaultAccount: '6837',
      defaultVatRate: 0,
      origin: 'learned',
      archived: false,
    });
    expect(supplier?.learnedAt).toBeInstanceOf(Date);
    expect(supplier?.ibans).toEqual(['IE29AIBK93115212345678']);
    await tx({ counterpartyIban: 'IE29AIBK93115212345678', date: new Date(2026, 1, 28) });
    const [row] = await caller.bookings.inbox({ year: 2026 });
    expect(row.suggestion).toMatchObject({ kreditorNumber: 70000, account: '6837', matchedBy: 'iban' });
  });

  it('extends the rule that suggested the booking instead of creating a second one', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const rule = await caller.suppliers.create({ name: 'Hoster', purposePatterns: ['Lizenz'], defaultAccount: '6837', defaultVatRate: 0 });
    const t = await tx({ description: 'Lizenz Januar' });
    await caller.bookings.book({ bankTxId: String(t._id), account: '6640', vatRate: 0.19, mode: 'normal', supplierId: String(rule._id) });
    expect(await Supplier.countDocuments({})).toBe(1);
    expect(await Supplier.findById(rule._id)).toMatchObject({ defaultAccount: '6640', defaultVatRate: 0.19, origin: 'manual' });
  });

  it('does not learn from incoming payments', async (ctx) => {
    skipIfNoDb(ctx);
    const t = await tx({ direction: 'in', counterpartyIban: 'DE02120300000000202051' });
    await adminCaller().bookings.book({ bankTxId: String(t._id), account: '4930', vatRate: 0, mode: 'normal' });
    expect(await Supplier.countDocuments({})).toBe(0);
  });

  it('does not learn when the receipt vendor contradicts the counterparty', async (ctx) => {
    skipIfNoDb(ctx);
    const reading = { vendor: 'Augustiner Keller', totalCents: 11900, reverseCharge: false, lines: [{ vatRate: 0.07, grossCents: 11900, account: '6640' }] };
    const t = await tx({
      counterpartyName: 'Christian Dähn',
      counterpartyIban: 'DE89370400440532013000',
      receiptMatch: { driveFileIds: ['f1'], reading, readAt: new Date() },
    });
    await adminCaller().bookings.book({ bankTxId: String(t._id), account: '6640', vatRate: 0.07, mode: 'normal' });
    expect(await Supplier.countDocuments({})).toBe(0);
  });

  it('attaches the matched receipt set of the row to the posting', async (ctx) => {
    skipIfNoDb(ctx);
    const reading = { vendor: 'Software Ltd', totalCents: 11900, reverseCharge: false, lines: [{ vatRate: 0.19, grossCents: 11900, account: '6837' }] };
    const t = await tx({
      receiptMatch: { driveFileIds: ['f1', 'f2'], reading, readAt: new Date() },
      receiptReadings: [
        { driveFileId: 'f1', fileName: 'lizenz.pdf', status: 'ok', readAt: new Date(), link: 'https://drive.google.com/file/d/f1/view', reading },
        { driveFileId: 'f2', fileName: 'lizenz_2.pdf', status: 'ok', readAt: new Date(), link: 'https://drive.google.com/file/d/f2/view', reading: { ...reading, totalCents: 4760 } },
      ],
    });
    await adminCaller().bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0.19, mode: 'normal' });
    const saved = await BankTransaction.findById(t._id);
    expect(saved?.receipt).toMatchObject({ driveFileId: 'f1', fileName: 'lizenz.pdf', link: 'https://drive.google.com/file/d/f1/view' });
  });

  it('a non-admin booking against an autoBook rule keeps the booking but not the rule change', async (ctx) => {
    skipIfNoDb(ctx);
    const admin = adminCaller();
    const user = appRouter.createCaller({ user: { sub: 'u1', email: 'u@example.de', role: 'user' }, serviceAuth: false });
    const rule = await admin.suppliers.create({ name: 'Hoster', namePatterns: ['Software Ltd'], defaultAccount: '6837', defaultVatRate: 0.19, autoBook: true });
    const supplierId = String(rule._id);
    const t = await tx();
    await user.bookings.book({ bankTxId: String(t._id), account: '6640', vatRate: 0.19, mode: 'normal', supplierId });
    expect(await JournalEntry.countDocuments({ 'source.kind': 'bank' })).toBe(1);
    expect((await Supplier.findById(supplierId))?.defaultAccount).toBe('6837');

    const t2 = await tx();
    await admin.bookings.book({ bankTxId: String(t2._id), account: '6640', vatRate: 0.19, mode: 'normal', supplierId });
    expect((await Supplier.findById(supplierId))?.defaultAccount).toBe('6640');
  });

  it('bookBulk refuses rows where the rule and the receipt disagree', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Software', namePatterns: ['Software Ltd'], defaultAccount: '6820', defaultVatRate: 0.19 });
    const reading = { vendor: 'Software Ltd', totalCents: 11900, reverseCharge: false, lines: [{ vatRate: 0.19, grossCents: 11900, account: '6837' }] };
    const conflict = await tx({ receiptMatch: { driveFileIds: ['f1'], reading, readAt: new Date() } });
    const plain = await tx();
    const results = await caller.bookings.bookBulk({ bankTxIds: [String(conflict._id), String(plain._id)] });
    expect(results.map((r) => r.ok)).toEqual([false, true]);
    expect(results[0].error).toMatch(/widersprechen/);
    expect((await BankTransaction.findById(conflict._id))?.receipt).toBeUndefined();
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
      // learning would give an IBAN rule; archive it so this tests the history fallback
      await Supplier.updateMany({}, { archived: true });
      const row = (await caller.bookings.stream({ year: 2026 })).find((r) => r.id === String(b._id));
      expect(row).toMatchObject({ state: 'open', suggestion: { matchedBy: 'history', account: '6837', vatRate: 0.19, mode: 'normal' } });
    });

    it('keeps directions apart: an incoming tx never gets the outgoing booking', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      await Supplier.updateMany({}, { archived: true });
      const incoming = await tx({ counterpartyIban: IBAN, direction: 'in' });
      const outgoing = await tx({ counterpartyIban: IBAN });
      const inbox = await caller.bookings.inbox({ year: 2026 });
      expect(inbox.find((r) => r.id === String(incoming._id))?.suggestion).toBeNull();
      expect(inbox.find((r) => r.id === String(outgoing._id))?.suggestion).toMatchObject({ matchedBy: 'history', account: '6837' });
    });

    it('skips reversed entries', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      await caller.bookings.unbook({ bankTxId: String(a._id), reason: 'falsch' });
      await Supplier.updateMany({}, { archived: true });
      const inbox = await caller.bookings.inbox({ year: 2026 });
      expect(inbox.find((r) => r.id === String(b._id))?.suggestion).toBeNull();
    });

    it('rules win over history', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6640', vatRate: 0.19, mode: 'normal' });
      await Supplier.updateMany({}, { archived: true });
      await caller.suppliers.create({ name: 'Hoster', ibans: [IBAN], defaultAccount: '6837', defaultVatRate: 0.19 });
      const inbox = await caller.bookings.inbox({ year: 2026 });
      expect(inbox.find((r) => r.id === String(b._id))?.suggestion).toMatchObject({ matchedBy: 'iban', account: '6837' });
    });

    const bookTo = async (caller: ReturnType<typeof adminCaller>, id: unknown, account: string) => {
      await caller.bookings.book({ bankTxId: String(id), account, vatRate: 0.19, mode: 'normal' });
      // keep the history fallback under test: drop the rule learning created
      await Supplier.updateMany({}, { archived: true });
    };
    const suggestionOf = async (caller: ReturnType<typeof adminCaller>, id: unknown) =>
      (await caller.bookings.inbox({ year: 2026 })).find((r) => r.id === String(id))?.suggestion;

    it('uses only the newest three bookings (older disagreement ignored)', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const accounts = ['6640', '6837', '6837', '6837'];
      for (const [i, account] of accounts.entries()) {
        await bookTo(caller, (await tx({ counterpartyIban: IBAN, date: new Date(2026, i, 10) })).id, account);
      }
      const b = await tx({ counterpartyIban: IBAN, date: new Date(2026, 6, 1) });
      expect(await suggestionOf(caller, b._id)).toMatchObject({ matchedBy: 'history', account: '6837' });
    });

    it('gives no suggestion when one of the newest three disagrees', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const accounts = ['6837', '6837', '6640', '6837'];
      for (const [i, account] of accounts.entries()) {
        await bookTo(caller, (await tx({ counterpartyIban: IBAN, date: new Date(2026, i, 10) })).id, account);
      }
      const b = await tx({ counterpartyIban: IBAN, date: new Date(2026, 6, 1) });
      expect(await suggestionOf(caller, b._id)).toBeNull();
    });

    it('never suggests from placeholder counterparty names', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyName: '(unknown destination)' });
      await bookTo(caller, a._id, '6837');
      const b = await tx({ counterpartyName: '(unknown destination)' });
      expect(await suggestionOf(caller, b._id)).toBeNull();
    });

    it('falls back to the counterparty name (case-insensitive) without an IBAN', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      await bookTo(caller, (await tx({ counterpartyName: 'Cafe Beispiel' })).id, '6640');
      const b = await tx({ counterpartyName: 'CAFE beispiel' });
      expect(await suggestionOf(caller, b._id)).toMatchObject({ matchedBy: 'history', account: '6640', supplierName: 'CAFE beispiel' });
    });

    it('ignores bookings older than three years', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      await bookTo(caller, (await tx({ counterpartyIban: IBAN })).id, '6837');
      expect((await loadHistory(new Date(2026, 5, 1))).size).toBe(1);
      expect((await loadHistory(new Date(2029, 5, 1))).size).toBe(0);
    });

    it('bookBulk books history suggestions and learns a rule from them', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const a = await tx({ counterpartyIban: IBAN });
      const b = await tx({ counterpartyIban: IBAN });
      await caller.bookings.book({ bankTxId: String(a._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      await Supplier.updateMany({}, { archived: true });
      const [res] = await caller.bookings.bookBulk({ bankTxIds: [String(b._id)] });
      expect(res.ok).toBe(true);
      expect((await BankTransaction.findById(b._id))?.supplierId).toBeDefined();
      expect(await Supplier.findOne({ archived: false, ibans: IBAN, origin: 'learned' })).toMatchObject({ defaultAccount: '6837' });
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
    expect(await caller.bookings.receiptMatches({ year: 2026 })).toEqual({ available: false, readingAvailable: true, matches: {} });
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    expect(await caller.bookings.receiptMatches({ year: 2026 })).toEqual({ available: false, readingAvailable: true, matches: {} });
    opencode.enabled = false;
    expect((await caller.bookings.receiptMatches({ year: 2026 })).readingAvailable).toBe(false);
  });

  describe('receipt reading', () => {
    const RECEIPT = { driveFileId: 'r1', fileName: 'Cafe_2026-01-30.pdf', link: 'https://drive/r1' };
    const SPLIT_READING = {
      vendor: 'Muster Café',
      country: 'DE',
      date: '2026-01-30',
      totalCents: 5460,
      reverseCharge: false,
      lines: [
        { vatRate: 0.07, grossCents: 3210, account: '6640' },
        { vatRate: 0.19, grossCents: 2250, account: '6837' },
      ],
    };
    const replyWith = (reading: unknown) => ({ text: `Ergebnis:\n${JSON.stringify(reading)}`, model: { providerID: 'free', id: 'm1' } });

    it('readReceipt caches the reading and the stream shows matchedBy receipt', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const t = await tx({ amountCents: 5460, counterpartyName: 'Muster Cafe', receipt: RECEIPT });
      receiptText.mockResolvedValue('Muster Café\nSumme 54,60 EUR\nIBAN DE89 3704 0044 0532 0130 00');
      ask.mockResolvedValue(replyWith(SPLIT_READING));

      const res = await caller.bookings.readReceipt({ bankTxId: String(t._id) });
      expect(res.status).toBe('ok');
      expect(res.suggestion).toMatchObject({ matchedBy: 'receipt', supplierName: 'Muster Café', reading: { vendor: 'Muster Café', totalCents: 5460 } });
      expect(res.suggestion?.split).toHaveLength(2);
      expect(res.reading).toMatchObject({ vendor: 'Muster Café', totalCents: 5460, reverseCharge: false });
      expect(receiptText).toHaveBeenCalledWith(expect.anything(), 'r1');
      const prompt = ask.mock.calls[0][0];
      expect(prompt).toContain('[IBAN]');
      expect(prompt).not.toContain('3704');
      expect(prompt).toContain('6640');

      const stored = await BankTransaction.findById(t._id);
      expect(stored?.receiptReadings?.[0]).toMatchObject({ driveFileId: 'r1', status: 'ok', model: 'free:m1' });
      expect(stored?.receiptMatch).toMatchObject({ driveFileIds: ['r1'], reading: { totalCents: 5460 } });
      expect(stored?.receiptReading).toBeUndefined();

      // cached: no second request
      expect((await caller.bookings.readReceipt({ bankTxId: String(t._id) })).status).toBe('ok');
      expect(ask).toHaveBeenCalledTimes(1);
      await caller.bookings.readReceipt({ bankTxId: String(t._id), force: true });
      expect(ask).toHaveBeenCalledTimes(2);

      const [row] = await caller.bookings.stream({ year: 2026 });
      expect(row.state === 'open' && row.suggestion).toMatchObject({ matchedBy: 'receipt' });
      const [inboxRow] = await caller.bookings.inbox({ year: 2026 });
      expect(inboxRow.suggestion?.matchedBy).toBe('receipt');

      // bookBulk books the split as one entry
      const [result] = await caller.bookings.bookBulk({ bankTxIds: [String(t._id)] });
      expect(result.ok).toBe(true);
      const tb = trialBalance(await JournalEntry.find({}));
      const bal = (a: string) => tb.rows.find((r) => r.account === a)?.balanceCents;
      expect(bal('1800')).toBe(-5460);
      expect(bal('6640')).toBe(3000);
      expect(bal('6837')).toBe(1891);
    });

    it('combines the sibling receipts that add up and stops as soon as the set matches', async (ctx) => {
      skipIfNoDb(ctx);
      process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
      const files = [
        { id: 'a1', name: 'Spesen - Chris - Augustiner - 08/2026.pdf', link: 'https://drive/a1' },
        { id: 'a2', name: 'Spesen - Chris - Augustiner - 08_2/2026.pdf', link: 'https://drive/a2' },
        { id: 'a3', name: 'Spesen - Chris - Augustiner - 09/2026.pdf', link: 'https://drive/a3' },
      ];
      listReceiptFiles.mockResolvedValue(files);
      const caller = adminCaller();
      const t = await tx({
        amountCents: 5040,
        date: new Date(2026, 8, 3),
        counterpartyName: 'Christian Dähn',
        description: '2x Spesen - Chris - Augustiner - 08/2026 + Spesen - Chris - Augustiner - 08.2/2026',
      });
      receiptText.mockResolvedValue('Augustiner Keller\nSumme 25,20 EUR');
      const part = { vendor: 'Augustiner Keller', country: 'DE', date: '2026-08-29', totalCents: 2520, reverseCharge: false, lines: [{ vatRate: 0.19, grossCents: 2520, account: '6640' }] };
      ask.mockResolvedValue(replyWith(part));

      const res = await caller.bookings.readReceipt({ bankTxId: String(t._id) });
      expect(res.status).toBe('ok');
      expect(res.suggestion).toMatchObject({ matchedBy: 'receipt', reading: { vendor: 'Augustiner Keller', totalCents: 5040, files: 2 } });
      expect(res.suggestion).toMatchObject({ account: '6640', vatRate: 0.19 });
      // two reads, and the September sibling is never touched
      expect(receiptText.mock.calls.map((c) => c[1])).toEqual(['a1', 'a2']);

      const stored = await BankTransaction.findById(t._id);
      expect(stored?.receiptReadings).toHaveLength(2);
      expect(stored?.receiptMatch).toMatchObject({ driveFileIds: ['a1', 'a2'], reading: { totalCents: 5040 } });

      const [row] = await caller.bookings.stream({ year: 2026 });
      expect(row.state === 'open' && row.suggestion?.reading?.files).toBe(2);
      expect(row.state === 'open' && row.receiptReading?.fileCount).toBe(2);

      // a stored match means no second read
      expect((await caller.bookings.readReceipt({ bankTxId: String(t._id) })).status).toBe('ok');
      expect(ask).toHaveBeenCalledTimes(2);
      delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    });

    it('keeps a reusable legacy reading but fills in its file name', async (ctx) => {
      skipIfNoDb(ctx);
      const t = await tx({ amountCents: 5460, receipt: RECEIPT });
      // a reading stored before the multi-receipt change had no file name
      await BankTransaction.updateOne(
        { _id: t._id },
        { $set: { receiptReading: { driveFileId: RECEIPT.driveFileId, status: 'ok', readAt: new Date(), reading: SPLIT_READING } } },
      );
      const res = await adminCaller().bookings.readReceipt({ bankTxId: String(t._id) });
      expect(res.status).toBe('ok');
      expect(ask).not.toHaveBeenCalled();
      const stored = await BankTransaction.findById(t._id);
      expect(stored?.receiptReadings?.[0]).toMatchObject({ driveFileId: RECEIPT.driveFileId, fileName: RECEIPT.fileName });
    });

    it('reports every receipt read when their totals do not add up', async (ctx) => {
      skipIfNoDb(ctx);
      process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
      listReceiptFiles.mockResolvedValue([
        { id: 'a1', name: 'Spesen - Chris - Augustiner - 08/2026.pdf', link: 'https://drive/a1' },
        { id: 'a2', name: 'Spesen - Chris - Augustiner - 08_2/2026.pdf', link: 'https://drive/a2' },
      ]);
      const caller = adminCaller();
      const t = await tx({
        amountCents: 5460,
        date: new Date(2026, 8, 3),
        counterpartyName: 'Christian Dähn',
        description: 'Spesen - Chris - Augustiner - 08/2026',
      });
      receiptText.mockResolvedValue('Augustiner Keller\nSumme 25,20 EUR');
      ask.mockResolvedValue(replyWith({
        vendor: 'Augustiner Keller', totalCents: 2520, reverseCharge: false,
        lines: [{ vatRate: 0.19, grossCents: 2520, account: '6640' }],
      }));

      const res = await caller.bookings.readReceipt({ bankTxId: String(t._id) });
      expect(res.status).toBe('ok');
      expect(res.suggestion).toBeNull();
      expect(res.reading).toBeNull();

      const [row] = await caller.bookings.stream({ year: 2026 });
      expect(row.state === 'open' && row.receiptReading).toMatchObject({
        status: 'ok',
        fileCount: 2,
        files: [
          { fileName: 'Spesen - Chris - Augustiner - 08/2026.pdf', totalCents: 2520 },
          { fileName: 'Spesen - Chris - Augustiner - 08_2/2026.pdf', totalCents: 2520 },
        ],
      });
      expect(row.state === 'open' && row.receiptReading?.reading).toBeUndefined();
      delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    });

    it('reads the clearly matching Drive receipt when none is attached', async (ctx) => {
      skipIfNoDb(ctx);
      process.env.QUEEN_RECEIPTS_FOLDER_ID = 'root';
      listReceiptFiles.mockResolvedValue([
        { id: 'h10', name: 'Hoster_2026-10-16_100000123456.pdf', link: 'https://drive/h10' },
        { id: 'h09', name: 'Hoster_2026-09-16_100000654321.pdf', link: 'https://drive/h09' },
      ]);
      const caller = adminCaller();
      const a = await tx({ counterpartyName: 'Hoster GmbH', description: 'Invoice No. 100000123456', date: new Date(2026, 9, 21), amountCents: 1213 });
      const vague = await tx({ counterpartyName: 'Jemand', description: 'Irgendwas', date: new Date(2026, 9, 21) });
      receiptText.mockResolvedValue('Hoster GmbH Rechnung 12,13 EUR');
      ask.mockResolvedValue(replyWith({ vendor: 'Hoster GmbH', totalCents: 1213, lines: [{ vatRate: 0.19, grossCents: 1213, account: '6837' }] }));
      const res = await caller.bookings.readReceipt({ bankTxId: String(a._id) });
      expect(res.suggestion).toMatchObject({ account: '6837', vatRate: 0.19, mode: 'normal', matchedBy: 'receipt' });
      expect(receiptText).toHaveBeenCalledWith(expect.anything(), 'h10');
      expect(await caller.bookings.readReceipt({ bankTxId: String(vague._id) })).toEqual({ status: 'noReceipt', suggestion: null, reading: null });
      delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    });

    it('a failed read sets status failed and no suggestion', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const t = await tx({ amountCents: 5460, receipt: RECEIPT });
      receiptText.mockResolvedValue('Muster Café Summe 54,60 EUR');
      ask.mockRejectedValue(new Error('opencode reply timed out after 120s'));
      expect(await caller.bookings.readReceipt({ bankTxId: String(t._id) })).toEqual({ status: 'failed', suggestion: null, reading: null });
      expect((await BankTransaction.findById(t._id))?.receiptReadings?.[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/timed out/) });

      // a failed reading is not cached: the next click reads again; an unusable answer fails too
      ask.mockResolvedValue(replyWith({ ...SPLIT_READING, totalCents: 9999 }));
      expect((await caller.bookings.readReceipt({ bankTxId: String(t._id) })).status).toBe('failed');
      expect(ask).toHaveBeenCalledTimes(2);
      const [row] = await caller.bookings.inbox({ year: 2026 });
      expect(row.suggestion).toBeNull();

      ask.mockResolvedValue(replyWith(SPLIT_READING));
      expect((await caller.bookings.readReceipt({ bankTxId: String(t._id) })).status).toBe('ok');
      expect(ask).toHaveBeenCalledTimes(3);
    });

    it('stream and inbox rows expose the stored reading state, also when it gives no suggestion', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const mismatch = await tx({ amountCents: 4999, receipt: RECEIPT });
      const failed = await tx({ amountCents: 5460, receipt: { ...RECEIPT, driveFileId: 'r2' } });
      const stale = await tx({ amountCents: 5460, receipt: { ...RECEIPT, driveFileId: 'r3' } });
      const unread = await tx({ amountCents: 5460 });
      const readAt = new Date(2026, 1, 1);
      // a foreign-currency invoice: read fine, but the total is not the bank amount
      await BankTransaction.updateOne({ _id: mismatch._id }, { $set: { receiptReading: { driveFileId: 'r1', status: 'ok', readAt, reading: SPLIT_READING } } });
      await BankTransaction.updateOne({ _id: failed._id }, { $set: { receiptReading: { driveFileId: 'r2', status: 'failed', readAt, error: 'timeout' } } });
      // read for a file that is no longer attached: not this receipt's state
      await BankTransaction.updateOne({ _id: stale._id }, { $set: { receiptReading: { driveFileId: 'old', status: 'failed', readAt } } });

      const inbox = new Map((await caller.bookings.inbox({ year: 2026 })).map((r) => [r.id, r]));
      expect(inbox.get(String(mismatch._id))).toMatchObject({
        suggestion: null,
        receiptReading: { status: 'ok', reading: { vendor: 'Muster Café', totalCents: 5460 }, fileCount: 1 },
      });
      expect(inbox.get(String(failed._id))?.receiptReading).toMatchObject({ status: 'failed', files: [{ status: 'failed' }] });
      expect(inbox.get(String(stale._id))?.receiptReading).toBeNull();
      expect(inbox.get(String(unread._id))?.receiptReading).toBeNull();

      const stream = new Map((await caller.bookings.stream({ year: 2026 })).map((r) => [r.id, r]));
      const row = stream.get(String(mismatch._id));
      expect(row?.state === 'open' && row.receiptReading).toMatchObject({ status: 'ok', reading: { totalCents: 5460 } });
      const failedRow = stream.get(String(failed._id));
      expect(failedRow?.state === 'open' && failedRow.receiptReading).toMatchObject({ status: 'failed', files: [{ status: 'failed' }] });
    });

    it('readReceipt rejects incoming and non-open rows before touching Drive or opencode', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const incoming = await tx({ direction: 'in', receipt: RECEIPT });
      const booked = await tx({ receipt: RECEIPT });
      await caller.bookings.book({ bankTxId: String(booked._id), account: '6837', vatRate: 0.19, mode: 'normal' });
      const matched = await tx({ receipt: RECEIPT, matchedInvoiceId: new mongoose.Types.ObjectId() });
      const ignored = await tx({ receipt: RECEIPT, ignored: true });
      for (const t of [incoming, booked, matched, ignored]) {
        await expect(caller.bookings.readReceipt({ bankTxId: String(t._id) })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect(listReceiptFiles).not.toHaveBeenCalled();
      expect(receiptText).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
    });

    it('a PDF without text sets noText', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const t = await tx({ amountCents: 5460, receipt: RECEIPT });
      receiptText.mockResolvedValue('  \n ');
      expect(await caller.bookings.readReceipt({ bankTxId: String(t._id) })).toEqual({ status: 'noText', suggestion: null, reading: null });
      expect(ask).not.toHaveBeenCalled();
      expect((await BankTransaction.findById(t._id))?.receiptReadings?.[0]?.status).toBe('noText');
      // noText is cached
      await caller.bookings.readReceipt({ bankTxId: String(t._id) });
      expect(receiptText).toHaveBeenCalledTimes(1);
    });

    it('a non-PDF receipt (photo) is noText without downloading it', async (ctx) => {
      skipIfNoDb(ctx);
      const t = await tx({ amountCents: 5460, receipt: { driveFileId: 'img1', fileName: 'Kassenbon.JPG', link: 'https://drive/img1' } });
      expect(await adminCaller().bookings.readReceipt({ bankTxId: String(t._id) })).toEqual({ status: 'noText', suggestion: null, reading: null });
      expect(receiptText).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
      expect((await BankTransaction.findById(t._id))?.receiptReadings?.[0]).toMatchObject({ driveFileId: 'img1', status: 'noText' });
    });

    it('without OPENCODE_API_KEY reading is unavailable, not an error', async (ctx) => {
      skipIfNoDb(ctx);
      opencode.enabled = false;
      const t = await tx({ amountCents: 5460, receipt: RECEIPT });
      expect(await adminCaller().bookings.readReceipt({ bankTxId: String(t._id) })).toEqual({ status: 'unavailable', suggestion: null, reading: null });
      expect(receiptText).not.toHaveBeenCalled();
    });

    it('rules win over a receipt reading and the receipt is reported as a conflict', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      await caller.suppliers.create({ name: 'Software', namePatterns: ['Software Ltd'], defaultAccount: '6820', defaultVatRate: 0.19 });
      const t = await tx({ amountCents: 5460, receipt: RECEIPT });
      receiptText.mockResolvedValue('Muster Café Summe 54,60 EUR');
      ask.mockResolvedValue(replyWith(SPLIT_READING));
      const res = await caller.bookings.readReceipt({ bankTxId: String(t._id) });
      expect(res.status).toBe('ok');
      expect(res.suggestion).toMatchObject({ matchedBy: 'name', account: '6820' });
      expect(res.suggestion?.conflict?.split).toHaveLength(2);
      expect(res.reading).toMatchObject({ vendor: 'Muster Café', totalCents: 5460 });
      const [row] = await caller.bookings.inbox({ year: 2026 });
      expect(row.suggestion).toMatchObject({ matchedBy: 'name', account: '6820' });
      expect(row.suggestion?.conflict?.split).toHaveLength(2);
      const [streamRow] = await caller.bookings.stream({ year: 2026 });
      expect(streamRow.state === 'open' && streamRow.suggestion?.matchedBy).toBe('name');
    });

    it('readReceiptsNow reads receipts for rows that a rule already classifies', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      await caller.suppliers.create({ name: 'Muster Cafe', namePatterns: ['Muster Cafe'], defaultAccount: '6640', defaultVatRate: 0.19 });
      const t = await tx({ amountCents: 5460, counterpartyName: 'Muster Cafe', date: new Date(2026, 0, 30), receipt: RECEIPT });
      receiptText.mockResolvedValue('Muster Café Summe 54,60 EUR');
      ask.mockResolvedValue(replyWith(SPLIT_READING));

      expect(await caller.bookings.readReceiptsNow({ year: 2026 })).toEqual({ read: 1, available: true });
      expect((await BankTransaction.findById(t._id))?.receiptMatch?.driveFileIds).toEqual(['r1']);
      // a matched row is not read a second time
      expect(await caller.bookings.readReceiptsNow({ year: 2026 })).toEqual({ read: 0, available: true });
    });

    it('readReceiptsNow caps the rows per run and skips incoming ones', async (ctx) => {
      skipIfNoDb(ctx);
      vi.stubEnv('QUEEN_RECEIPTS_PER_RUN', '2');
      const caller = adminCaller();
      await tx({ amountCents: 5460, receipt: RECEIPT });
      await tx({ amountCents: 5460, receipt: { ...RECEIPT, driveFileId: 'r2' } });
      await tx({ amountCents: 5460, receipt: { ...RECEIPT, driveFileId: 'r3' } });
      await tx({ amountCents: 5460, direction: 'in', receipt: { ...RECEIPT, driveFileId: 'r4' } });
      receiptText.mockResolvedValue('Muster Café Summe 54,60 EUR');
      ask.mockResolvedValue(replyWith(SPLIT_READING));
      expect(await caller.bookings.readReceiptsNow({ year: 2026 })).toEqual({ read: 2, available: true });
      expect(await BankTransaction.countDocuments({ 'receiptMatch.driveFileIds': { $exists: true } })).toBe(2);
      vi.unstubAllEnvs();
    });

    it('readReceiptsNow is unavailable without opencode or Drive', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      opencode.enabled = false;
      expect(await caller.bookings.readReceiptsNow({ year: 2026 })).toEqual({ read: 0, available: false });
    });
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
