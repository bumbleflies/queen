import type { PostingLine } from './postingRules';

export interface BalanceRow {
  account: string;
  debitCents: number;
  creditCents: number;
  /** debit − credit; negative = credit balance */
  balanceCents: number;
}

/** Summen- und Saldenliste. Reversed entries and their reversals both count and net out. */
export function trialBalance(entries: { lines: PostingLine[] }[]): {
  rows: BalanceRow[];
  debitCents: number;
  creditCents: number;
} {
  const byAccount = new Map<string, BalanceRow>();
  let debitCents = 0;
  let creditCents = 0;
  for (const entry of entries) {
    for (const l of entry.lines) {
      const row = byAccount.get(l.account) ?? {
        account: l.account,
        debitCents: 0,
        creditCents: 0,
        balanceCents: 0,
      };
      row.debitCents += l.debitCents;
      row.creditCents += l.creditCents;
      row.balanceCents = row.debitCents - row.creditCents;
      byAccount.set(l.account, row);
      debitCents += l.debitCents;
      creditCents += l.creditCents;
    }
  }
  const rows = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
  return { rows, debitCents, creditCents };
}

export interface LedgerEntryLike {
  _id: unknown;
  entryNumber: string;
  date: Date;
  text: string;
  lines: PostingLine[];
}

export interface LedgerRow {
  entryId: string;
  entryNumber: string;
  date: Date;
  text: string;
  debitCents: number;
  creditCents: number;
  runningCents: number;
}

/** Kontoblatt: entries touching `account`, by date then number, with running balance. */
export function accountLedger(account: string, entries: LedgerEntryLike[]): LedgerRow[] {
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime() ||
      a.entryNumber.localeCompare(b.entryNumber),
  );
  const rows: LedgerRow[] = [];
  let running = 0;
  for (const entry of sorted) {
    const mine = entry.lines.filter((l) => l.account === account);
    if (mine.length === 0) continue;
    const debitCents = mine.reduce((s, l) => s + l.debitCents, 0);
    const creditCents = mine.reduce((s, l) => s + l.creditCents, 0);
    running += debitCents - creditCents;
    rows.push({
      entryId: String(entry._id),
      entryNumber: entry.entryNumber,
      date: entry.date,
      text: entry.text,
      debitCents,
      creditCents,
      runningCents: running,
    });
  }
  return rows;
}
