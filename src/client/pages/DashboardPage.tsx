import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatDateTime, formatEUR, toDate } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';

function formatToday(): string {
  const d = new Date();
  return d.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

interface DashboardInvoice {
  status: string;
  paidAt?: string | Date | null;
  totals?: { grossCents: number } | null;
}

interface ReconcileRunRow {
  startedAt?: string | Date | null;
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

export function DashboardPage() {
  const invoices = trpc.invoices.list.useQuery();
  const reports = trpc.reports.openItems.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const openBank = trpc.bank.list.useQuery({ unmatchedOnly: true });

  const list = (invoices.data ?? []) as unknown as DashboardInvoice[];
  const openItems = reports.data;
  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const openBankCount = openBank.data?.length ?? 0;

  const currentYear = new Date().getFullYear();
  const paidYtdCents = list
    .filter((inv) => inv.status === 'paid' && toDate(inv.paidAt)?.getFullYear() === currentYear)
    .reduce((sum, inv) => sum + (inv.totals?.grossCents ?? 0), 0);
  const draftCount = list.filter((inv) => inv.status === 'draft').length;

  const overdueCount = openItems?.items.filter((i) => i.overdue).length ?? 0;
  const dueTableItems = (openItems?.items ?? []).filter((i) => i.kind !== 'credit_note');

  const importOk = !run?.error;
  const importLabel = run?.finishedAt
    ? formatDateTime(run.finishedAt)
    : run?.startedAt
      ? formatDateTime(run.startedAt)
      : 'kein Lauf';

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">{formatToday()}</p>
        </div>
        <Link className="btn" to="/invoices/new">
          + Neue Rechnung
        </Link>
      </header>

      <section aria-label="Kennzahlen" className="grid-kpi">
        <div className="card">
          <div className="kpi-label">Offene Posten</div>
          <div className="kpi-value num">{formatEUR(openItems?.totalOpenCents ?? 0)}</div>
          <div className="kpi-sub">{openItems?.count ?? 0} Rechnungen gesendet</div>
        </div>
        <div className="card warn">
          <div className="kpi-label">Überfällig</div>
          <div className="kpi-value num">{formatEUR(openItems?.totalOverdueCents ?? 0)}</div>
          <div className="kpi-sub">{overdueCount} Rechnung(en) überfällig</div>
        </div>
        <div className="card">
          <div className="kpi-label">Bezahlt {currentYear}</div>
          <div className="kpi-value num">{formatEUR(paidYtdCents)}</div>
          <div className="kpi-sub">brutto, nach Zahlungseingang</div>
        </div>
        <div className="card">
          <div className="kpi-label">Entwürfe</div>
          <div className="kpi-value num">{draftCount}</div>
          <div className="kpi-sub">noch nicht gesendet</div>
        </div>
      </section>

      <section className="card row" aria-label="Bankabgleich Status">
        <div>
          <div className="lbl">GLS-Import (Firefly)</div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className={`badge ${importOk ? 'b-paid' : 'b-cancel'}`}>
              {importOk ? 'OK' : 'Fehler'}
            </span>
            <span className="muted">{importLabel}</span>
          </div>
        </div>
        <div>
          <div className="lbl">Abgleich</div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className={`badge ${importOk ? 'b-paid' : 'b-over'}`}>
              {importOk ? 'OK' : 'prüfen'}
            </span>
            <span className="muted">
              {run
                ? `${run.fetched ?? 0} Buchungen · ${run.matched ?? 0} zugeordnet · ${run.partial ?? 0} teilweise`
                : 'kein Lauf'}
            </span>
          </div>
        </div>
        <div>
          <div className="lbl">Offene Buchungen</div>
          <div className="row" style={{ marginTop: 6 }}>
            {openBankCount > 0 ? (
              <span className="badge b-over">{openBankCount} prüfen</span>
            ) : (
              <span className="badge b-paid">0 offen</span>
            )}
          </div>
        </div>
        <Link className="btn ghost" to="/bank" style={{ marginLeft: 'auto' }}>
          Zum Bankabgleich
        </Link>
      </section>

      <section className="card flush">
        <div className="card-head">
          <h2>Fällig &amp; überfällig</h2>
          <Link to="/invoices">Alle Rechnungen</Link>
        </div>
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Kunde</th>
                <th>Titel</th>
                <th>Fällig</th>
                <th className="right">Offen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {dueTableItems.map((item) => (
                <tr key={item.id}>
                  <td data-l="Nr." className="num">
                    <Link to={`/invoices/${item.id}`}>{item.invoiceNumber}</Link>
                  </td>
                  <td data-l="Kunde" className="w">
                    {item.clientName} <span className="num muted">{item.customerNumber}</span>
                  </td>
                  <td data-l="Titel">{item.title}</td>
                  <td data-l="Fällig" className="num">
                    {formatDate(item.dueDate)}
                  </td>
                  <td data-l="Offen" className="num right">
                    {formatEUR(item.openCents)}
                  </td>
                  <td data-l="Status">
                    <StatusBadge invoice={{ status: 'sent', kind: item.kind, dueDate: item.dueDate }} />
                  </td>
                </tr>
              ))}
              {openItems && dueTableItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    Keine offenen Rechnungen.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
