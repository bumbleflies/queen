import PDFDocument from 'pdfkit';
import { formatGermanEUR, invoiceTotals, lineNetCents, lineVatCents } from '../lib/money';

/** Minimal invoice shape needed for rendering (model docs satisfy this). */
export interface InvoiceLike {
  invoiceNumber: string;
  customerNumber: number;
  kind: 'invoice' | 'credit_note';
  title: string;
  invoiceAddress: string;
  invoiceDate?: Date | null;
  servicePeriod: string;
  paymentTermDays: number;
  dueDate?: Date | null;
  currency?: string;
  footerNotes?: string[] | null;
  /** Original invoice number for credit notes; resolved by the caller via `cancels`. */
  cancelsInvoiceNumber?: string | null;
}

/** Minimal invoice line shape needed for rendering (model docs satisfy this). */
export interface InvoiceLineLike {
  position: string;
  description: string;
  quantity: number;
  unitNetCents: number;
  vatRate: number;
  vatNote?: string | null;
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${d.getFullYear()}`;
}

function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : String(q).replace('.', ',');
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** Natural order for hierarchical positions ('1' < '1.1' < '2' < '10'). */
function comparePositions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** Group net/VAT cents by VAT rate, ascending. */
function vatBreakdown(lines: InvoiceLineLike[]): Array<{ rate: number; netCents: number; vatCents: number }> {
  const groups = new Map<number, { rate: number; netCents: number; vatCents: number }>();
  for (const line of lines) {
    const net = lineNetCents(line.quantity, line.unitNetCents);
    const group = groups.get(line.vatRate) ?? { rate: line.vatRate, netCents: 0, vatCents: 0 };
    group.netCents += net;
    group.vatCents += lineVatCents(net, line.vatRate);
    groups.set(line.vatRate, group);
  }
  return [...groups.values()].sort((a, b) => a.rate - b.rate);
}

/** Title line: credit notes reference their original invoice number. */
export function resolveInvoiceTitle(invoice: InvoiceLike): string {
  if (invoice.kind !== 'credit_note') return invoice.title;
  if (invoice.cancelsInvoiceNumber) return `Stornorechnung zu ${invoice.cancelsInvoiceNumber}`;
  const match = /Storno(?:rechnung)? zu (.+)$/.exec(invoice.title);
  return `Stornorechnung zu ${match ? match[1] : invoice.invoiceNumber}`;
}

/**
 * Deterministic plain-text representation of an invoice. Used by snapshot/content
 * tests and reused as the PDF body so the two never drift apart.
 */
export function renderInvoiceText(invoice: InvoiceLike, lines: InvoiceLineLike[]): string {
  const out: string[] = [];
  const sorted = [...lines].sort((a, b) => comparePositions(a.position, b.position));

  out.push(resolveInvoiceTitle(invoice));
  out.push('');
  out.push(invoice.invoiceAddress);
  out.push(`Rechnungsnummer: ${invoice.invoiceNumber}`);
  if (invoice.invoiceDate) out.push(`Rechnungsdatum: ${formatDate(invoice.invoiceDate)}`);
  out.push(`Leistungszeitraum: ${invoice.servicePeriod}`);
  out.push(`Zahlungsziel: ${invoice.paymentTermDays} Tage`);
  if (invoice.dueDate) out.push(`Fällig am: ${formatDate(invoice.dueDate)}`);
  out.push('');
  out.push(['Pos.', 'Beschreibung', 'Menge', 'Einzel netto', 'USt.', 'Netto'].join('\t'));
  for (const line of sorted) {
    const net = lineNetCents(line.quantity, line.unitNetCents);
    out.push(
      [
        line.position,
        line.description,
        formatQuantity(line.quantity),
        formatGermanEUR(line.unitNetCents),
        formatRate(line.vatRate),
        formatGermanEUR(net),
      ].join('\t'),
    );
    if (line.vatNote) out.push(`\t${line.vatNote}`);
  }

  out.push('');
  for (const group of vatBreakdown(sorted)) {
    out.push(
      `USt. ${formatRate(group.rate)}: ${formatGermanEUR(group.vatCents)} (Netto ${formatGermanEUR(group.netCents)})`,
    );
  }
  const totals = invoiceTotals(
    sorted.map((l) => ({
      quantity: l.quantity,
      unitNetCents: l.unitNetCents,
      vatRate: l.vatRate,
    })),
  );
  out.push(`Netto: ${formatGermanEUR(totals.netCents)}`);
  out.push(`USt.: ${formatGermanEUR(totals.vatCents)}`);
  out.push(`Brutto: ${formatGermanEUR(totals.grossCents)}`);
  out.push('');
  out.push(`Verwendungszweck: ${invoice.customerNumber}-${invoice.invoiceNumber}`);

  const notes = invoice.footerNotes ?? [];
  if (notes.length > 0) {
    out.push('');
    out.push(...notes);
  }
  return out.join('\n');
}

/** Render the invoice as a PDF (A4) and resolve with the full buffer. */
export async function generateInvoicePdf(
  invoice: InvoiceLike,
  lines: InvoiceLineLike[],
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 50,
    info: { Title: resolveInvoiceTitle(invoice), Producer: 'queen' },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(10).text(renderInvoiceText(invoice, lines), { lineGap: 2 });
  doc.end();
  return done;
}
