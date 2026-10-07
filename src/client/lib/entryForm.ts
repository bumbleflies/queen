import { parseGermanAmount } from '../../server/lib/money';

export interface EntryFormRow {
  account: string;
  debit: string;
  credit: string;
}

export interface EntryLine {
  account: string;
  debitCents: number;
  creditCents: number;
}

export interface EntryFormError {
  row: number;
  code: 'noAccount' | 'bothSides' | 'noAmount' | 'badAmount' | 'notPositive';
  raw?: string;
}

/** Form rows → ledger lines + running totals; errors carry the 1-based row and a code. */
export function toEntryLines(rows: EntryFormRow[]): {
  lines: EntryLine[];
  debitCents: number;
  creditCents: number;
  errors: EntryFormError[];
} {
  const lines: EntryLine[] = [];
  const errors: EntryFormError[] = [];
  let debitCents = 0;
  let creditCents = 0;

  rows.forEach((row, i) => {
    const n = i + 1;
    const account = row.account.trim();
    const debit = row.debit.trim();
    const credit = row.credit.trim();
    if (!account && !debit && !credit) return;
    if (!account) return void errors.push({ row: n, code: 'noAccount' });
    if (debit && credit) return void errors.push({ row: n, code: 'bothSides' });
    if (!debit && !credit) return void errors.push({ row: n, code: 'noAmount' });
    const raw = debit || credit;
    let cents: number;
    try {
      cents = parseGermanAmount(raw);
    } catch {
      return void errors.push({ row: n, code: 'badAmount', raw });
    }
    if (cents <= 0) return void errors.push({ row: n, code: 'notPositive' });
    if (debit) {
      lines.push({ account, debitCents: cents, creditCents: 0 });
      debitCents += cents;
    } else {
      lines.push({ account, debitCents: 0, creditCents: cents });
      creditCents += cents;
    }
  });

  return { lines, debitCents, creditCents, errors };
}
