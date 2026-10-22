import { BANK, BANK_VAT_RATES, REVERSE_CHARGE_RATE, type SplitPart } from './postingRules';
import { suggestWithHistory, type BookingHistory } from './history';
import type { SuggestSupplier, SuggestTx, Suggestion } from './suggest';

export interface ReceiptLine {
  vatRate: number;
  grossCents: number;
  account: string;
}

export interface ReceiptReading {
  vendor: string;
  country: string | null;
  date: string | null;
  totalCents: number;
  reverseCharge: boolean;
  lines: ReceiptLine[];
}

/** IBAN token after an "IBAN" label: any grouping, spaces or hyphens; chunks carry a digit or are ≤ 4 capitals (not BIC/SWIFT). */
const LABELLED_IBAN =
  /(\b(?:IBAN|Iban|iban)\b[ \t]*[:.]?[ \t]*)[A-Za-z]{2}[ \t-]?\d{2}(?:[ \t-]{0,2}(?!(?:BIC|SWIFT)\b)(?:[A-Za-z0-9]*\d[A-Za-z0-9]*|[A-Z]{1,4}\b))*/g;
/** Unlabelled IBANs: the constraint's pattern widened to lowercase and single/double spaces or hyphens. */
const IBAN = /\b[A-Za-z]{2}\d{2}(?:[ \t-]{0,2}[A-Za-z0-9]{4}){2,7}(?:[ \t-]{0,2}[A-Za-z0-9]{1,4})?\b/g;
/** BICs after "BIC", "BIC:", "BIC/SWIFT", "SWIFT", "SWIFT-BIC", "BIC (SWIFT)", "SWIFT-Code". */
const BIC =
  /(\b(?:BIC|SWIFT)(?:[ \t]*[/-][ \t]*(?:BIC|SWIFT))?(?:[ \t]*\((?:BIC|SWIFT)\))?(?:-Code)?[ \t]*[:.]?[ \t]*)[A-Za-z]{6}[A-Za-z0-9]{2}(?:[A-Za-z0-9]{3})?\b/gi;

/** Bank details never leave queen: IBANs → `[IBAN]`, BICs after "BIC"/"SWIFT" → `[BIC]`. */
export function maskBankData(text: string): string {
  return text.replace(LABELLED_IBAN, '$1[IBAN]').replace(BIC, '$1[BIC]').replace(IBAN, '[IBAN]');
}

/** Bank and VAT accounts are posted by the booking itself, never chosen for a receipt line. */
const NOT_FOR_RECEIPT_LINES = new Set([BANK, '1401', '1406', '1407', '3801', '3806', '3837']);

export function receiptAccounts<T extends { number: string }>(accounts: T[]): T[] {
  return accounts.filter((a) => !NOT_FOR_RECEIPT_LINES.has(a.number));
}

const MAX_TEXT = 12_000;

/** The receipt text (masked, truncated) plus queen's chart of accounts; asks for one strict JSON object. */
export function buildReceiptPrompt(text: string, accounts: { number: string; name: string }[]): string {
  const masked = maskBankData(text).slice(0, MAX_TEXT);
  return [
    'Du liest einen Beleg (Rechnung/Quittung) für die Buchhaltung einer deutschen GmbH (SKR04).',
    'Antworte NUR mit einem JSON-Objekt, ohne weiteren Text, in genau dieser Form:',
    '{ "vendor": string, "country": string | null, "date": "YYYY-MM-DD" | null, "totalCents": number, "reverseCharge": boolean,',
    '  "lines": [{ "vatRate": number, "grossCents": number, "account": string }] }',
    'Regeln:',
    '- Beträge in ganzen Cent (54,60 € → 5460). totalCents ist der Rechnungsbetrag brutto.',
    '- Eine Zeile pro Steuersatz und Konto; die grossCents aller Zeilen ergeben zusammen totalCents.',
    '- vatRate ist 0, 0.07 oder 0.19.',
    '- reverseCharge ist true, wenn die Rechnung auf die Steuerschuldnerschaft des Leistungsempfängers (§ 13b UStG, "reverse charge") verweist; dann vatRate 0.',
    '- country als ISO-Code des Rechnungsstellers (z. B. "DE", "IE"), sonst null.',
    '- account muss eine dieser Kontonummern sein:',
    ...accounts.map((a) => `  ${a.number} ${a.name}`),
    '',
    'Beleg:',
    '"""',
    masked,
    '"""',
  ].join('\n');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isCents = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** The one JSON object in a reply (prose and code fences around it allowed), validated against queen's accounts. */
export function parseReceiptReply(reply: string, accounts: Set<string>): ReceiptReading | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try {
    json = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!isRecord(json) || !isCents(json.totalCents) || !Array.isArray(json.lines) || json.lines.length === 0) return null;
  const lines: ReceiptLine[] = [];
  for (const l of json.lines) {
    if (!isRecord(l) || !isCents(l.grossCents) || typeof l.vatRate !== 'number') return null;
    if (!(BANK_VAT_RATES as readonly number[]).includes(l.vatRate)) return null;
    const account = typeof l.account === 'string' ? l.account.trim() : String(l.account ?? '');
    if (!accounts.has(account)) return null;
    lines.push({ vatRate: l.vatRate, grossCents: l.grossCents, account });
  }
  if (lines.reduce((s, l) => s + l.grossCents, 0) !== json.totalCents) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    vendor: str(json.vendor) ?? '',
    country: str(json.country),
    date: str(json.date),
    totalCents: json.totalCents,
    reverseCharge: json.reverseCharge === true,
    lines,
  };
}

/**
 * A reading as a booking suggestion: one account/rate → plain suggestion,
 * several → `split`. §13b always books 19 % and only outgoing. Null when the
 * receipt total is not the bank amount. `files` > 1 marks a set of receipts.
 */
export function readingToSuggestion(
  reading: ReceiptReading,
  tx: { amountCents: number; direction?: string | null; counterpartyName?: string | null },
  files = 1,
): Suggestion | null {
  if (reading.totalCents !== tx.amountCents) return null;
  if (reading.reverseCharge && tx.direction === 'in') return null;
  const mode: SplitPart['mode'] = reading.reverseCharge ? 'reverseCharge' : 'normal';
  const parts: SplitPart[] = [];
  for (const l of reading.lines) {
    const vatRate = reading.reverseCharge ? REVERSE_CHARGE_RATE : l.vatRate;
    const same = parts.find((p) => p.account === l.account && p.vatRate === vatRate);
    if (same) same.grossCents += l.grossCents;
    else parts.push({ account: l.account, vatRate, grossCents: l.grossCents, mode });
  }
  const base = {
    supplierName: reading.vendor || (tx.counterpartyName ?? '').trim(),
    mode,
    matchedBy: 'receipt' as const,
    reading: { vendor: reading.vendor, totalCents: reading.totalCents, lines: reading.lines, files: files > 1 ? files : undefined },
  };
  if (parts.length === 1) return { ...base, account: parts[0].account, vatRate: parts[0].vatRate };
  return { ...base, split: parts };
}

/** Vendors compared case- and punctuation-insensitively ("Augustiner-Keller GmbH" vs "Augustiner Keller"). */
export function normalizeVendor(vendor: string | null | undefined): string {
  return (vendor ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One parsed reading together with the file it came from. */
export interface ReadingEntry {
  fileId: string;
  fileName: string;
  reading: ReceiptReading;
}

/** Several readings as one: totals add up, lines merge per account and VAT rate. */
export function mergeReceiptReadings(readings: ReceiptReading[]): ReceiptReading {
  const lines: ReceiptLine[] = [];
  for (const r of readings) {
    for (const l of r.lines) {
      const same = lines.find((x) => x.account === l.account && x.vatRate === l.vatRate);
      if (same) same.grossCents += l.grossCents;
      else lines.push({ ...l });
    }
  }
  const [first] = readings;
  return {
    vendor: first?.vendor ?? '',
    country: first?.country ?? null,
    date: first?.date ?? null,
    totalCents: readings.reduce((s, r) => s + r.totalCents, 0),
    reverseCharge: first?.reverseCharge ?? false,
    lines,
  };
}

function* combinations<T>(items: T[], size: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length === size) {
    yield acc;
    return;
  }
  for (let i = start; i <= items.length - (size - acc.length); i++) {
    yield* combinations(items, size, i + 1, [...acc, items[i]]);
  }
}

/** At most three receipts make one transaction: more would be a data problem, not a booking. */
export const MAX_RECEIPTS = 3;

/**
 * The smallest set of readings whose totals are exactly the bank amount, with
 * one VAT treatment and vendors that agree with each other or with a hint
 * (transaction counterparty, suggestion supplier). Empty vendor = unknown.
 */
export function matchReceiptSet(
  entries: ReadingEntry[],
  amountCents: number,
  hints: (string | null | undefined)[] = [],
): { fileIds: string[]; reading: ReceiptReading } | null {
  const hintKeys = hints.map(normalizeVendor).filter((h) => h.length > 0);
  const vendorsAgree = (readings: ReceiptReading[]): boolean => {
    const keys = readings.map((r) => normalizeVendor(r.vendor)).filter((k) => k.length > 0);
    if (keys.length < 2) return true;
    const matchesHint = (k: string) => hintKeys.some((h) => k === h || k.includes(h) || h.includes(k));
    if (hintKeys.length > 0 && keys.every(matchesHint)) return true;
    return keys.every((k) => k === keys[0]);
  };

  for (let size = 1; size <= Math.min(entries.length, MAX_RECEIPTS); size++) {
    for (const combo of combinations(entries, size)) {
      const readings = combo.map((e) => e.reading);
      if (readings.reduce((s, r) => s + r.totalCents, 0) !== amountCents) continue;
      if (readings.some((r) => r.reverseCharge !== readings[0].reverseCharge)) continue;
      if (!vendorsAgree(readings)) continue;
      return { fileIds: combo.map((e) => e.fileId), reading: mergeReceiptReadings(readings) };
    }
  }
  return null;
}

/** What `BankTransaction.receiptReading` holds (Mongoose arrays included). */
export interface CachedReceiptReading {
  status?: string | null;
  /** Drive ids of the matched set (multi-receipt); absent for a legacy single reading. */
  driveFileIds?: string[] | null;
  reading?: {
    vendor?: string | null;
    country?: string | null;
    date?: string | null;
    totalCents?: number | null;
    reverseCharge?: boolean | null;
    lines?: Iterable<{ vatRate?: number | null; grossCents?: number | null; account?: string | null }> | null;
  } | null;
}

/** The cached reading of a transaction, when it was read successfully. */
export function cachedReading(cache: CachedReceiptReading | null | undefined): ReceiptReading | null {
  // A receiptMatch carries no status: the reading itself is the success.
  const r = cache?.status === 'ok' || (cache?.status == null && cache?.reading) ? cache.reading : null;
  if (!r || typeof r.totalCents !== 'number') return null;
  return {
    vendor: r.vendor ?? '',
    country: r.country ?? null,
    date: r.date ?? null,
    totalCents: r.totalCents,
    reverseCharge: !!r.reverseCharge,
    lines: [...(r.lines ?? [])].map((l) => ({ vatRate: l.vatRate ?? 0, grossCents: l.grossCents ?? 0, account: l.account ?? '' })),
  };
}

export type ReadableTx = SuggestTx & {
  amountCents: number;
  direction?: string | null;
  /** The matched set of receipts (multi-receipt). */
  receiptMatch?: CachedReceiptReading | null;
  /** Legacy single reading. */
  receiptReading?: CachedReceiptReading | null;
};

/** Suggestion order: rule → history → matched receipts (else a legacy single reading). */
export function suggestForTx(tx: ReadableTx, suppliers: SuggestSupplier[], history: BookingHistory): Suggestion | null {
  const fromRules = suggestWithHistory(tx, suppliers, history);
  if (fromRules) return fromRules;
  const reading = cachedReading(tx.receiptMatch) ?? cachedReading(tx.receiptReading);
  const files = tx.receiptMatch?.driveFileIds?.length ?? 1;
  return reading ? readingToSuggestion(reading, tx, files) : null;
}
