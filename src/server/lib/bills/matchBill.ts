/**
 * Does a bill that arrived by e-mail belong to a bank transaction?
 * Pure and deliberately strict: the amount must match exactly and the payment
 * may not predate the bill. Everything else only raises the score, so a
 * suggestion is possible without pretending to be certain — and two equally
 * good candidates produce no match at all.
 */
export interface BillLike {
  grossCents: number | null;
  iban: string;
  vendorName: string;
  invoiceNumber: string;
  receivedAt: Date;
  dueDate: Date | null;
}

export interface TxLike {
  _id?: unknown;
  date: Date;
  amountCents: number;
  direction: 'in' | 'out' | string;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description?: string | null;
}

const DAY = 24 * 60 * 60 * 1000;
/** A bill cannot be paid before it was sent, and is rarely paid months after it was due. */
const EARLY_DAYS = 3;
const LATE_DAYS = 60;

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/)
    .filter((t) => t.length >= 3);
}

/** 0 = not this bill. Higher = more of the bill is confirmed by the payment. */
export function billMatchScore(bill: BillLike, tx: TxLike): number {
  if (tx.direction !== 'out') return 0;
  if (!bill.grossCents || bill.grossCents !== tx.amountCents) return 0;

  const start = bill.receivedAt.getTime() - EARLY_DAYS * DAY;
  if (tx.date.getTime() < start) return 0;

  const end = (bill.dueDate ?? bill.receivedAt).getTime() + LATE_DAYS * DAY;
  let score = 4;
  if (tx.date.getTime() <= end) score += 1;

  const iban = bill.iban.replace(/\s/g, '').toUpperCase();
  if (iban && tx.counterpartyIban && tx.counterpartyIban.replace(/\s/g, '').toUpperCase() === iban) {
    score += 3;
  }

  const invoice = squash(bill.invoiceNumber);
  if (invoice.length >= 3 && squash(tx.description ?? '').includes(invoice)) {
    score += 3;
  }

  const counterparty = nameTokens(tx.counterpartyName ?? '');
  if (counterparty.length > 0 && nameTokens(bill.vendorName).some((t) => counterparty.includes(t))) {
    score += 1;
  }

  return score;
}

/** The one bill this transaction pays, or null when none or several fit equally well. */
export function bestBillForTransaction<T extends BillLike>(bills: T[], tx: TxLike): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let tied = false;
  for (const bill of bills) {
    const score = billMatchScore(bill, tx);
    if (score === 0) continue;
    if (score > bestScore) {
      best = bill;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** The payment this bill was settled by, or null when none or several fit equally well. */
export function bestTransactionForBill<T extends TxLike>(bill: BillLike, txs: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  let tied = false;
  for (const tx of txs) {
    const score = billMatchScore(bill, tx);
    if (score === 0) continue;
    if (score > bestScore) {
      best = tx;
      bestScore = score;
      tied = false;
    } else if (score === bestScore) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** Result of linking a bill to the bank transaction that settled it. */
export interface LinkResult {
  txId: string;
  matchMethod: 'amount' | 'iban+purpose';
  /** Bill gross minus transaction amount when they differ (iban+purpose match only). */
  amountMismatch: number | null;
}

/**
 * Link a bill to its settling bank transaction, two grades:
 *
 * 1. `amount` — exact amount, unambiguous (today's rule).
 * 2. `iban+purpose` — IBAN equal AND the bill's invoice number appears in the
 *    transaction's Verwendungszweck, unambiguous. Amounts may differ (partial
 *    payment, different line item); the difference is recorded as
 *    `amountMismatch`.
 *
 * Ties within a grade produce no link. A manual link (from the UI) always wins
 * over an automatic one and is never overwritten by a rematch.
 */
export function linkBillToTransaction(bill: BillLike, txs: TxLike[]): LinkResult | null {
  // Grade 1: exact amount.
  const amountMatch = bestTransactionForBill(bill, txs);
  if (amountMatch && amountMatch._id) {
    return { txId: String(amountMatch._id), matchMethod: 'amount', amountMismatch: null };
  }

  // Grade 2: IBAN equal + invoice number in purpose.
  const iban = bill.iban.replace(/\s/g, '').toUpperCase();
  const invoice = squash(bill.invoiceNumber);
  if (!iban || invoice.length < 3) return null;

  const start = bill.receivedAt.getTime() - EARLY_DAYS * DAY;
  const end = (bill.dueDate ?? bill.receivedAt).getTime() + LATE_DAYS * DAY;
  const candidates: TxLike[] = [];
  for (const tx of txs) {
    if (tx.direction !== 'out') continue;
    if (!tx.counterpartyIban) continue;
    if (tx.counterpartyIban.replace(/\s/g, '').toUpperCase() !== iban) continue;
    if (tx.date.getTime() < start || tx.date.getTime() > end) continue;
    if (!squash(tx.description ?? '').includes(invoice)) continue;
    candidates.push(tx);
  }
  if (candidates.length !== 1) return null;

  const tx = candidates[0];
  return {
    txId: String(tx._id),
    matchMethod: 'iban+purpose',
    amountMismatch: bill.grossCents ? bill.grossCents - tx.amountCents : null,
  };
}
