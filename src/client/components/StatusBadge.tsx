import { derivedStatus, type InvoiceLike } from '../lib/format';

export function StatusBadge({ invoice }: { invoice: InvoiceLike }) {
  const status = derivedStatus(invoice);
  return <span className={`badge ${status.cls}`}>{status.label}</span>;
}
