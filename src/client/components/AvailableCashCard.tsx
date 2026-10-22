import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatEUR } from '../lib/format';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  year: number;
  compact?: boolean;
}

/** "Frei verfügbar": bank balance minus VAT, provisions, estimated income tax and liabilities. */
export function AvailableCashCard({ year, compact = false }: Props) {
  const { t } = useLanguage();
  const query = trpc.ledger.availableCash.useQuery({ year });
  const d = query.data;
  if (!d) return null;

  const percent = Math.round(d.taxRate * 100);
  const lines = [
    { key: 'vat', label: t('cash.vat'), cents: d.vatCents, account: '3806', title: t('cash.vat.title') },
    { key: 'provisions', label: t('cash.provisions'), cents: d.provisionsCents, account: '3020', title: t('cash.provisions.title') },
    {
      key: 'tax',
      label: t('cash.tax').replace('{pct}', String(percent)),
      cents: d.estimatedTaxCents,
      account: '7600',
      title: t('cash.tax.title').replace('{pct}', String(percent)),
    },
    { key: 'liabilities', label: t('cash.liabilities'), cents: d.liabilitiesCents, account: '3300', title: t('cash.liabilities.title') },
  ];

  return (
    <section className={`card cash-card${compact ? ' rail-card' : ''}`} aria-label={t('cash.title')}>
      <h2>{t('cash.title')}</h2>
      <ul className="cash-lines">
        <li title={t('cash.bank.title')}>
          <span>{t('cash.bank')}</span>
          <span className="num">{formatEUR(d.bankCents)}</span>
        </li>
        {lines.map((l) => (
          <li key={l.key} title={l.title}>
            <Link to={`/finance?tab=journal&account=${l.account}`}>{l.label}</Link>
            <span className="num">{formatEUR(l.cents)}</span>
          </li>
        ))}
        <li className="cash-total" title={t('cash.result.title')}>
          <span>{t('cash.result')}</span>
          <span className="num">{formatEUR(d.availableCents)}</span>
        </li>
      </ul>
      {d.bankSource === 'ledger' ? (
        <p className="cash-note">
          {t('cash.fromLedger')}
          {d.bankError ? ` · ${t('cash.bankError').replace('{error}', d.bankError)}` : ''}
        </p>
      ) : null}
      {d.openCount > 0 ? <p className="cash-note cash-warn">{t('cash.open').replace('{n}', String(d.openCount))}</p> : null}
    </section>
  );
}
