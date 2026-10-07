import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';

export function ReportsPage() {
  const openItems = trpc.reports.openItems.useQuery();
  const byYear = trpc.reports.revenueByYear.useQuery();
  const byClient = trpc.reports.revenueByClient.useQuery();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Berichte</h1>
          <p className="page-sub">Offene Posten und Umsätze (nach Zahlungseingang)</p>
        </div>
        <a className="btn ghost" href="/api/export/invoices.csv">
          CSV-Export (Rechnungen)
        </a>
      </header>

      <section className="card flush">
        <div className="card-head">
          <h2>Offene Posten</h2>
          <span className="num" style={{ fontWeight: 500 }}>
            {formatEUR(openItems.data?.totalOpenCents ?? 0)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Kunde</th>
                <th>Fällig</th>
                <th className="right">Offen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(openItems.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td data-l="Nr." className="num">
                    <Link to={`/invoices/${item.id}`}>{item.invoiceNumber}</Link>
                  </td>
                  <td data-l="Kunde" className="w">{item.clientName}</td>
                  <td data-l="Fällig" className="num">{formatDate(item.dueDate)}</td>
                  <td data-l="Offen" className="num right">{formatEUR(item.openCents)}</td>
                  <td data-l="Status">
                    <span className={`badge ${item.overdue ? 'b-over' : 'b-sent'}`}>
                      {item.overdue ? `überfällig · ${item.daysOverdue} T` : 'ausgestellt'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {(openItems.data?.items.length ?? 0) === 0 ? (
          <p className="empty">Keine offenen Posten.</p>
        ) : null}
      </section>

      <div className="grid-2">
        <section className="card flush">
          <div className="card-head">
            <h2>Umsatz je Jahr</h2>
            <span className="muted" style={{ fontSize: 13 }}>brutto, nach Zahlungseingang</span>
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Jahr</th>
                  <th className="right">Brutto</th>
                </tr>
              </thead>
              <tbody>
                {(byYear.data ?? []).map((row) => (
                  <tr key={row.year}>
                    <td data-l="Jahr" className="num">{row.year}</td>
                    <td data-l="Brutto" className="num right">{formatEUR(row.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(byYear.data?.length ?? 0) === 0 ? <p className="empty">Noch keine Zahlungen.</p> : null}
        </section>

        <section className="card flush">
          <div className="card-head">
            <h2>Umsatz je Kunde</h2>
            <span className="muted" style={{ fontSize: 13 }}>brutto, bezahlte Rechnungen</span>
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Kunde</th>
                  <th className="right">Brutto</th>
                </tr>
              </thead>
              <tbody>
                {(byClient.data ?? []).map((row) => (
                  <tr key={row.clientId}>
                    <td data-l="Kunde" className="w">
                      {row.clientName} <span className="num muted">{row.customerNumber}</span>
                    </td>
                    <td data-l="Brutto" className="num right">{formatEUR(row.grossCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(byClient.data?.length ?? 0) === 0 ? <p className="empty">Noch keine Zahlungen.</p> : null}
        </section>
      </div>
    </>
  );
}
