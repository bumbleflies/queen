import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatDate, formatEUR } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';
import { useLanguage } from '../i18n/LanguageContext';

interface ClientDetail {
  _id: unknown;
  customerNumber: number;
  name: string;
  invoiceAddress: string;
  domain?: string;
  defaultPaymentTermDays: number;
  email?: string;
  archived?: boolean;
}

interface InvoiceRow {
  _id: unknown;
  invoiceNumber: string;
  title: string;
  status: string;
  kind?: string | null;
  dueDate?: string | Date | null;
  invoiceDate?: string | Date | null;
  payments?: { amountCents: number }[] | null;
  totals?: { grossCents: number } | null;
}

export function ClientDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { t } = useLanguage();

  const client = trpc.clients.get.useQuery({ id: id ?? '' }, { enabled: !!id });
  const invoices = trpc.invoices.list.useQuery({ clientId: id ?? '' }, { enabled: !!id });
  const update = trpc.clients.update.useMutation();
  const archive = trpc.clients.archive.useMutation();
  const remove = trpc.clients.delete.useMutation();

  const data = client.data as unknown as ClientDetail | undefined;
  const [name, setName] = useState('');
  const [invoiceAddress, setInvoiceAddress] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [term, setTerm] = useState(30);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current || !data) return;
    setName(data.name);
    setInvoiceAddress(data.invoiceAddress);
    setDomain(data.domain ?? '');
    setEmail(data.email ?? '');
    setTerm(data.defaultPaymentTermDays);
    initialized.current = true;
  }, [data]);

  async function save() {
    if (!id) return;
    try {
      await update.mutateAsync({
        id,
        name: name.trim(),
        invoiceAddress,
        defaultPaymentTermDays: term,
        ...(domain.trim() ? { domain: domain.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      await utils.invalidate();
      toast.show(t('clients.saved'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleArchive() {
    if (!id) return;
    try {
      await archive.mutateAsync({ id });
      await utils.invalidate();
      toast.show(t('clients.archivedMsg'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await remove.mutateAsync({ id });
      await utils.invalidate();
      toast.show(t('clients.deletedMsg'));
      navigate('/clients');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (client.isLoading) return <p>{t('common.loadingShort')}</p>;
  if (client.isError || !data) return <p className="empty">{t('clients.notFound')}</p>;

  const invoiceRows = (invoices.data ?? []) as unknown as InvoiceRow[];

  return (
    <>
      <Link to="/clients" style={{ fontSize: 14 }}>
        {t('clients.back')}
      </Link>
      <header className="page-head">
        <div>
          <h1>
            {data.name} <span className="num muted">{data.customerNumber}</span>
          </h1>
          <p className="page-sub">
            {data.archived ? t('clients.archived') : t('clients.active')} · {formatEUR(
              invoiceRows.reduce((s, r) => s + (r.totals?.grossCents ?? 0), 0),
            )}{' '}
            {t('clients.totalGross')}
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to={`/invoices/new`}>
            {t('clients.newInvoice')}
          </Link>
          <button type="button" className="btn danger" onClick={handleDelete}>
            {t('common.delete')}
          </button>
        </div>
      </header>

      <section className="card grid-form">
        <label className="lab">
          {t('clients.name')}
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="lab">
          {t('clients.domain')}
          <input className="field" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="lab">
          {t('clients.email')}
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="lab">
          {t('clients.term')}
          <input
            className="field num"
            type="number"
            value={term}
            onChange={(e) => setTerm(Number(e.target.value))}
          />
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          {t('clients.address')}
          <textarea
            className="field"
            rows={4}
            value={invoiceAddress}
            onChange={(e) => setInvoiceAddress(e.target.value)}
          />
        </label>
      </section>
      <div className="row">
        <button type="button" className="btn" onClick={save}>
          {t('common.save')}
        </button>
        {!data.archived ? (
          <button type="button" className="btn ghost" onClick={handleArchive}>
            {t('clients.archive')}
          </button>
        ) : null}
      </div>

      <section className="card flush">
        <div className="card-head">
          <h2>{t('invoices.title')}</h2>
        </div>
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>{t('tbl.nr')}</th>
                <th>{t('tbl.title')}</th>
                <th>{t('tbl.date')}</th>
                <th className="right">{t('tbl.gross')}</th>
                <th>{t('tbl.status')}</th>
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((r) => (
                <tr key={String(r._id)}>
                  <td data-l={t('tbl.nr')} className="num">
                    <Link to={`/invoices/${String(r._id)}`}>{r.invoiceNumber}</Link>
                  </td>
                  <td data-l={t('tbl.title')} className="w">{r.title}</td>
                  <td data-l={t('tbl.date')} className="num">{formatDate(r.invoiceDate)}</td>
                  <td data-l={t('tbl.gross')} className="num right">{formatEUR(r.totals?.grossCents ?? 0)}</td>
                  <td data-l={t('tbl.status')}>
                    <StatusBadge invoice={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invoiceRows.length === 0 ? <p className="empty">{t('clients.noInvoices')}</p> : null}
      </section>
    </>
  );
}
