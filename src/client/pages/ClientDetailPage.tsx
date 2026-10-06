import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatDate, formatEUR } from '../lib/format';
import { StatusBadge } from '../components/StatusBadge';

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
      toast.show('Kunde gespeichert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleArchive() {
    if (!id) return;
    try {
      await archive.mutateAsync({ id });
      await utils.invalidate();
      toast.show('Kunde archiviert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleDelete() {
    if (!id) return;
    try {
      await remove.mutateAsync({ id });
      await utils.invalidate();
      toast.show('Kunde gelöscht.');
      navigate('/clients');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  if (client.isLoading) return <p>Laden …</p>;
  if (client.isError || !data) return <p className="empty">Kunde nicht gefunden.</p>;

  const invoiceRows = (invoices.data ?? []) as unknown as InvoiceRow[];

  return (
    <>
      <Link to="/clients" style={{ fontSize: 14 }}>
        ← Kunden
      </Link>
      <header className="page-head">
        <div>
          <h1>
            {data.name} <span className="num muted">{data.customerNumber}</span>
          </h1>
          <p className="page-sub">
            {data.archived ? 'archiviert' : 'aktiv'} · {formatEUR(
              invoiceRows.reduce((s, r) => s + (r.totals?.grossCents ?? 0), 0),
            )}{' '}
            brutto gesamt
          </p>
        </div>
        <div className="row">
          <Link className="btn ghost" to={`/invoices/new`}>
            + Neue Rechnung
          </Link>
          <button type="button" className="btn danger" onClick={handleDelete}>
            Löschen
          </button>
        </div>
      </header>

      <section className="card grid-form">
        <label className="lab">
          Name
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="lab">
          Domain
          <input className="field" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </label>
        <label className="lab">
          E-Mail
          <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="lab">
          Zahlungsziel (Tage)
          <input
            className="field num"
            type="number"
            value={term}
            onChange={(e) => setTerm(Number(e.target.value))}
          />
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          Rechnungsadresse
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
          Speichern
        </button>
        {!data.archived ? (
          <button type="button" className="btn ghost" onClick={handleArchive}>
            Archivieren
          </button>
        ) : null}
      </div>

      <section className="card flush">
        <div className="card-head">
          <h2>Rechnungen</h2>
        </div>
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Titel</th>
                <th>Datum</th>
                <th className="right">Brutto</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoiceRows.map((r) => (
                <tr key={String(r._id)}>
                  <td data-l="Nr." className="num">
                    <Link to={`/invoices/${String(r._id)}`}>{r.invoiceNumber}</Link>
                  </td>
                  <td data-l="Titel" className="w">{r.title}</td>
                  <td data-l="Datum" className="num">{formatDate(r.invoiceDate)}</td>
                  <td data-l="Brutto" className="num right">{formatEUR(r.totals?.grossCents ?? 0)}</td>
                  <td data-l="Status">
                    <StatusBadge invoice={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {invoiceRows.length === 0 ? <p className="empty">Noch keine Rechnungen.</p> : null}
      </section>
    </>
  );
}
