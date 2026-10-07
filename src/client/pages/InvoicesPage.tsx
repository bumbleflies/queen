import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR, matchesChip, type InvoiceChip } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

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

const CHIPS: { key: InvoiceChip; labelKey: DictKey }[] = [
  { key: 'all', labelKey: 'invoices.chipAll' },
  { key: 'draft', labelKey: 'invoices.chipDraft' },
  { key: 'sent', labelKey: 'invoices.chipSent' },
  { key: 'over', labelKey: 'invoices.chipOver' },
  { key: 'paid', labelKey: 'invoices.chipPaid' },
  { key: 'cancel', labelKey: 'invoices.chipCancel' },
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
  const { t } = useLanguage();

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
        <h1>{t('invoices.title')}</h1>
        <div className="row">
          <a className="btn ghost" href="/api/export/invoices.csv">
            {t('invoices.csv')}
          </a>
          <Link className="btn" to="/invoices/new">
            + {t('invoices.new')}
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
            {t(c.labelKey)} <span className="num" style={{ opacity: 0.7 }}>{counts[c.key]}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="lab" style={{ flex: '1 1 280px' }}>
          {t('common.search')}
          <input
            className="field"
            type="search"
            placeholder={t('common.searchPh')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="lab" style={{ flex: '0 1 220px' }}>
          {t('invoices.customer')}
          <select className="field" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">{t('invoices.allCustomers')}</option>
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
          {t('invoices.year')}
          <select className="field" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">{t('invoices.all')}</option>
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
                <th>{t('tbl.nr')}</th>
                <th>{t('tbl.customer')}</th>
                <th>{t('tbl.title')}</th>
                <th>{t('tbl.date')}</th>
                <th>{t('tbl.due')}</th>
                <th className="right">{t('tbl.net')}</th>
                <th className="right">{t('tbl.gross')}</th>
                <th>{t('tbl.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={String(r._id)}>
                  <td data-l={t('tbl.nr')} className="num">
                    <Link to={`/invoices/${String(r._id)}`}>{r.invoiceNumber}</Link>
                  </td>
                  <td data-l={t('tbl.customer')} className="w">
                    {clientName(r.clientId)} <span className="num muted">{r.customerNumber}</span>
                  </td>
                  <td data-l={t('tbl.title')}>{r.title}</td>
                  <td data-l={t('tbl.date')} className="num">
                    {formatDate(r.invoiceDate)}
                  </td>
                  <td data-l={t('tbl.due')} className="num">
                    {formatDate(r.dueDate)}
                  </td>
                  <td data-l={t('tbl.net')} className="num right">
                    {formatEUR(r.totals?.netCents ?? 0)}
                  </td>
                  <td data-l={t('tbl.gross')} className="num right">
                    {formatEUR(r.totals?.grossCents ?? 0)}
                  </td>
                  <td data-l={t('tbl.status')}>
                    <StatusBadge invoice={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? (
          <p className="empty">{t('invoices.empty')}</p>
        ) : null}
        <div className="table-foot">
          <span>
            {filtered.length} {filtered.length === 1 ? t('invoices.countOne') : t('invoices.countMany')}
          </span>
          <span>
            {t('invoices.sumGross')} <span className="num" style={{ color: 'var(--ink)' }}>{formatEUR(sumGross)}</span>
          </span>
        </div>
      </section>
    </>
  );
}
