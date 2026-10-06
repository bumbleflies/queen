import type { HydratedDocument, Types } from 'mongoose';
import { BankTransaction, type BankTransactionDoc } from '../models/BankTransaction';
import { Invoice, type InvoiceDoc } from '../models/Invoice';

/**
 * Reconcile logic lives here in two layers:
 *  - pure helpers (`parseReference`, `pickInvoiceForReference`, `classifyPayment`,
 *    `isAlreadyProcessed`, `isCliEntrypoint`) — unit-tested without Mongo;
 *  - a thin DB apply step (`reconcileBankTransaction`,
 *    `reconcilePendingTransactions`, `reversePayment`) — integration-tested.
 */

export interface ParsedReference {
  customerNumber?: number;
  invoiceNumber: string;
}

// Banks insert spaces and line breaks into the Verwendungszweck; strip them
// first so a single tolerant pattern can match. The `\s*` / `[-/ ]?` remain so
// the regex is also correct if applied to an unstripped string.
const FULL_REFERENCE = /(\d{5})\s*[-/ ]?\s*(\d{8})\s*[-/ ]?\s*(\d{2})/;
const BARE_REFERENCE = /(\d{8})-(\d{2})/;

/** Extract `<customerNumber>-<invoiceNumber>` (or a bare invoice number) from a bank description. */
export function parseReference(desc: string): ParsedReference | null {
  if (!desc) return null;
  const compact = desc.replace(/\s+/g, '');

  const full = FULL_REFERENCE.exec(compact);
  if (full) {
    return { customerNumber: Number(full[1]), invoiceNumber: `${full[2]}-${full[3]}` };
  }

  const bare = BARE_REFERENCE.exec(compact);
  if (bare) {
    return { invoiceNumber: `${bare[1]}-${bare[2]}` };
  }

  return null;
}

/** Pure lookup of a candidate invoice by its number (customer check happens in `classifyPayment`). */
export function pickInvoiceForReference<T extends { invoiceNumber: string }>(
  parsed: ParsedReference,
  invoices: readonly T[],
): T | null {
  return invoices.find((invoice) => invoice.invoiceNumber === parsed.invoiceNumber) ?? null;
}

/** A bank transaction is never re-applied once matched, nor if it was ignored. */
export function isAlreadyProcessed(tx: {
  matchedInvoiceId?: unknown;
  ignored?: boolean;
}): boolean {
  return tx.matchedInvoiceId != null || tx.ignored === true;
}

export interface ClassifiableInvoice {
  kind: string;
  status: string;
  customerNumber: number;
  totals: { grossCents: number };
}

export interface ClassifyPaymentInput {
  txAmountCents: number;
  txDate: Date;
  invoice: ClassifiableInvoice;
  existingPayments: readonly { amountCents: number }[];
  /** Customer number parsed from the description; absent for a bare invoice number. */
  referenceCustomerNumber?: number;
}

export type PaymentAction = 'unmatched' | 'partial' | 'paid' | 'overpaid';

export interface PaymentDecision {
  action: PaymentAction;
  reconcileState: 'unmatched' | 'partial' | 'matched' | 'overpaid';
  reason?: string;
  /** Set when this payment completes the invoice (tx date); absent when already paid. */
  paidAt?: Date;
}

/**
 * Decide what an incoming payment does to an invoice. Pure: no DB access.
 * A credit note or an invoice that is not `sent`/`paid` is never auto-matched,
 * and a parsed customer number must match the invoice's.
 */
export function classifyPayment(input: ClassifyPaymentInput): PaymentDecision {
  const { invoice, txAmountCents, txDate, existingPayments, referenceCustomerNumber } = input;

  if (invoice.kind === 'credit_note') {
    return {
      action: 'unmatched',
      reconcileState: 'unmatched',
      reason: 'credit note is never auto-matched',
    };
  }

  if (referenceCustomerNumber !== undefined && referenceCustomerNumber !== invoice.customerNumber) {
    return {
      action: 'unmatched',
      reconcileState: 'unmatched',
      reason: `customer number ${referenceCustomerNumber} does not match invoice ${invoice.customerNumber}`,
    };
  }

  if (invoice.status !== 'sent' && invoice.status !== 'paid') {
    return {
      action: 'unmatched',
      reconcileState: 'unmatched',
      reason: `invoice is ${invoice.status}`,
    };
  }

  const paidCents = existingPayments.reduce((sum, p) => sum + p.amountCents, 0) + txAmountCents;
  const gross = invoice.totals.grossCents;

  if (paidCents < gross) {
    return { action: 'partial', reconcileState: 'partial' };
  }
  if (paidCents === gross) {
    return { action: 'paid', reconcileState: 'matched', paidAt: txDate };
  }
  return {
    action: 'overpaid',
    reconcileState: 'overpaid',
    paidAt: invoice.status === 'paid' ? undefined : txDate,
  };
}

export interface ReconcileOutcome {
  outcome: PaymentAction;
  reason?: string;
}

/** Append the payment, update status/reconcileState and link the bank transaction. */
async function applyPayment(
  invoice: HydratedDocument<InvoiceDoc>,
  bankTx: HydratedDocument<BankTransactionDoc>,
  decision: PaymentDecision,
  matchMethod: 'reference' | 'manual',
): Promise<void> {
  invoice.payments.push({
    bankTxId: bankTx.fireflyJournalId,
    amountCents: bankTx.amountCents,
    date: bankTx.date,
    counterpartyIban: bankTx.counterpartyIban ?? undefined,
    reference: bankTx.description,
  });
  invoice.reconcileState = decision.reconcileState;
  if (decision.paidAt) {
    invoice.status = 'paid';
    invoice.paidAt = decision.paidAt;
  }
  await invoice.save();

  bankTx.matchedInvoiceId = invoice._id;
  bankTx.matchMethod = matchMethod;
  await bankTx.save();
}

/**
 * DB apply step: resolve the referenced invoice and, when eligible, append the
 * payment, update status/reconcileState and mark the bank transaction matched.
 * Already-processed transactions are a no-op.
 */
export async function reconcileBankTransaction(
  bankTx: HydratedDocument<BankTransactionDoc>,
): Promise<ReconcileOutcome> {
  if (isAlreadyProcessed(bankTx)) {
    return { outcome: 'unmatched', reason: 'already processed' };
  }

  const parsed = parseReference(bankTx.description);
  if (!parsed) return { outcome: 'unmatched', reason: 'no Verwendungszweck reference' };

  const invoice = await Invoice.findOne({ invoiceNumber: parsed.invoiceNumber });
  if (!invoice) return { outcome: 'unmatched', reason: 'invoice not found' };

  const existingPayments = invoice.payments
    .filter((p) => p.bankTxId !== bankTx.fireflyJournalId)
    .map((p) => ({ amountCents: p.amountCents }));

  const decision = classifyPayment({
    txAmountCents: bankTx.amountCents,
    txDate: bankTx.date,
    invoice: {
      kind: invoice.kind,
      status: invoice.status,
      customerNumber: invoice.customerNumber,
      totals: { grossCents: invoice.totals.grossCents },
    },
    existingPayments,
    referenceCustomerNumber: parsed.customerNumber,
  });

  if (decision.action === 'unmatched') {
    return { outcome: 'unmatched', reason: decision.reason };
  }

  await applyPayment(invoice, bankTx, decision, 'reference');
  return { outcome: decision.action };
}

/**
 * Manual counterpart of {@link reconcileBankTransaction}: the admin picks the
 * invoice, so there is no reference/customer check. Credit notes and canceled
 * invoices are never assignable. Already-processed transactions are a no-op.
 */
export async function assignBankTransactionToInvoice(
  bankTx: HydratedDocument<BankTransactionDoc>,
  invoiceId: string | Types.ObjectId,
): Promise<ReconcileOutcome> {
  if (isAlreadyProcessed(bankTx)) {
    return { outcome: 'unmatched', reason: 'already processed' };
  }

  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return { outcome: 'unmatched', reason: 'invoice not found' };
  if (invoice.kind === 'credit_note') {
    return { outcome: 'unmatched', reason: 'credit note is never assigned' };
  }
  if (invoice.status === 'canceled') {
    return { outcome: 'unmatched', reason: 'canceled invoice is never assigned' };
  }

  const existingPayments = invoice.payments
    .filter((p) => p.bankTxId !== bankTx.fireflyJournalId)
    .map((p) => ({ amountCents: p.amountCents }));

  const decision = classifyPayment({
    txAmountCents: bankTx.amountCents,
    txDate: bankTx.date,
    invoice: {
      kind: invoice.kind,
      status: invoice.status,
      customerNumber: invoice.customerNumber,
      totals: { grossCents: invoice.totals.grossCents },
    },
    existingPayments,
  });

  if (decision.action === 'unmatched') {
    return { outcome: 'unmatched', reason: decision.reason };
  }

  await applyPayment(invoice, bankTx, decision, 'manual');
  return { outcome: decision.action };
}

export interface ReconcileCounts {
  matched: number;
  partial: number;
  unmatched: number;
}

/** Match every fresh, unignored bank transaction. Idempotent across runs. */
export async function reconcilePendingTransactions(): Promise<ReconcileCounts> {
  const transactions = await BankTransaction.find({
    matchedInvoiceId: null,
    ignored: { $ne: true },
  });

  const counts: ReconcileCounts = { matched: 0, partial: 0, unmatched: 0 };
  for (const tx of transactions) {
    const { outcome } = await reconcileBankTransaction(tx);
    if (outcome === 'paid' || outcome === 'overpaid') counts.matched += 1;
    else if (outcome === 'partial') counts.partial += 1;
    else counts.unmatched += 1;
  }
  return counts;
}

/**
 * Explicit reversal for `bank.unassign`: drop the payment and recompute the
 * invoice's reconcile state, returning it to `sent` when the reversal means it
 * is no longer fully paid.
 */
export async function reversePayment(
  invoiceId: string | Types.ObjectId,
  bankTxId: string,
): Promise<void> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return;

  const index = invoice.payments.findIndex((p) => p.bankTxId === bankTxId);
  if (index >= 0) invoice.payments.splice(index, 1);
  const paidCents = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
  const gross = invoice.totals.grossCents;

  if (invoice.payments.length === 0) invoice.reconcileState = 'unmatched';
  else if (paidCents < gross) invoice.reconcileState = 'partial';
  else if (paidCents === gross) invoice.reconcileState = 'matched';
  else invoice.reconcileState = 'overpaid';

  if (invoice.status === 'paid' && paidCents < gross) {
    invoice.status = 'sent';
    invoice.paidAt = null;
  }
  await invoice.save();
}

/** True only when this module is the process entrypoint, so tests can import safely. */
export function isCliEntrypoint(argv1: string | undefined): boolean {
  return typeof argv1 === 'string' && /cron[\\/]reconcile(\.js|\.ts)?$/.test(argv1);
}
