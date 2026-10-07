import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { trialBalance } from '../../lib/accounting/balances';
import {
  adminCaller,
  initLedgerModels,
  resetLedgerDb,
  sentInvoice,
  skipIfNoDb,
} from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({
  enqueueFileInvoice: vi.fn(async (_invoiceId: string) => {}),
}));

beforeAll(initLedgerModels);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetLedgerDb();
});

const opening = {
  kind: 'opening' as const,
  date: new Date(2026, 5, 1), // any date in the year → stored as 01.01.
  text: 'Eröffnungsbilanz',
  lines: [
    { account: '1800', debitCents: 50000, creditCents: 0 },
    { account: '2900', debitCents: 0, creditCents: 20000 },
    { account: '2970', debitCents: 0, creditCents: 30000 },
  ],
};

describe('ledger router', () => {
  it('postManual opening is dated 01.01. and only allowed once per year', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const entry = await caller.ledger.postManual(opening);
    expect(new Date(entry.date).getTime()).toBe(new Date(2026, 0, 1).getTime());
    await expect(caller.ledger.postManual(opening)).rejects.toThrowError(/Already posted/);
  });

  it('postManual rejects unbalanced input with BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(
      adminCaller().ledger.postManual({
        ...opening,
        kind: 'manual',
        lines: [
          { account: '1800', debitCents: 100, creditCents: 0 },
          { account: '2900', debitCents: 0, creditCents: 99 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('trialBalance includes account names and balances to zero', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.ledger.postManual(opening);
    await sentInvoice(caller);
    const tb = await caller.ledger.trialBalance({ year: 2026 });
    expect(tb.debitCents).toBe(tb.creditCents);
    expect(tb.rows.find((r) => r.account === '1800')?.name).toBe('Bank');
  });

  it('reverse is limited to manual/opening entries', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const manual = await caller.ledger.postManual({ ...opening, kind: 'manual' });
    await caller.ledger.reverse({ id: String(manual._id), reason: 'Tippfehler' });
    await sentInvoice(caller);
    const auto = await JournalEntry.findOne({ 'source.kind': 'invoice' });
    await expect(
      caller.ledger.reverse({ id: String(auto!._id), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('accountLedger returns running balances for one account', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.ledger.postManual(opening);
    const rows = await caller.ledger.accountLedger({ year: 2026, account: '1800' });
    expect(rows).toHaveLength(1);
    expect(rows[0].runningCents).toBe(50000);
  });
});

describe('admin.ledgerBackfill', () => {
  it('re-posts missing entries idempotently; dry run writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const tx = await BankTransaction.create({
      fireflyJournalId: '88:0',
      date: new Date(2026, 3, 1),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
    await JournalEntry.collection.deleteMany({}); // simulate hooks that never ran

    const dry = await caller.admin.ledgerBackfill({ year: 2026 });
    expect(dry).toMatchObject({ invoices: 1, payments: 1, skipped: [] });
    expect(await JournalEntry.countDocuments()).toBe(0);

    const real = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(real).toMatchObject({ invoices: 1, payments: 1 });
    const again = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(again).toMatchObject({ invoices: 0, creditNotes: 0, payments: 0 });
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(0);
  });

  it('skips payments for invoices dated before the year instead of posting them', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller, new Date(2025, 11, 15));
    const tx = await BankTransaction.create({
      fireflyJournalId: '99:0',
      date: new Date(2026, 0, 10),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
    await JournalEntry.collection.deleteMany({});

    const report = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(report.payments).toBe(0);
    expect(report.skipped).toEqual([
      { ref: invoice.invoiceNumber, reason: expect.stringContaining('before 2026') },
    ]);
  });
});
