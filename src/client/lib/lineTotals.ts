import { invoiceTotals, type InvoiceTotals } from '../../server/lib/money';

/** One line as held by the editor: amounts in euros (may be negative). */
export interface EditorLine {
  position: string;
  description: string;
  quantity: number;
  unitNetEuros: number;
  vatRate: number;
  vatNote?: string;
}

export interface VatBucket {
  rate: number;
  netCents: number;
  vatCents: number;
}

export function eurosToCents(euros: number): number {
  return Math.round((Number(euros) || 0) * 100);
}

export function lineNetCents(line: Pick<EditorLine, 'quantity' | 'unitNetEuros'>): number {
  return Math.round((Number(line.quantity) || 0) * eurosToCents(line.unitNetEuros));
}

/** Net/VAT/gross for a set of editor lines, matching the server's per-line
 *  half-up VAT rounding (Task 3 invariant). */
export function computeTotals(lines: EditorLine[]): InvoiceTotals {
  return invoiceTotals(
    lines.map((l) => ({
      quantity: Number(l.quantity) || 0,
      unitNetCents: eurosToCents(l.unitNetEuros),
      vatRate: l.vatRate,
    })),
  );
}

/** Net + VAT per VAT rate, sorted high → low (matches the mock ordering). */
export function vatBreakdown(lines: EditorLine[]): VatBucket[] {
  const byRate = new Map<number, VatBucket>();
  for (const line of lines) {
    const net = lineNetCents(line);
    const rate = line.vatRate;
    const bucket = byRate.get(rate) ?? { rate, netCents: 0, vatCents: 0 };
    bucket.netCents += net;
    bucket.vatCents += Math.round(net * rate);
    byRate.set(rate, bucket);
  }
  return [...byRate.values()].sort((a, b) => b.rate - a.rate);
}
