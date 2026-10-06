/** Money helpers — integer cents everywhere (GoBD/queen invariant). */

/**
 * Parse a German-formatted amount string into integer cents.
 * Handles '.' thousands separators, ',' decimal separator, optional '€'/spaces,
 * leading '-' (or U+2212 minus), plain ints ('900' → 90000) and one-decimal
 * ('9329,6' → 932960). Throws on unparseable input.
 */
export function parseGermanAmount(s: string): number {
  if (typeof s !== 'string') throw new Error(`Unparseable amount: ${String(s)}`);
  // Normalise: strip euro sign, whitespace (incl. NBSP/narrow NBSP), then minus variants.
  let t = s.replace(/[€\s  ]/g, '');
  t = t.replace(/^−/, '-');
  if (t.length === 0) throw new Error(`Unparseable amount: ${JSON.stringify(s)}`);
  if (!/^-?(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(t)) {
    throw new Error(`Unparseable amount: ${JSON.stringify(s)}`);
  }
  const normalised = t.replace(/\./g, '').replace(',', '.');
  const euros = Number(normalised);
  if (!Number.isFinite(euros)) throw new Error(`Unparseable amount: ${JSON.stringify(s)}`);
  return Math.round(euros * 100);
}

/**
 * Parse a Firefly III amount string into integer cents. Firefly emits plain
 * decimal strings with '.' as the decimal separator and no thousands
 * separators (e.g. "1071.00", "-12.34", "0") — unlike {@link parseGermanAmount}.
 * Throws on unparseable input.
 */
export function fireflyAmountToCents(s: string): number {
  if (typeof s !== 'string') throw new Error(`Unparseable amount: ${String(s)}`);
  const t = s.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) {
    throw new Error(`Unparseable amount: ${JSON.stringify(s)}`);
  }
  const cents = Math.round(Number(t) * 100);
  if (!Number.isFinite(cents)) throw new Error(`Unparseable amount: ${JSON.stringify(s)}`);
  return cents === 0 ? 0 : cents;
}

/** Net cents for one line; decimal quantities allowed. */
export function lineNetCents(quantity: number, unitNetCents: number): number {
  return Math.round(quantity * unitNetCents);
}

/**
 * VAT cents for one line, rounded half-up per line.
 * Note: Math.round rounds half toward +∞ (so e.g. −1.5 → −1 rather than −2);
 * we use Math.round for negatives too, as specified.
 */
export function lineVatCents(netCents: number, vatRate: number): number {
  return Math.round(netCents * vatRate);
}

export interface InvoiceLineInput {
  quantity: number;
  unitNetCents: number;
  vatRate: number;
  vatNote?: string;
}

export interface InvoiceTotals {
  netCents: number;
  vatCents: number;
  grossCents: number;
}

/** Sum per-line rounded VAT (VAT is computed per line, half-up, then summed). */
export function invoiceTotals(lines: InvoiceLineInput[]): InvoiceTotals {
  let netCents = 0;
  let vatCents = 0;
  for (const line of lines) {
    const net = lineNetCents(line.quantity, line.unitNetCents);
    netCents += net;
    vatCents += lineVatCents(net, line.vatRate);
  }
  return { netCents, vatCents, grossCents: netCents + vatCents };
}

/**
 * Format integer cents as de-DE EUR string (e.g. 4.855,20 € with NBSP).
 * NOTE: implemented manually instead of Intl.NumberFormat because the
 * runtime lacks de-DE locale data (supportedLocalesOf('de-DE') → []);
 * manual grouping is deterministic across runtimes (incl. PDF output).
 */
export function formatGermanEUR(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, '0');
  const grouped = euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}${grouped},${rest} €`;
}
