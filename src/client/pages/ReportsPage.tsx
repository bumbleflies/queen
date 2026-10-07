import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useLanguage } from '../i18n/LanguageContext';

export function ReportsPage() {
  const openItems = trpc.reports.openItems.useQuery();
  const byYear = trpc.reports.revenueByYear.useQuery();
  const byClient = trpc.reports.revenueByClient.useQuery();
  const { t } = useLanguage();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('nav.reports')}</h1>
          <p className="page-sub">{t('reports.sub')}</p>
        </div>
        <a className="btn ghost" href="/api/export/invoices.csv">
          {t('reports.csv')}
        </a>
      </header>

      <section className="card flush">
        <div className="card-head">
          <h2>{t('reports.open')}</h2>
          <span className="num" style={{ fontWeight: 500 }}>
            {formatEUR(openItems.data?.totalOpenCents ?? 0)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>{t('tbl.nr')}</th>
                <th>{t('tbl.customer')}</th>
                <th>{t('tbl.due')}</th>
                <th className="right">{t('tbl.open')}</th>
                <th>{t('tbl.status')}</th>
              </tr>
            </thead>
            <tbody>
              {(openItems.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td data-l={t('tbl.nr')} className="num">
                    <Link to={`/invoices/${item.id}`}>{item.invoiceNumber}</Link>
                  </td>
                  <td data-l={t('tbl.customer')} className="w">{item.clientName}</td>
                  <td data-l={t('tbl.due')} className="num">{formatDate(item.dueDate)}</td>
                  <td data-l={t('tbl.open')} className="num right">{formatEUR(item.openCents)}</td>
                  <td data-l={t('tbl.status')}>
                    <span className={`badge ${item.overdue ? 'b-over' : 'b-sent'}`}>
                      {item.overdue ? `${t('status.overdue')} · ${item.daysOverdue} ${t('reports.dayShort')}` : t('status.sent')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(openItems.data?.items.length ?? 0) === 0 ? (
          <p className="empty">{t('reports.noOpen')}</p>
        ) : null}
      </section>

      <div className="grid-2">
        <section className="card flush">
          <div className="card-head">
            <h2>{t('reports.byYear')}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{t('reports.byYearSub')}</span>
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('common.year')}</th>
                  <th className="right">{t('tbl.gross')}</th>
                </tr>
              </thead>
              <tbody>
                {(byYear.data ?? []).map((row) => (
                  <tr key={row.year}>
                    <td data-l={t('common.year')} className="num">{row.year}</td>
                    <td data-l={t('tbl.gross')} className="num right">{formatEUR(row.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(byYear.data?.length ?? 0) === 0 ? <p className="empty">{t('reports.noPay')}</p> : null}
        </section>

        <section className="card flush">
          <div className="card-head">
            <h2>{t('reports.byClient')}</h2>
            <span className="muted" style={{ fontSize: 13 }}>{t('reports.byClientSub')}</span>
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('tbl.customer')}</th>
                  <th className="right">{t('tbl.gross')}</th>
                </tr>
              </thead>
              <tbody>
                {(byClient.data ?? []).map((row) => (
                  <tr key={row.clientId}>
                    <td data-l={t('tbl.customer')} className="w">
                      {row.clientName} <span className="num muted">{row.customerNumber}</span>
                    </td>
                    <td data-l={t('tbl.gross')} className="num right">{formatEUR(row.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(byClient.data?.length ?? 0) === 0 ? <p className="empty">{t('reports.noPay')}</p> : null}
        </section>
      </div>
    </>
  );
}
