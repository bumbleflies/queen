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

/** Form rows → ledger lines + running totals; errors name the 1-based row. */
export function toEntryLines(rows: EntryFormRow[]): {
  lines: EntryLine[];
  debitCents: number;
  creditCents: number;
  errors: string[];
} {
  const lines: EntryLine[] = [];
  const errors: string[] = [];
  let debitCents = 0;
  let creditCents = 0;

  rows.forEach((row, i) => {
    const n = i + 1;
    const account = row.account.trim();
    const debit = row.debit.trim();
    const credit = row.credit.trim();
    if (!account && !debit && !credit) return;
    if (!account) return void errors.push(`Zeile ${n}: Konto fehlt`);
    if (debit && credit) return void errors.push(`Zeile ${n}: entweder Soll oder Haben`);
    if (!debit && !credit) return void errors.push(`Zeile ${n}: Betrag fehlt`);
    const raw = debit || credit;
    let cents: number;
    try {
      cents = parseGermanAmount(raw);
    } catch {
      return void errors.push(`Zeile ${n}: Betrag „${raw}“ ungültig`);
    }
    if (cents <= 0) return void errors.push(`Zeile ${n}: Betrag muss positiv sein`);
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
