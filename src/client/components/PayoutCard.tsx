import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDateTime, formatEUR } from '../lib/format';
import { useLanguage } from '../i18n/LanguageContext';
import { payoutStatusClass, payoutStatusKey } from '../lib/expenseLabel';

/** The "Auszahlungen" tab: one link per payout into its authenticated page. */
export function PayoutCard() {
  const { t } = useLanguage();
  const payouts = trpc.payouts.list.useQuery();

  return (
    <section className="card" aria-label={t('expenses.tab.payouts')}>
      <h2>{t('expenses.tab.payouts')}</h2>
      {!payouts.data || payouts.data.length === 0 ? (
        <p className="muted">{t('payout.noPayouts')}</p>
      ) : (
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>{t('payout.reference')}</th>
                <th>{t('payout.founder')}</th>
                <th>{t('payout.created')}</th>
                <th className="right">{t('payout.total')}</th>
                <th>{t('payout.state')}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.data.map((payout) => (
                <tr key={payout.id}>
                  <td data-l={t('payout.reference')}>
                    <Link to={`/expenses/payouts/${payout.number}`}>{payout.number}</Link>
                  </td>
                  <td data-l={t('payout.founder')}>
                    {payout.founder.name || payout.founder.shortName}
                  </td>
                  <td data-l={t('payout.created')}>{formatDateTime(payout.createdAt)}</td>
                  <td data-l={t('payout.total')} className="num right">{formatEUR(payout.amountCents)}</td>
                  <td>
                    <span className={`badge ${payoutStatusClass(payout.status)}`}>
                      {t(payoutStatusKey(payout.status))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
