/**
 * Text normalisation shared by rule matching, history and receipt reading.
 *
 * Pure helpers only: the client imports them (rule preview, booking dialog), so
 * this module must never reach a model, a service or a node-only package.
 */

export function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

/** Vendors compared case- and punctuation-insensitively ("Augustiner-Keller GmbH" vs "Augustiner Keller"). */
export function normalizeVendor(vendor: string | null | undefined): string {
  return (vendor ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
