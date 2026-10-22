import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';
import { FiscalYear } from '../../models/FiscalYear';

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

const clientId = new mongoose.Types.ObjectId();
const GROSS = 226576;

const baseInvoice = {
  invoiceNumber: '20260529-01',
  legacy: false,
  kind: 'invoice',
  clientId,
  customerNumber: 10010,
  invoiceAddress: 'Musterstr. 1\n12345 Berlin',
  title: 'Leaguesphere 2026',
  invoiceDate: new Date(2026, 4, 29),
  servicePeriod: '2026',
  paymentTermDays: 30,
  dueDate: new Date(2026, 5, 28),
  totals: { netCents: 190400, vatCents: 36176, grossCents: GROSS },
};

async function addInvoice(over: Record<string, unknown> = {}) {
  return Invoice.create({ ...baseInvoice, ...over });
}

beforeAll(async () => {
  if (!dbAvailable()) return;
  await Promise.all([Client.init(), Invoice.init(), FiscalYear.init()]);
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Promise.all([Client.deleteMany({}), Invoice.deleteMany({}), FiscalYear.deleteMany({})]);
  await Client.create({
    _id: clientId,
    customerNumber: 10010,
    name: 'AFCV NRW',
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
  });
  await FiscalYear.create({ year: 2026, status: 'open' });
});

describe('reports.openItems', () => {
  it('lists an invoice imported as paid without a payment as matchable, outside the open totals', async (ctx) => {
    skipIfNoDb(ctx);
    await addInvoice({ status: 'paid', importedPaid: true, reconcileState: 'matched', payments: [] });

    const res = await adminCaller().reports.openItems();
    /**
     * The bank payment is missing: the invoice is offered for matching, but the
     * money arrived — so it is neither an open nor an overdue receivable.
     */
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      invoiceNumber: '20260529-01',
      status: 'paid',
      openCents: GROSS,
      paymentMissing: true,
      overdue: false,
      daysOverdue: 0,
    });
    expect(res.totalOpenCents).toBe(0);
    expect(res.totalOverdueCents).toBe(0);
    expect(res.countPaymentMissing).toBe(1);
    expect(res.totalPaymentMissingCents).toBe(GROSS);
  });

  it('keeps a paid invoice that has a payment record out of the list', async (ctx) => {
    skipIfNoDb(ctx);
    await addInvoice({
      status: 'paid',
      importedPaid: true,
      payments: [{ bankTxId: '401:0', amountCents: GROSS, date: new Date(2026, 5, 9) }],
    });

    const res = await adminCaller().reports.openItems();
    expect(res.items).toHaveLength(0);
    expect(res.totalPaymentMissingCents).toBe(0);
  });

  it('ignores imported-as-paid invoices from a closed fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.updateOne({ year: 2026 }, { status: 'closed' });
    await addInvoice({ status: 'paid', importedPaid: true, payments: [] });

    const res = await adminCaller().reports.openItems();
    expect(res.items).toHaveLength(0);
  });

  it('ignores imported-as-paid invoices before the earliest open fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    await addInvoice({
      invoiceNumber: '20251125-01',
      invoiceDate: new Date(2025, 10, 25),
      dueDate: new Date(2025, 11, 25),
      status: 'paid',
      importedPaid: true,
      payments: [],
    });

    const res = await adminCaller().reports.openItems();
    expect(res.items).toHaveLength(0);
  });

  it('falls back to the current year when no fiscal year is configured', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.deleteMany({});
    const now = new Date();
    await addInvoice({
      invoiceDate: new Date(now.getFullYear(), 4, 29),
      status: 'paid',
      importedPaid: true,
      payments: [],
    });
    await addInvoice({
      invoiceNumber: '20251125-01',
      invoiceDate: new Date(now.getFullYear() - 1, 10, 25),
      status: 'paid',
      importedPaid: true,
      payments: [],
    });

    const res = await adminCaller().reports.openItems();
    expect(res.items.map((i) => i.invoiceNumber)).toEqual(['20260529-01']);
  });

  it('still lists and totals sent invoices, including overdue', async (ctx) => {
    skipIfNoDb(ctx);
    await addInvoice({ status: 'sent' });

    const res = await adminCaller().reports.openItems();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ status: 'sent', paymentMissing: false, overdue: true });
    expect(res.totalOpenCents).toBe(GROSS);
    expect(res.totalOverdueCents).toBe(GROSS);
    expect(res.countPaymentMissing).toBe(0);
  });

  it('leaves drafts, canceled invoices and credit notes out', async (ctx) => {
    skipIfNoDb(ctx);
    await addInvoice({ status: 'draft' });
    await addInvoice({ invoiceNumber: '20260529-02', status: 'canceled' });
    await addInvoice({
      invoiceNumber: '20260529-03',
      kind: 'credit_note',
      status: 'sent',
      totals: { netCents: -190400, vatCents: -36176, grossCents: -GROSS },
    });

    const res = await adminCaller().reports.openItems();
    expect(res.items.map((i) => i.invoiceNumber).sort()).toEqual(['20260529-03']);
    expect(res.items[0].overdue).toBe(false);
  });
});
