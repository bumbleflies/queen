import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';

interface ClientRow {
  _id: unknown;
  customerNumber: number;
  name: string;
  invoiceAddress: string;
  domain?: string;
  defaultPaymentTermDays: number;
  email?: string;
  archived?: boolean;
}

export function ClientsPage() {
  const clients = trpc.clients.list.useQuery();
  const createClient = trpc.clients.create.useMutation();
  const utils = trpc.useUtils();
  const toast = useToast();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [invoiceAddress, setInvoiceAddress] = useState('');
  const [domain, setDomain] = useState('');
  const [email, setEmail] = useState('');
  const [term, setTerm] = useState(30);

  const rows = (clients.data ?? []) as unknown as ClientRow[];

  function reset() {
    setName('');
    setInvoiceAddress('');
    setDomain('');
    setEmail('');
    setTerm(30);
  }

  async function submit() {
    if (!name.trim() || !invoiceAddress.trim()) {
      toast.error('Name und Rechnungsadresse sind erforderlich.');
      return;
    }
    try {
      await createClient.mutateAsync({
        name: name.trim(),
        invoiceAddress,
        defaultPaymentTermDays: term,
        ...(domain.trim() ? { domain: domain.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      await utils.clients.list.invalidate();
      setShowForm(false);
      reset();
      toast.show('Kunde angelegt.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <h1>Kunden</h1>
        <button type="button" className="btn" onClick={() => setShowForm((s) => !s)}>
          + Neuer Kunde
        </button>
      </header>

      {showForm ? (
        <section className="card" aria-label="Neuer Kunde">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Neuer Kunde</h2>
          <div className="grid-form">
            <label className="lab">
              Name
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="lab">
              Domain (optional)
              <input className="field" value={domain} onChange={(e) => setDomain(e.target.value)} />
            </label>
            <label className="lab">
              E-Mail (optional)
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
                rows={3}
                value={invoiceAddress}
                onChange={(e) => setInvoiceAddress(e.target.value)}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={submit}>
              Speichern
            </button>
            <button type="button" className="btn ghost" onClick={() => setShowForm(false)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : null}

      <section className="card flush">
        <div className="table-wrap">
          <table className="resp">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Name</th>
                <th>Domain</th>
                <th className="right">Zahlungsziel</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={String(c._id)}>
                  <td data-l="Nr." className="num">
                    <Link to={`/clients/${String(c._id)}`}>{c.customerNumber}</Link>
                  </td>
                  <td data-l="Name" className="w">
                    <Link to={`/clients/${String(c._id)}`}>{c.name}</Link>
                  </td>
                  <td data-l="Domain">{c.domain || '—'}</td>
                  <td data-l="Zahlungsziel" className="num right">{c.defaultPaymentTermDays} Tage</td>
                  <td data-l="Status">
                    {c.archived ? <span className="badge b-draft">archiviert</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 ? <p className="empty">Noch keine Kunden.</p> : null}
      </section>
    </>
  );
}
