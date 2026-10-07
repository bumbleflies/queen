import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR, matchesChip, type InvoiceChip } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';

interface InvoiceRow {
  _id: unknown;
  invoiceNumber: string;
  kind?: string | null;
  customerNumber: number;
  clientId: unknown;
  title: string;
  invoiceDate?: string | Date | null;
  dueDate?: string | Date | null;
  status: string;
  payments?: { amountCents: number }[] | null;
  totals?: { netCents: number; vatCents: number; grossCents: number } | null;
}

interface ClientRow {
  _id: unknown;
  customerNumber: number;
  name: string;
}

const CHIPS: { key: InvoiceChip; label: string }[] = [
  { key: 'all', label: 'Alle' },
  { key: 'draft', label: 'Entwurf' },
  { key: 'sent', label: 'Ausgestellt' },
  { key: 'over', label: 'Überfällig' },
  { key: 'paid', label: 'Bezahlt' },
  { key: 'cancel', label: 'Storniert' },
];

export function InvoicesPage() {
  const invoices = trpc.invoices.list.useQuery();
  const clients = trpc.clients.list.useQuery();
  const [searchParams] = useSearchParams();
  const initialChip = CHIPS.find((c) => c.key === searchParams.get('status'))?.key ?? 'all';
  const [chip, setChip] = useState<InvoiceChip>(initialChip);
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [year, setYear] = useState('');

  const rows = (invoices.data ?? []) as unknown as InvoiceRow[];
  const clientRows = (clients.data ?? []) as unknown as ClientRow[];
  const clientName = useMemo(() => {
    const map = new Map(clientRows.map((c) => [String(c._id), c.name]));
    return (id: unknown) => map.get(String(id)) ?? '';
  }, [clientRows]);

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of rows) {
      const d = r.invoiceDate ? new Date(r.invoiceDate) : null;
      if (d && !Number.isNaN(d.getTime())) set.add(d.getFullYear());
    }
    return [...set].sort((a, b) => b - a);
  }, [rows]);

  const query = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (!matchesChip(r, chip)) return false;
    if (clientId && String(r.clientId) !== clientId) return false;
    if (year) {
      const d = r.invoiceDate ? new Date(r.invoiceDate) : null;
      if (!d || d.getFullYear() !== Number(year)) return false;
    }
    if (query) {
      const haystack = `${r.invoiceNumber} ${r.title} ${clientName(r.clientId)} ${r.customerNumber}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const sumGross = filtered.reduce((sum, r) => sum + (r.totals?.grossCents ?? 0), 0);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        CHIPS.map((c) => [c.key, rows.filter((r) => matchesChip(r, c.key)).length]),
      ) as Record<InvoiceChip, number>,
    [rows],
  );

  return (
    <>
      <header className="page-head">
        <h1>Rechnungen</h1>
        <div className="row">
          <a className="btn ghost" href="/api/export/invoices.csv">
            CSV-Export
          </a>
          <Link className="btn" to="/invoices/new">
            + Neue Rechnung
          </Link>
        </div>
      </header>

      <div className="row">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`chip${chip === c.key ? ' on' : ''}`}
            onClick={() => setChip(c.key)}
          >
            {c.label} <span className="num" style={{ opacity: 0.7 }}>{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="lab" style={{ flex: '1 1 280px' }}>
          Suche
          <input
            className="field"
            type="search"
            placeholder="Nr., Kunde, Titel …"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="lab" style={{ flex: '0 1 220px' }}>
          Kunde
          <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Alle Kunden</option>
            {clientRows
              .slice()
              .sort((a, b) => a.customerNumber - b.customerNumber)
              .map((c) => (
                <option key={String(c._id)} value={String(c._id)}>
                  {c.customerNumber} {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="lab" style={{ flex: '0 1 140px' }}>
          Jahr
          <select className="field" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Alle</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="card flush">
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Kunde</th>
                <th>Titel</th>
                <th>Datum</th>
                <th>Fällig</th>
                <th className="right">Netto</th>
                <th className="right">Brutto</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r._id)}>
                  <td data-l="Nr." className="num">
                    <Link to={`/invoices/${String(r._id)}`}>{r.invoiceNumber}</Link>
                  </td>
                  <td data-l="Kunde" className="w">
                    {clientName(r.clientId)} <span className="num muted">{r.customerNumber}</span>
                  </td>
                  <td data-l="Titel">{r.title}</td>
                  <td data-l="Datum" className="num">
                    {formatDate(r.invoiceDate)}
                  </td>
                  <td data-l="Fällig" className="num">
                    {formatDate(r.dueDate)}
                  </td>
                  <td data-l="Netto" className="num right">
                    {formatEUR(r.totals?.netCents ?? 0)}
                  </td>
                  <td data-l="Brutto" className="num right">
                    {formatEUR(r.totals?.grossCents ?? 0)}
                  </td>
                  <td data-l="Status">
                    <StatusBadge invoice={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <p className="empty">Keine Rechnungen für diesen Filter.</p>
        ) : null}
        <div className="table-foot">
          <span>
            {filtered.length} {filtered.length === 1 ? 'Rechnung' : 'Rechnungen'}
          </span>
          <span>
            Summe brutto <span className="num" style={{ color: 'var(--ink)' }}>{formatEUR(sumGross)}</span>
          </span>
        </div>
      </section>
    </>
  );
}
