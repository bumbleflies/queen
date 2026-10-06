import { formatGermanEUR } from '../../server/lib/money';

export { formatGermanEUR as formatEUR };

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'canceled';
export type InvoiceKind = 'invoice' | 'credit_note';

export interface PaymentLike {
  amountCents: number;
  date?: string | Date | null;
}

/** Minimal shape the display helpers need from an invoice. */
export interface InvoiceLike {
  status: InvoiceStatus | string;
  kind?: InvoiceKind | string | null;
  dueDate?: string | Date | null;
  payments?: PaymentLike[] | null;
}

export type DisplayStatusKey =
  | 'draft'
  | 'sent'
  | 'overdue'
  | 'paid'
  | 'partial'
  | 'canceled'
  | 'credit_note';

export interface DisplayStatus {
  key: DisplayStatusKey;
  label: string;
  cls: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Accept ISO strings (tRPC/JSON) or Date objects; return null for invalid/empty. */
export function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** DD.MM.YYYY, or an em dash when absent. */
export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/** DD.MM.YYYY HH:MM (local time), or an em dash when absent. */
export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  if (!d) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)} ${hh}:${mi}`;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** Whole days a sent invoice is past its due date; 0 when not overdue. */
export function overdueDays(inv: InvoiceLike, today: Date = startOfToday()): number {
  const due = toDate(inv.dueDate);
  if (!due || due.getTime() >= today.getTime()) return 0;
  return Math.floor((today.getTime() - due.getTime()) / MS_PER_DAY);
}

/**
 * Never-stored display status. `überfällig` wins over `teilbezahlt` when a
 * partially paid invoice is past due (the more urgent signal).
 */
export function derivedStatus(inv: InvoiceLike, today: Date = startOfToday()): DisplayStatus {
  if (inv.kind === 'credit_note') {
    return { key: 'credit_note', label: 'Stornorechnung', cls: 'b-credit' };
  }
  if (inv.status === 'canceled') {
    return { key: 'canceled', label: 'storniert', cls: 'b-cancel' };
  }
  if (inv.status === 'paid') {
    return { key: 'paid', label: 'bezahlt', cls: 'b-paid' };
  }
  if (inv.status === 'draft') {
    return { key: 'draft', label: 'Entwurf', cls: 'b-draft' };
  }
  // status === 'sent'
  const overdue = overdueDays(inv, today);
  if (overdue > 0) {
    return { key: 'overdue', label: `überfällig · ${overdue} T`, cls: 'b-over' };
  }
  if ((inv.payments?.length ?? 0) > 0) {
    return { key: 'partial', label: 'teilbezahlt', cls: 'b-part' };
  }
  return { key: 'sent', label: 'gesendet', cls: 'b-sent' };
}

export type InvoiceChip = 'all' | 'draft' | 'sent' | 'over' | 'paid' | 'cancel';

/** Chip matching mirrors the mock: `Gesendet` also includes overdue invoices,
 *  `Storniert` matches canceled invoices and credit notes. */
export function matchesChip(inv: InvoiceLike, chip: InvoiceChip, today: Date = startOfToday()): boolean {
  const status = derivedStatus(inv, today);
  switch (chip) {
    case 'all':
      return true;
    case 'draft':
      return status.key === 'draft';
    case 'sent':
      return status.key === 'sent' || status.key === 'overdue' || status.key === 'partial';
    case 'over':
      return status.key === 'overdue';
    case 'paid':
      return status.key === 'paid';
    case 'cancel':
      return status.key === 'canceled' || status.key === 'credit_note';
  }
}
