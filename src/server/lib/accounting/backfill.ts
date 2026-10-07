import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
import { findActiveBySource } from './ledger';
import { postInvoiceEntry, postPaymentEntry } from './ledgerHooks';

export interface BackfillReport {
  invoices: number;
  creditNotes: number;
  payments: number;
  skipped: { ref: string; reason: string }[];
}

/**
 * Post every invoice/credit-note/payment entry of `year` that is missing.
 * Idempotent. A payment for an invoice dated before the year needs an opening
 * Forderung the backfill cannot see → listed in `skipped` for manual booking.
 */
export async function backfillLedger(
  year: number,
  opts: { dryRun: boolean; createdBy: string },
): Promise<BackfillReport> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const report: BackfillReport = { invoices: 0, creditNotes: 0, payments: 0, skipped: [] };

  const issued = await Invoice.find({
    status: { $in: ['sent', 'paid', 'canceled'] },
    invoiceDate: { $gte: start, $lt: end },
  }).sort({ invoiceDate: 1, invoiceNumber: 1 });

  for (const invoice of issued) {
    const kind = invoice.kind === 'credit_note' ? 'credit_note' : 'invoice';
    // Reported on every run, independent of whether the invoice entry is new.
    if (invoice.importedPaid && invoice.status === 'paid' && kind === 'invoice') {
      const refs = [`markPaid:${invoice._id}`, ...invoice.payments.map((p) => `bank:${p.bankTxId}`)];
      const booked = await Promise.all(refs.map((r) => findActiveBySource('payment', r)));
      if (!booked.some(Boolean)) {
        report.skipped.push({
          ref: invoice.invoiceNumber,
          reason: 'imported as paid without payment date — book payment manually',
        });
      }
    }
    if (await findActiveBySource(kind, String(invoice._id))) continue;
    // A credit note mirrors its original exactly; without `cancels` post its own (negative) lines.
    const negate = kind === 'credit_note' && !!invoice.cancels;
    const lines = await InvoiceLine.find({ invoiceId: negate ? invoice.cancels : invoice._id });
    try {
      if (!opts.dryRun) {
        await postInvoiceEntry({ invoice, lines, negate, createdBy: opts.createdBy });
      }
      if (kind === 'credit_note') report.creditNotes += 1;
      else report.invoices += 1;
    } catch (err) {
      report.skipped.push({ ref: invoice.invoiceNumber, reason: (err as Error).message });
    }
  }

  const inYear = { $gte: start, $lt: end };
  const paid = await Invoice.find({
    $or: [{ 'payments.date': inYear }, { status: 'paid', paidAt: inYear }],
  }).sort({ paidAt: 1 });

  for (const invoice of paid) {
    const candidates = invoice.payments
      .filter((p) => p.date >= start && p.date < end)
      .map((p) => ({ refId: `bank:${p.bankTxId}`, date: p.date, amountCents: p.amountCents }));
    // Mirror the markPaid hook: post the remainder not covered by bank payments.
    const openCents =
      invoice.totals.grossCents - invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (
      invoice.status === 'paid' &&
      invoice.kind === 'invoice' &&
      !invoice.importedPaid &&
      openCents > 0 &&
      invoice.paidAt &&
      invoice.paidAt >= start &&
      invoice.paidAt < end
    ) {
      candidates.push({
        refId: `markPaid:${invoice._id}`,
        date: invoice.paidAt,
        amountCents: openCents,
      });
    }

    for (const c of candidates) {
      if (await findActiveBySource('payment', c.refId)) continue;
      if (!invoice.invoiceDate || invoice.invoiceDate < start) {
        report.skipped.push({
          ref: invoice.invoiceNumber,
          reason: `invoice dated before ${year}: needs an opening Forderung — book manually`,
        });
        continue;
      }
      try {
        if (!opts.dryRun) {
          await postPaymentEntry({
            ...c,
            text: `Zahlung ${invoice.invoiceNumber}`,
            createdBy: opts.createdBy,
          });
        }
        report.payments += 1;
      } catch (err) {
        report.skipped.push({ ref: invoice.invoiceNumber, reason: (err as Error).message });
      }
    }
  }

  return report;
}
