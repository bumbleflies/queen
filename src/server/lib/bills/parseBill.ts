import { parseGermanAmount } from '../money';

/**
 * What a vendor invoice PDF (or the mail that carried it) tells us.
 * Everything is optional on purpose: a field we cannot read stays empty and the
 * bill is flagged, rather than guessed. No VAT rate is ever assumed.
 */
export interface ParsedBill {
  vendorName: string;
  invoiceNumber: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  vatRate: number | null;
  iban: string;
  dueDate: Date | null;
  reverseCharge: boolean;
}

export interface BillHints {
  /** Display name from the mail's `From` header — more reliable than PDF letterheads. */
  fromName?: string;
}

const GROSS_LABEL =
  /(?:summe\s*brutto|bruttobetrag|gesamtbetrag|rechnungsbetrag|endbetrag|zahlbetrag|zu\s*zahlen(?:der\s*beitrag|der\s*betrag)?|\btotal\b(?:\s*(?:amount|due|in\s*eur|eur))?|amount\s*due|balance\s*due|grand\s*total)/i;
const NET_LABEL = /(?:summe\s*netto|nettobetrag|netto(?:summe|betrag)?)/i;
// Word boundaries matter: "Industriestr." and "Musterfirma" both contain "ust".
const VAT_LABEL = /(?:\bust\.?|\bmwst\.?|umsatzsteuer|\bvat\b|\btax\b)/i;
const REVERSE_CHARGE = /reverse[-\s]?charge|§\s*13\s*b|steuerschuldnerschaft\s*des\s*leistungsempf/i;
const ANY_LABEL = new RegExp(`${GROSS_LABEL.source}|${NET_LABEL.source}|${VAT_LABEL.source}`, 'i');

// Company legal forms: a line carrying one of these is the letterhead vendor,
// not an address or a line item. Preferred over the mail's From header for
// forwarded mails, where the sender is the forwarder, not the vendor.
const COMPANY_SUFFIX = /\b(GmbH|AG|UG|e\.?G|e\.?K|SE|Ltd|Limited|LLC|Inc|Corp|Corporation|OHG|KG|mbH|GmbH\s*&\s*Co\.?|e\.?V\.?|Foundation)\b/i;

// A line that is itself a line item (quantity × unit price) must never be
// read as the gross total.
const LINE_ITEM = /(?:stck|stück|anzahl|menge|qty|quantity)\b|^\s*\d+\s+zu\s+\d[\d.,]*\s*€?/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * One amount token to integer cents, German and English forms both.
 * Unambiguous by construction: a lone dot with one or two decimals is a decimal
 * separator (`119.00`), with three digits it is a thousands separator (`1.234`);
 * a lone comma behaves the same way. Anything else is `null`, never a guess.
 */
export function parseAmountToken(token: string): number | null {
  const t = token.trim().replace(/[€\s\u00a0]/g, '').replace(/^−/, '-');
  if (!/\d/.test(t) || !/^-?[\d.,]+$/.test(t)) return null;
  const negative = t.startsWith('-');
  const body = negative ? t.slice(1) : t;
  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  let german: string;
  if (dots && commas) {
    const decimal = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    const parts = body.split(decimal);
    if (parts.length !== 2) return null;
    const [int, dec] = parts;
    if (!/^\d{1,3}(?:\D\d{3})*$/.test(int) || !/^\d{1,2}$/.test(dec)) return null;
    german = `${int.split(thousands).join('')},${dec}`;
  } else if (dots || commas) {
    const sep = dots ? '.' : ',';
    const count = dots || commas;
    if (count > 1) {
      // Only thousands separators: groups of exactly three digits.
      if (!new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})+$`).test(body)) return null;
      german = body.split(sep).join('');
    } else {
      const [int, dec] = body.split(sep);
      if (dec.length === 3) {
        if (!/^\d{1,3}$/.test(int)) return null;
        german = `${int}${dec}`;
      } else if (dec.length >= 1 && dec.length <= 2) {
        german = `${int},${dec}`;
      } else {
        return null;
      }
    }
  } else {
    german = body;
  }

  try {
    return parseGermanAmount(`${negative ? '-' : ''}${german}`);
  } catch {
    return null;
  }
}

/** First currency amount on the line, else its last bare amount. */
function amountOnLine(line: string): number | null {
  const withCurrency = line.match(/(-?\d[\d.,]*)\s*(?:EUR|€)/i);
  if (withCurrency) return parseAmountToken(withCurrency[1]);
  const bare = line.match(/-?\d[\d.,]*/g);
  if (!bare) return null;
  for (const token of [...bare].reverse()) {
    const cents = parseAmountToken(token);
    if (cents !== null) return cents;
  }
  return null;
}

/** First bare amount that carries decimals (real money), else the first bare amount.
 * Used for value-before-label gross so a bare day/year on the same line isn't
 * mistaken for the total. */
function moneyAmountOnLine(line: string): number | null {
  const withCurrency = line.match(/(-?\d[\d.,]*)\s*(?:EUR|€)/i);
  if (withCurrency) return parseAmountToken(withCurrency[1]);
  const bare = line.match(/-?\d[\d.,]*/g);
  if (!bare) return null;
  for (const token of bare) {
    if (/[.,]/.test(token)) {
      const cents = parseAmountToken(token);
      if (cents !== null) return cents;
    }
  }
  for (const token of bare) {
    const cents = parseAmountToken(token);
    if (cents !== null) return cents;
  }
  return null;
}

function parseGermanDate(token: string): Date | null {
  const german = token.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (german) {
    const day = Number(german[1]);
    const month = Number(german[2]);
    const year = german[3].length === 2 ? 2000 + Number(german[3]) : Number(german[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    return null;
  }
  const iso = token.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const english = token.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (english) {
    const month = MONTHS[english[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    const date = new Date(Number(english[3]), month - 1, Number(english[2]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** IBAN with its label, spaces stripped; '' when the label is missing or the value is malformed. */
function findIban(text: string): string {
  const match = text.match(/IBAN[:\s]*((?:[A-Z]{2}\d{2})(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)/i);
  if (!match) return '';
  const iban = match[1].replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : '';
}

function cleanVendorName(value: string): string {
  // `"Hetzner Online GmbH" <billing@hetzner.com>` → `Hetzner Online GmbH`
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/["']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function vendorFromText(lines: string[]): string {
  // First pass: prefer a line that carries a company legal form (the letterhead).
  for (const raw of lines.slice(0, 40)) {
    const line = raw.trim();
    if (line.length < 3) continue;
    if (ANY_LABEL.test(line)) continue;
    if (/^(?:rechnung|invoice|beleg|seite|page|datum|date)\b/i.test(line)) continue;
    if (/^[\d.,\s/~#-]+$/.test(line)) continue;
    if (COMPANY_SUFFIX.test(line)) return cleanVendorName(line).slice(0, 120);
  }
  // Fallback: first plausible vendor line without a company suffix.
  for (const raw of lines.slice(0, 12)) {
    const line = raw.trim();
    if (line.length < 3) continue;
    if (ANY_LABEL.test(line)) continue;
    if (/^(?:rechnung|invoice|beleg|seite|page|datum|date)\b/i.test(line)) continue;
    if (/^[\d.,\s/~#-]+$/.test(line)) continue;
    return cleanVendorName(line).slice(0, 120);
  }
  return '';
}

/**
 * Read the fields of a vendor invoice from its PDF text layer. Conservative:
 * only labelled values are taken, unknown stays empty.
 */
export function parseBillText(text: string, hints: BillHints = {}): ParsedBill {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let grossCents: number | null = null;
  let netCents: number | null = null;
  let vatCents: number | null = null;
  let vatRate: number | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const next = lines[i + 1] ?? '';
    const isLineItem = LINE_ITEM.test(line);

    // Value before label: "49,15\nBrutto-Rechnungsbetrag" — the amount sits on
    // the line right before the gross label. Only when this line isn't itself a
    // line item or another amount label (net/VAT), and carries a real money
    // amount (decimals or currency) — never a bare date or year.
    if (
      !isLineItem &&
      grossCents === null &&
      !GROSS_LABEL.test(line) &&
      !NET_LABEL.test(line) &&
      !VAT_LABEL.test(line) &&
      /\d[.,]\d{1,2}/.test(line) &&
      GROSS_LABEL.test(next)
    ) {
      const cents = moneyAmountOnLine(line);
      if (cents !== null) grossCents ??= cents;
    }

    if (GROSS_LABEL.test(line) && !isLineItem) {
      const cents = amountOnLine(line) ?? (next ? amountOnLine(next) : null);
      if (cents !== null) grossCents ??= cents;
      continue;
    }
    if (NET_LABEL.test(line)) {
      const cents = amountOnLine(line) ?? (next ? amountOnLine(next) : null);
      if (cents !== null) netCents ??= cents;
      continue;
    }
    if (VAT_LABEL.test(line)) {
      const percent = line.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*%/);
      if (percent) {
        const rate = Number(percent[1].replace(',', '.'));
        if (rate >= 0 && rate <= 100) vatRate ??= rate / 100;
      }
      const cents = amountOnLine(line);
      if (cents !== null) vatCents ??= cents;
    }
  }

  const reverseCharge = REVERSE_CHARGE.test(text);
  if (reverseCharge) {
    vatRate ??= 0;
    vatCents ??= 0;
  }
  if (grossCents === null && netCents !== null && vatCents !== null) grossCents = netCents + vatCents;

  // Header lines like "#####Rechnung~98848178~103855369~24.08.26": the middle
  // run of 6+ digits between tildes is the invoice number.
  const INVOICE_HEADER = /~\s*(\d{6,})\s*~/;
  // "Belegnr. 98848178" — German for invoice number.
  const BELEG_NR = /belegnr\.?\s*:?\s*(\d{5,})/i;

  let invoiceNumber = '';
  const labeled = text.match(
    /(?:rechnungsnummer|rechnungs-?nr\.?|invoice\s*(?:no\.?|number|#)|belegnummer|bill\s*(?:no\.?|number))[\s:#]*([A-Za-z0-9][A-Za-z0-9._/-]{1,39})/i,
  );
  if (labeled && !/^(?:rechnung|invoice|beleg|schein|quittung|rechnungsdatum|datum)$/i.test(labeled[1])) {
    invoiceNumber = labeled[1];
  }
  if (!invoiceNumber) {
    const m = text.match(INVOICE_HEADER);
    if (m) invoiceNumber = m[1];
  }
  if (!invoiceNumber) {
    const m = text.match(BELEG_NR);
    if (m) invoiceNumber = m[1];
  }

  const dueMatch = text.match(
    /(?:fällig(?:keitsdatum|keit|am)?|zahlbar\s*bis|payment\s*due|due\s*date)[\s:]*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i,
  );

  const fromName = hints.fromName ? cleanVendorName(hints.fromName) : '';

  return {
    // Letterhead first: the mail's From header is the forwarder on forwarded
    // mails (Fwd:/WG:/AW:), not the vendor. Fall back to the sender only when
    // the PDF text has no vendor line at all.
    vendorName: vendorFromText(lines) || fromName,
    invoiceNumber,
    grossCents,
    netCents,
    vatCents,
    vatRate,
    iban: findIban(text),
    dueDate: dueMatch ? parseGermanDate(dueMatch[1]) : null,
    reverseCharge,
  };
}
