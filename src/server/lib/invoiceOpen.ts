import { FiscalYear } from '../models/FiscalYear';

/**
 * Invoices the bank inbox may match, and the "Zahlung nicht zugeordnet" bucket
 * of the reports.
 *
 * An invoice imported from the Sheet as paid (`importedPaid`) has no `payments`
 * entry: the payment date and the bank transaction were unknown at import time,
 * so `applySheetImport` sets `status: 'paid'` + `reconcileState: 'matched'` as a
 * guess (see `applySheetImport.invoiceDoc`). Until the real bank payment is
 * attached, the receivable of its invoice entry stays open in the ledger —
 * `admin.ledgerBackfill` reports exactly that as
 * "als bezahlt importiert ohne Zahlungsdatum — Zahlung manuell buchen".
 */

/** The fields of an invoice this module needs (works with documents and lean objects). */
export interface InvoiceOpenState {
  kind?: string | null;
  status: string;
  importedPaid?: boolean | null;
  payments?: { amountCents: number }[] | null;
}

/**
 * Imported as paid, but no payment was ever recorded: the bank payment is
 * missing. Deliberately narrow — a paid invoice *with* a payment is settled, and
 * credit notes never belong in the inbox.
 */
export function paymentMissing(inv: InvoiceOpenState): boolean {
  return (
    inv.kind !== 'credit_note' &&
    inv.status === 'paid' &&
    inv.importedPaid === true &&
    (inv.payments?.length ?? 0) === 0
  );
}

/**
 * Start of the earliest fiscal year that is not closed. Missing payment records
 * from closed years are history — their receivables are covered by the opening
 * entry and nothing may be posted into them any more.
 *
 * No fiscal year configured at all (fresh install) → 1 January of `now`'s year.
 * All years closed → 1 January after the latest one, i.e. nothing to match.
 */
export async function matchableFrom(now: Date = new Date()): Promise<Date> {
  const years = await FiscalYear.find({}).select('year status').lean();
  if (years.length === 0) return new Date(now.getFullYear(), 0, 1);
  const open = years.filter((y) => y.status !== 'closed').map((y) => y.year);
  if (open.length === 0) return new Date(Math.max(...years.map((y) => y.year)) + 1, 0, 1);
  return new Date(Math.min(...open), 0, 1);
}

/**
 * Query filter for {@link matchableFrom}'s window: invoices still open (`sent`),
 * plus invoices imported as paid without a recorded payment. `payments.0:
 * { $exists: false }` matches both an empty array and a missing field.
 */
export function matchableInvoiceFilter(from: Date): Record<string, unknown> {
  return {
    $or: [
      { status: 'sent' },
      {
        status: 'paid',
        kind: 'invoice',
        importedPaid: true,
        'payments.0': { $exists: false },
        invoiceDate: { $gte: from },
      },
    ],
  };
}
