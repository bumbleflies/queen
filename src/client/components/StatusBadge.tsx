import { derivedStatus, overdueDays, type InvoiceLike } from '../lib/format';
import { useLanguage } from '../i18n/LanguageContext';

export function StatusBadge({ invoice }: { invoice: InvoiceLike }) {
  const { lang, t } = useLanguage();
  const status = derivedStatus(invoice);
  let label: string;
  switch (status.key) {
    case 'overdue': {
      const days = overdueDays(invoice);
      label = lang === 'de' ? `${t('status.overdue')} · ${days} T` : `${t('status.overdue')} · ${days}d`;
      break;
    }
    case 'draft':
      label = t('status.draft');
      break;
    case 'sent':
      label = t('status.sent');
      break;
    case 'paid':
      label = t('status.paid');
      break;
    case 'partial':
      label = t('status.partial');
      break;
    case 'canceled':
      label = t('status.canceled');
      break;
    case 'credit_note':
      label = t('status.credit_note');
      break;
  }
  return <span className={`badge ${status.cls}`}>{label}</span>;
}
