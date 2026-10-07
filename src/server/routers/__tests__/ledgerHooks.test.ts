import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { BankTransaction } from '../../models/BankTransaction';
import { FiscalYear } from '../../models/FiscalYear';
import { InvoiceLine } from '../../models/InvoiceLine';
import { JournalEntry } from '../../models/JournalEntry';
import { postInvoiceEntry } from '../../lib/accounting/ledgerHooks';
import { trialBalance } from '../../lib/accounting/balances';
import {
  INVOICE_DATE,
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

describe('ledger hooks', () => {
  it('markSent posts one invoice entry whose 1200 debit equals the gross', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await sentInvoice(adminCaller());
    const entries = await JournalEntry.find({ 'source.kind': 'invoice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].date.getTime()).toBe(INVOICE_DATE.getTime());
    const receivable = entries[0].lines.find((l) => l.account === '1200');
    expect(receivable?.debitCents).toBe(invoice.totals.grossCents);
  });

  it('a retried hook does not post twice', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await sentInvoice(adminCaller());
    const lines = await InvoiceLine.find({ invoiceId: invoice._id });
    const again = await postInvoiceEntry({ invoice, lines, negate: false, createdBy: 't' });
    expect(again.created).toBe(false);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'invoice' })).toBe(1);
  });

  it('cancel posts a credit note that exactly mirrors the invoice', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    await caller.invoices.cancel({ id: invoice._id.toString(), reason: 'Fehler' });
    const entries = await JournalEntry.find({});
    expect(entries.map((e) => e.source.kind).sort()).toEqual(['credit_note', 'invoice']);
    const tb = trialBalance(entries);
    expect(tb.rows.every((r) => r.balanceCents === 0)).toBe(true);
  });

  it('bank assign posts a payment; unassign reverses it; reassign posts again', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const tx = await BankTransaction.create({
      fireflyJournalId: '77:0',
      date: new Date(2026, 3, 1),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    const bankTxId = tx._id.toString();
    await caller.bank.assign({ bankTxId, invoiceId: invoice._id.toString() });
    await caller.bank.unassign({ bankTxId });
    await caller.bank.assign({ bankTxId, invoiceId: invoice._id.toString() });

    const payments = await JournalEntry.find({ 'source.kind': 'payment' });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.createdBy === 'admin-id-1')).toBe(true);
    expect(payments.filter((p) => p.active)).toHaveLength(1);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'reversal' })).toBe(1);

    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(0);
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(
      invoice.totals.grossCents,
    );
  });

  it('markPaid posts the open amount as a markPaid payment', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    await caller.invoices.markPaid({ id: invoice._id.toString(), paidAt: new Date(2026, 3, 2) });
    const entry = await JournalEntry.findOne({
      'source.kind': 'payment',
      'source.refId': `markPaid:${invoice._id}`,
    });
    expect(entry?.lines[0].toObject()).toEqual({
      account: '1800',
      debitCents: invoice.totals.grossCents,
      creditCents: 0,
    });
  });

  it('bank payment after manual markPaid replaces the markPaid entry instead of double-booking', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const id = invoice._id.toString();
    await caller.invoices.markPaid({ id, paidAt: new Date(2026, 3, 2) });
    const tx = await BankTransaction.create({
      fireflyJournalId: '55:0',
      date: new Date(2026, 3, 3),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: id });

    const markPaid = await JournalEntry.find({
      'source.kind': 'payment',
      'source.refId': `markPaid:${id}`,
    });
    expect(markPaid.every((e) => !e.active)).toBe(true);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(invoice.totals.grossCents);
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents ?? 0).toBe(0);
  });

  it('unassign of a partial bank payment also reverses the markPaid remainder', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const gross = invoice.totals.grossCents;
    const tx = await BankTransaction.create({
      fireflyJournalId: '88:0',
      date: new Date(2026, 3, 1),
      amountCents: 1000,
      description: 'Teilzahlung',
    });
    const bankTxId = tx._id.toString();
    const id = invoice._id.toString();
    await caller.bank.assign({ bankTxId, invoiceId: id });
    await caller.invoices.markPaid({ id, paidAt: new Date(2026, 3, 2) });
    await caller.bank.unassign({ bankTxId });

    const payments = await JournalEntry.find({ 'source.kind': 'payment' });
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => !p.active)).toBe(true);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(gross);
  });

  it('markSent into a closed year still succeeds and posts nothing', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'closed' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await sentInvoice(adminCaller(), new Date(2025, 11, 20));
    expect(invoice.status).toBe('sent');
    expect(await JournalEntry.countDocuments()).toBe(0);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[ledger]'), expect.anything());
    errors.mockRestore();
  });
});
