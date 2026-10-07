import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
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
    await expect(caller.ledger.postManual(opening)).rejects.toThrowError(/existiert bereits/);
  });

  it('postManual opening uses the explicit year', async (ctx) => {
    skipIfNoDb(ctx);
    const entry = await adminCaller().ledger.postManual({
      ...opening,
      date: new Date(2026, 5, 1),
      year: 2025,
    });
    expect(new Date(entry.date).getTime()).toBe(new Date(2025, 0, 1).getTime());
    expect(entry.source.refId).toBe('opening:2025');
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
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Soll und Haben sind nicht ausgeglichen',
    });
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

  async function preYearPayment(caller: ReturnType<typeof adminCaller>) {
    const invoice = await sentInvoice(caller, new Date(2025, 11, 15));
    const tx = await BankTransaction.create({
      fireflyJournalId: '99:0',
      date: new Date(2026, 0, 10),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
    await JournalEntry.collection.deleteMany({});
    return invoice;
  }

  it('skips pre-year payments until an opening entry exists', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await preYearPayment(caller);

    const report = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(report.payments).toBe(0);
    expect(report.skipped).toEqual([
      {
        ref: invoice.invoiceNumber,
        reason: 'erst Eröffnungsbuchung erfassen (Rechnung vor 2026)',
      },
    ]);
  });

  it('posts pre-year payments once an opening entry exists', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await preYearPayment(caller);
    const gross = invoice.totals.grossCents;
    await caller.ledger.postManual({
      kind: 'opening',
      date: new Date(2026, 0, 1),
      text: 'Eröffnung',
      lines: [
        { account: '1200', debitCents: gross, creditCents: 0 },
        { account: '2900', debitCents: 0, creditCents: gross },
      ],
    });

    const report = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(report).toMatchObject({ payments: 1, skipped: [] });
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(0);
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(gross);
  });

  it('does not book revenue for Sheet-canceled invoices without a credit note', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const client = await caller.clients.create({ name: 'Storno GmbH', invoiceAddress: 'Str. 3' });
    const invoice = await Invoice.create({
      invoiceNumber: 'LEG-2',
      legacy: true,
      clientId: (client as any)._id,
      customerNumber: (client as any).customerNumber,
      invoiceAddress: 'Str. 3',
      title: 'Storniert',
      servicePeriod: '01.2026',
      paymentTermDays: 14,
      invoiceDate: new Date(2026, 0, 20),
      status: 'canceled',
      kind: 'invoice',
      totals: { netCents: 10000, vatCents: 1900, grossCents: 11900 },
    });
    await InvoiceLine.create({
      invoiceId: invoice._id,
      position: '1',
      description: 'Alt',
      quantity: 1,
      unitNetCents: 10000,
      vatRate: 0.19,
    });
    const reason = 'storniert ohne Stornorechnung — prüfen';
    for (let run = 0; run < 2; run += 1) {
      const report = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
      expect(report).toMatchObject({ invoices: 0, creditNotes: 0, payments: 0 });
      expect(report.skipped).toEqual([{ ref: 'LEG-2', reason }]);
    }
    expect(await JournalEntry.countDocuments()).toBe(0);
  });

  describe('scenarios', () => {
    async function backfill(caller: ReturnType<typeof adminCaller>) {
      await JournalEntry.collection.deleteMany({});
      return caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    }
    async function expectBalanced(balance1200: number) {
      const tb = trialBalance(await JournalEntry.find({}));
      expect(tb.debitCents).toBe(tb.creditCents);
      expect(tb.rows.find((r) => r.account === '1200')?.balanceCents ?? 0).toBe(balance1200);
    }

    it('cancel posts invoice and credit note; receivable nets to zero', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const invoice = await sentInvoice(caller);
      await caller.invoices.cancel({ id: invoice._id.toString() });
      const report = await backfill(caller);
      expect(report).toMatchObject({ invoices: 1, creditNotes: 1, payments: 0, skipped: [] });
      await expectBalanced(0);
    });

    it('markPaid without bank payment posts the full amount', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const invoice = await sentInvoice(caller);
      await caller.invoices.markPaid({ id: invoice._id.toString(), paidAt: new Date(2026, 3, 2) });
      const report = await backfill(caller);
      expect(report).toMatchObject({ invoices: 1, payments: 1, skipped: [] });
      await expectBalanced(0);
    });

    it('partial bank payment plus markPaid posts bank and remainder', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const invoice = await sentInvoice(caller);
      const tx = await BankTransaction.create({
        fireflyJournalId: '77:0',
        date: new Date(2026, 3, 1),
        amountCents: 1000,
        description: 'Teilzahlung',
      });
      await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
      await caller.invoices.markPaid({ id: invoice._id.toString(), paidAt: new Date(2026, 3, 5) });
      const report = await backfill(caller);
      expect(report).toMatchObject({ invoices: 1, payments: 2, skipped: [] });
      await expectBalanced(0);
    });

    it('flags importedPaid invoices instead of leaving the receivable silently open', async (ctx) => {
      skipIfNoDb(ctx);
      const caller = adminCaller();
      const client = await caller.clients.create({ name: 'Alt GmbH', invoiceAddress: 'Str. 2' });
      const invoice = await Invoice.create({
        invoiceNumber: 'LEG-1',
        legacy: true,
        clientId: (client as any)._id,
        customerNumber: (client as any).customerNumber,
        invoiceAddress: 'Str. 2',
        title: 'Alt',
        servicePeriod: '01.2026',
        paymentTermDays: 14,
        invoiceDate: new Date(2026, 0, 20),
        status: 'paid',
        importedPaid: true,
        totals: { netCents: 10000, vatCents: 1900, grossCents: 11900 },
      });
      await InvoiceLine.create({
        invoiceId: invoice._id,
        position: '1',
        description: 'Alt',
        quantity: 1,
        unitNetCents: 10000,
        vatRate: 0.19,
      });
      const report = await backfill(caller);
      expect(report).toMatchObject({ invoices: 1, payments: 0 });
      expect(report.skipped).toEqual([
        { ref: 'LEG-1', reason: expect.stringContaining('als bezahlt importiert') },
      ]);
      await expectBalanced(11900);

      const again = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
      expect(again).toMatchObject({ invoices: 0, payments: 0 });
      expect(again.skipped).toEqual(report.skipped);
    });
  });
});
