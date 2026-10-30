import type { ParsedBill } from './parseBill';

/** Characters Drive (and any filesystem) refuses in a file name. */
const UNSAFE = /[/\\:*?"<>|]/g;

function slug(value: string): string {
  return value
    // Control characters cannot appear in a Drive file name either.
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .replace(UNSAFE, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function germanAmount(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Receipt-friendly name for a bill PDF: date, vendor, invoice number, gross.
 * Deliberately shaped so `rankReceipts` scores it (date +2, amount +3, vendor
 * tokens +2) and the nightly receipt reader proposes it for the matching
 * outgoing bank transaction. Falls back to the original attachment name when
 * nothing was parsed, so the file is still a receipt.
 */
export function billFileName(parsed: ParsedBill | null, receivedAt: Date, fallback: string): string {
  const original = slug(fallback) || 'Beleg.pdf';
  if (!parsed) return original;
  const parts = [
    `${receivedAt.getFullYear()}-${String(receivedAt.getMonth() + 1).padStart(2, '0')}-${String(receivedAt.getDate()).padStart(2, '0')}`,
    slug(parsed.vendorName),
    slug(parsed.invoiceNumber),
    parsed.grossCents !== null ? germanAmount(parsed.grossCents) : '',
  ].filter((p) => p.length > 0);
  if (parts.length <= 1) return original;
  return `${parts.join(' ')}.pdf`;
}
