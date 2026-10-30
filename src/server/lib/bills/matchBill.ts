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
