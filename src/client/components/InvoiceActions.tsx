export type InvoiceActionKey = 'edit' | 'delete' | 'send' | 'markPaid' | 'cancel' | 'assignPayment';

/** Action visibility by status (plan Task 8 / UI mocks). */
export function invoiceActionKeys(status: string, kind?: string | null): InvoiceActionKey[] {
  if (kind === 'credit_note') return [];
  if (status === 'draft') return ['edit', 'delete', 'send'];
  if (status === 'sent') return ['markPaid', 'cancel', 'assignPayment'];
  return [];
}

const LABELS: Record<InvoiceActionKey, string> = {
  edit: 'Bearbeiten',
  delete: 'Entwurf löschen',
  send: 'Senden & ablegen',
  markPaid: 'Als bezahlt markieren',
  cancel: 'Stornieren',
  assignPayment: 'Zahlung zuordnen',
};

const CLASSES: Record<InvoiceActionKey, string> = {
  edit: 'btn ghost',
  delete: 'btn danger',
  send: 'btn honey',
  markPaid: 'btn ghost',
  cancel: 'btn danger',
  assignPayment: 'btn ghost',
};

export interface InvoiceActionsProps {
  status: string;
  kind?: string | null;
  disabled?: boolean;
  handlers?: Partial<Record<InvoiceActionKey, () => void>>;
}

/** Presentational action bar — no router/tRPC so it is trivially testable. */
export function InvoiceActions({ status, kind, disabled, handlers }: InvoiceActionsProps) {
  const keys = invoiceActionKeys(status, kind);
  if (keys.length === 0) {
    return <span className="muted">Abgeschlossen — keine Aktionen.</span>;
  }
  return (
    <div className="acts row">
      {keys.map((key) => (
        <button
          key={key}
          type="button"
          className={CLASSES[key]}
          disabled={disabled}
          onClick={handlers?.[key]}
        >
          {LABELS[key]}
        </button>
      ))}
    </div>
  );
}
