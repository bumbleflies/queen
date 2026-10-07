import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

export type InvoiceActionKey = 'edit' | 'delete' | 'send' | 'markPaid' | 'cancel' | 'assignPayment';

/** Action visibility by status (plan Task 8 / UI mocks). */
export function invoiceActionKeys(status: string, kind?: string | null): InvoiceActionKey[] {
  if (kind === 'credit_note') return [];
  if (status === 'draft') return ['edit', 'delete', 'send'];
  if (status === 'sent') return ['markPaid', 'cancel', 'assignPayment'];
  return [];
}

const LABEL_KEYS: Record<InvoiceActionKey, DictKey> = {
  edit: 'actions.edit',
  delete: 'actions.delete',
  send: 'actions.send',
  markPaid: 'actions.markPaid',
  cancel: 'actions.cancel',
  assignPayment: 'actions.assignPayment',
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
  const { t } = useLanguage();
  const keys = invoiceActionKeys(status, kind);
  if (keys.length === 0) {
    return <span className="muted">{t('actions.done')}</span>;
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
          {t(LABEL_KEYS[key])}
        </button>
      ))}
    </div>
  );
}
