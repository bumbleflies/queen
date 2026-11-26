import { parseBillText, parseAmountToken, parseGermanDate, type ParsedBill } from '../bills/parseBill';
import { splitGross } from '../accounting/postingRules';

/** What a forwarded receipt says, plus the facts an expense claim needs. */
export interface ParsedClaim extends ParsedBill {
  /** Receipt date from the document; null when it states none. */
  date: Date | null;
  /** SKR04 expense account an admin picked; null until one is chosen. */
  account?: string | null;
  addressedToCompany: boolean;
  /** 'EUR' or 'other'; a foreign receipt queues instead of being booked. */
  currency: string;
}

export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Vorsteuer is only deductible when the document names the company as recipient. */
export function isAddressedToCompany(text: string): boolean {
  return /bumbleflies/i.test(text);
}

// Same shapes `parseBill` uses: the mark may sit before or after the number.
const CURRENCY_AMOUNT = /(?<![\d/.,-])-?\d[\d.,]*\s*(?:EUR|€)|(?:EUR|€)\s*(?<![\d/.,-])-?\d[\d.,]*/gi;
const YEAR = /^(?:19|20|21)\d{2}$/;

/**
 * Largest amount the receipt states in EUR. Used only when the bill parser
 * found no labelled total: on a receipt, the amount to reimburse is the gross,
 * and the largest figure on the page is the only safe candidate. A wrong guess
 * does not book — the VAT reconciliation in `isConfidentClaim` then fails and
 * the claim queues.
 */
function largestEurAmountCents(text: string): number | null {
  let biggest: number | null = null;
  for (const match of text.matchAll(CURRENCY_AMOUNT)) {
    const token = match[0].replace(/EUR|€/gi, '').trim();
    if (YEAR.test(token)) continue;
    const cents = parseAmountToken(token);
    if (cents !== null && (biggest === null || Math.abs(cents) > Math.abs(biggest))) biggest = cents;
  }
  return biggest;
}

/** The bill read plus who the document is addressed to and in which currency. */
export function parseExpenseText(text: string, opts: { fromName?: string } = {}): ParsedClaim {
  const parsed = parseBillText(text, opts);
  const foreign = /(\bUSD\b|\bCHF\b|\bGBP\b|\$|£)/i.test(text);
  return {
    ...parsed,
    date: receiptDate(text),
    grossCents: parsed.grossCents ?? largestEurAmountCents(text),
    addressedToCompany: isAddressedToCompany(text),
    currency: foreign ? 'other' : 'EUR',
  };
}

// A receipt states its own date far more often than an invoice states a due date.
// Only an explicit receipt/issue qualifier is allowed after `date`: "Date Paid:"
// and "Date issued:" are real, while "Updated:" and bare `datum` inside another
// word are not.
const RECEIPT_DATE =
  /(?<!\w)(?:rechnungsdatum|belegdatum|datum|date)(?:\s+(?:paid|issued))?\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/i;
const NOT_RECEIPT_DATE = /\b(?:due|fällig|zahlbar|payment|updated)\b/i;

function receiptDate(text: string): Date | null {
  for (const line of text.split(/\r?\n/)) {
    if (NOT_RECEIPT_DATE.test(line)) continue;
    const match = line.match(RECEIPT_DATE);
    if (match) return parseGermanDate(match[1]);
  }
  return null;
}

const EXPENSE_ACCOUNT = /^[67]\d{3}$/;
/** Tax accounts are not expenses: booking there would move a tax, not a cost. */
const TAX_ACCOUNTS = new Set(['7600', '7608', '7610', '7641']);

export interface ConfidenceInput {
  parse: ParsedClaim;
  founderActive: boolean;
  account: string | null;
  accountExists: boolean;
  limitCents: number;
  yearClosed: boolean;
  duplicate: boolean;
  reverseChargeNeedsCompany?: boolean;
}

export interface ConfidenceResult {
  ok: boolean;
  reasons: string[];
  vatDeductible: boolean;
  /** Gross to the expense account, no Vorsteuer. */
  grossOnly: boolean;
}

/**
 * The complete-read predicate. Auto-book only when this says ok.
 * `grossOnly` is true when VAT is stated but the invoice is not addressed to
 * bumbleflies: booking the gross is conservative and never over-claims input tax.
 */
export function isConfidentClaim(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  const p = input.parse;
  const gross = p.grossCents ?? 0;

  if (!input.founderActive) reasons.push('Gesellschafter inaktiv');
  if (p.currency !== 'EUR') reasons.push('Fremdwährung');
  if (gross <= 0) reasons.push('Betrag fehlt');
  if (gross > input.limitCents) reasons.push('über Auto-Buchungsgrenze');
  if (input.duplicate) reasons.push('mögliches Duplikat');
  if (input.yearClosed) reasons.push('Geschäftsjahr abgeschlossen');
  if (!input.account || !EXPENSE_ACCOUNT.test(input.account) || TAX_ACCOUNTS.has(input.account)) {
    reasons.push('kein Aufwandskonto');
  } else if (!input.accountExists) {
    reasons.push('Konto unbekannt');
  }
  // No printed receipt date is not a reason to queue: the intake books on the
  // day the mail arrived (`periodOf(parsed.date ?? receivedAt)`).
  if (p.reverseCharge && input.reverseChargeNeedsCompany && !p.addressedToCompany) {
    reasons.push('§13b ohne Rechnung an bumbleflies');
  }

  // VAT only when the document names bumbleflies and the figures reconcile.
  const hasVat = typeof p.vatCents === 'number' && p.vatCents > 0;
  const rateOk = p.vatRate === 0.19 || p.vatRate === 0.07;
  let vatDeductible = false;
  if (hasVat) {
    const net = p.netCents ?? gross - p.vatCents!;
    const reconciling = Math.abs(net + p.vatCents! - gross) <= 1;
    if (!rateOk) reasons.push('USt-Satz unklar');
    if (!reconciling) reasons.push('Netto/USt/Brutto stimmen nicht');
    vatDeductible = rateOk && reconciling && p.addressedToCompany;
  }

  // A half-read VAT (rate without amount or vice versa) is not confident.
  if (p.vatRate && p.vatRate > 0 && !hasVat) reasons.push('USt unvollständig');

  return { ok: reasons.length === 0, reasons, vatDeductible, grossOnly: !vatDeductible };
}

/** Net/VAT split used when the document does not state them. */
export function grossSplit(grossCents: number, vatRate: number) {
  return splitGross(grossCents, vatRate);
}

/**
 * The single merge point: an admin correction wins field by field over the PDF
 * read; an explicit null in the correction clears a value the read got wrong.
 * The values may arrive as Mongoose subdocuments (`correct`) or as plain lean
 * objects (`list`), so unwrap them before spreading — a raw subdocument spreads
 * its internals, not its fields.
 */
function plainFields(value: unknown): Record<string, unknown> {
  if (!value) return {};
  const candidate = value as { toObject?: () => Record<string, unknown> };
  if (typeof candidate.toObject === 'function') return candidate.toObject();
  return value as Record<string, unknown>;
}

export function claimFieldsOf(claim: { parse?: unknown; corrected?: unknown }): ParsedClaim | null {
  if (!claim.parse && !claim.corrected) return null;
  const parsed = plainFields(claim.parse);
  const corrected = Object.fromEntries(
    Object.entries(plainFields(claim.corrected)).filter(([, value]) => value !== undefined),
  );
  return { ...parsed, ...corrected } as unknown as ParsedClaim;
}
