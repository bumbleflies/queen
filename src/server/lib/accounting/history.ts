import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { BANK, type BankBookingMode, type PostingLine } from './postingRules';
import { normalizeIban, suggest, type SuggestSupplier, type SuggestTx, type Suggestion } from './suggest';

export interface HistoryEntry {
  account: string;
  vatRate: number;
  mode: BankBookingMode;
  date: Date;
}
export type BookingHistory = Map<string, HistoryEntry[]>;

const VAT_RATE_BY_ACCOUNT: Record<string, number> = {
  '1406': 0.19,
  '3806': 0.19,
  '1401': 0.07,
  '3801': 0.07,
};
const REVERSE_CHARGE_ACCOUNTS = ['1407', '3837'];
const HISTORY_DEPTH = 3;

/** Reads account / VAT rate / mode back out of the posted lines of a bank booking. */
export function deriveBooking(lines: PostingLine[]): { account: string; vatRate: number; mode: BankBookingMode } | null {
  const rest = lines.filter((l) => l.account !== BANK);
  if (rest.length === 0) return null;
  const reverseCharge = rest.some((l) => REVERSE_CHARGE_ACCOUNTS.includes(l.account));
  const expense = rest.filter((l) => !(l.account in VAT_RATE_BY_ACCOUNT) && !REVERSE_CHARGE_ACCOUNTS.includes(l.account));
  const vat = rest.find((l) => l.account in VAT_RATE_BY_ACCOUNT);
  if (reverseCharge) {
    return expense.length === 1 ? { account: expense[0].account, vatRate: 0.19, mode: 'reverseCharge' } : null;
  }
  if (expense.length === 0) {
    return vat ? { account: '', vatRate: VAT_RATE_BY_ACCOUNT[vat.account], mode: 'vatOnly' } : null;
  }
  if (expense.length > 1) return null;
  return { account: expense[0].account, vatRate: vat ? VAT_RATE_BY_ACCOUNT[vat.account] : 0, mode: 'normal' };
}

/** `iban:<NORMALISED>`, else `name:<lowercased>`; placeholder names like "(unknown destination)" give null. */
export function historyKey(tx: Pick<SuggestTx, 'counterpartyIban' | 'counterpartyName'>): string | null {
  const iban = tx.counterpartyIban ? normalizeIban(tx.counterpartyIban) : '';
  if (iban) return `iban:${iban}`;
  const name = (tx.counterpartyName ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (name === '' || name.startsWith('(')) return null;
  return `name:${name}`;
}

const HISTORY_YEARS = 3;

/** The newest 3 active bank bookings per counterparty key, looking back at most 3 years from `now`. */
export async function loadHistory(now: Date = new Date()): Promise<BookingHistory> {
  const since = new Date(now);
  since.setFullYear(since.getFullYear() - HISTORY_YEARS);
  const entries = await JournalEntry.find({ 'source.kind': 'bank', active: true, date: { $gte: since } })
    .select('date lines source.refId')
    .sort({ date: -1, _id: -1 })
    .lean();
  const refIds = entries.flatMap((e) => (e.source?.refId ? [e.source.refId] : []));
  const txs = await BankTransaction.find({ fireflyJournalId: { $in: refIds } })
    .select('fireflyJournalId counterpartyName counterpartyIban')
    .lean();
  const keyByRef = new Map(txs.map((t) => [t.fireflyJournalId, historyKey(t)]));

  const history: BookingHistory = new Map();
  for (const e of entries) {
    const key = e.source?.refId ? keyByRef.get(e.source.refId) : null;
    if (!key) continue;
    const derived = deriveBooking(e.lines);
    if (!derived) continue;
    const list = history.get(key) ?? [];
    if (list.length < HISTORY_DEPTH) {
      list.push({ ...derived, date: e.date });
      history.set(key, list);
    }
  }
  return history;
}

/** Suggestion only when all (up to 3) past bookings of this counterparty agree. */
export function historySuggestion(tx: SuggestTx, history: BookingHistory): Suggestion | null {
  const key = historyKey(tx);
  const list = key ? history.get(key) : undefined;
  if (!list || list.length === 0) return null;
  const [first] = list;
  if (!list.every((h) => h.account === first.account && h.vatRate === first.vatRate && h.mode === first.mode)) return null;
  const newest = list.reduce((a, b) => (b.date > a.date ? b : a)).date;
  return {
    supplierName: (tx.counterpartyName ?? '').trim() || (tx.counterpartyIban ?? ''),
    account: first.account || undefined,
    vatRate: first.vatRate,
    mode: first.mode,
    matchedBy: 'history',
    lastBookedAt: newest,
  };
}

/** Rules first; otherwise what the same counterparty was booked to before. */
export function suggestWithHistory(
  tx: SuggestTx,
  suppliers: SuggestSupplier[],
  history: BookingHistory,
): Suggestion | null {
  return suggest(tx, suppliers) ?? historySuggestion(tx, history);
}
