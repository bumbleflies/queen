import { router, authedProcedure } from '../trpcInit';
import { Invoice } from '../models/Invoice';
import { Client } from '../models/Client';
import { matchableFrom, matchableInvoiceFilter, paymentMissing } from '../lib/invoiceOpen';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function paidCents(payments: { amountCents: number }[] | undefined): number {
  return (payments ?? []).reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
}

/**
 * Reporting queries for the dashboard and the Berichte page. All amounts are
 * integer cents; revenue is grouped by payment date (`paidAt`) per the mock
 * "nach Zahlungseingang", not by invoice date.
 */
export const reportsRouter = router({
  /**
   * Open invoices with their computed overdue flag and open amount, plus the
   * ones imported as paid without a recorded payment (`paymentMissing`): those
   * are offered for matching in the inbox, but they are not open receivables and
   * therefore excluded from `totalOpenCents`/`totalOverdueCents` (their own sum
   * is `totalPaymentMissingCents`).
   */
  openItems: authedProcedure.query(async () => {
    const from = await matchableFrom();
    const [invoices, clients] = await Promise.all([
      Invoice.find(matchableInvoiceFilter(from)),
      Client.find({}).select('customerNumber name'),
    ]);
    const clientById = new Map(clients.map((c) => [String(c._id), c]));
    const today = startOfToday();

    const items = invoices.map((inv) => {
      const gross = inv.totals?.grossCents ?? 0;
      const paid = paidCents(inv.payments);
      const open = gross - paid;
      const missing = paymentMissing(inv);
      const due = inv.dueDate ? new Date(inv.dueDate) : null;
      // A missing payment is not an overdue receivable: the money arrived, only
      // its bank transaction is unknown. Overdue would distort aging and dunning.
      const overdue =
        !missing && inv.kind !== 'credit_note' && due !== null && due.getTime() < today.getTime();
      const daysOverdue =
        overdue && due
          ? Math.floor((today.getTime() - due.getTime()) / (24 * 60 * 60 * 1000))
          : 0;
      const client = clientById.get(String(inv.clientId));
      return {
        id: String(inv._id),
        invoiceNumber: inv.invoiceNumber,
        kind: inv.kind,
        customerNumber: inv.customerNumber,
        clientId: String(inv.clientId),
        clientName: client?.name ?? '',
        title: inv.title,
        invoiceDate: inv.invoiceDate ?? null,
        dueDate: inv.dueDate ?? null,
        servicePeriod: inv.servicePeriod,
        status: inv.status,
        grossCents: gross,
        paidCents: paid,
        openCents: open,
        overdue,
        daysOverdue,
        paymentMissing: missing,
      };
    });

    items.sort((a, b) => {
      const at = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const bt = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return at - bt;
    });

    const receivables = items.filter((i) => !i.paymentMissing);
    const unassigned = items.filter((i) => i.paymentMissing);

    return {
      items,
      count: items.length,
      totalOpenCents: receivables.reduce((sum, i) => sum + i.openCents, 0),
      totalOverdueCents: receivables
        .filter((i) => i.overdue)
        .reduce((sum, i) => sum + i.openCents, 0),
      countPaymentMissing: unassigned.length,
      totalPaymentMissingCents: unassigned.reduce((sum, i) => sum + i.openCents, 0),
    };
  }),

  /** Gross sums of paid invoices grouped by year of payment (`paidAt`). */
  revenueByYear: authedProcedure.query(async () => {
    const paid = await Invoice.find({ status: 'paid', paidAt: { $ne: null } });
    const byYear = new Map<number, number>();
    for (const inv of paid) {
      if (!inv.paidAt) continue;
      const year = new Date(inv.paidAt).getFullYear();
      byYear.set(year, (byYear.get(year) ?? 0) + (inv.totals?.grossCents ?? 0));
    }
    return [...byYear.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, grossCents]) => ({ year, grossCents }));
  }),

  /** Gross sums of paid invoices grouped by client. */
  revenueByClient: authedProcedure.query(async () => {
    const [paid, clients] = await Promise.all([
      Invoice.find({ status: 'paid' }),
      Client.find({}).select('customerNumber name'),
    ]);
    const clientById = new Map(clients.map((c) => [String(c._id), c]));
    const byClient = new Map<string, number>();
    for (const inv of paid) {
      const key = String(inv.clientId);
      byClient.set(key, (byClient.get(key) ?? 0) + (inv.totals?.grossCents ?? 0));
    }
    return [...byClient.entries()]
      .map(([clientId, grossCents]) => {
        const client = clientById.get(clientId);
        return {
          clientId,
          clientName: client?.name ?? '',
          customerNumber: client?.customerNumber ?? 0,
          grossCents,
        };
      })
      .sort((a, b) => b.grossCents - a.grossCents);
  }),
});
