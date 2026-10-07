import { findActiveBySource, postOnce, reverse } from './ledger';
import { invoicePosting, paymentPosting, type PostingLineInput } from './postingRules';

interface InvoiceForPosting {
  _id: unknown;
  kind: string;
  invoiceNumber: string;
  customerNumber: number;
  invoiceDate?: Date | null;
}

/**
 * Forderung an Erlös/USt for an issued invoice or credit note. For a credit
 * note pass the ORIGINAL invoice's lines with `negate: true`.
 */
export async function postInvoiceEntry(args: {
  invoice: InvoiceForPosting;
  lines: PostingLineInput[];
  negate: boolean;
  createdBy: string;
}) {
  const { invoice } = args;
  if (!invoice.invoiceDate) throw new Error(`Invoice ${invoice.invoiceNumber} has no invoiceDate`);
  const kind = invoice.kind === 'credit_note' ? 'credit_note' : 'invoice';
  const label = kind === 'credit_note' ? 'Stornorechnung' : 'Rechnung';
  return postOnce({
    date: invoice.invoiceDate,
    text: `${label} ${invoice.invoiceNumber} · Kd ${invoice.customerNumber}`,
    lines: invoicePosting(args.lines, { negate: args.negate }),
    source: { kind, refId: String(invoice._id) },
    createdBy: args.createdBy,
  });
}

/** Bank an Forderungen. refId: `bank:<fireflyJournalId>` or `markPaid:<invoiceId>`. */
export async function postPaymentEntry(args: {
  refId: string;
  date: Date;
  amountCents: number;
  text: string;
  createdBy: string;
}) {
  return postOnce({
    date: args.date,
    text: args.text,
    lines: paymentPosting(args.amountCents),
    source: { kind: 'payment', refId: args.refId },
    createdBy: args.createdBy,
  });
}

export async function reversePaymentEntry(
  refId: string,
  reason: string,
  createdBy: string,
): Promise<void> {
  const entry = await findActiveBySource('payment', refId);
  if (entry) await reverse(String(entry._id), { reason, createdBy });
}

/**
 * Ledger side effects must never fail invoice/bank CRUD: log and move on;
 * `admin.ledgerBackfill` posts whatever is missing.
 */
export async function safeLedger(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[ledger] ${label} failed — run admin.ledgerBackfill:`, (err as Error).message);
  }
}
