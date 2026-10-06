import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatEUR } from '../lib/format';
import { computeTotals, eurosToCents, vatBreakdown, type EditorLine } from '../lib/lineTotals';

interface LoadedInvoice {
  _id: unknown;
  clientId: unknown;
  title: string;
  servicePeriod: string;
  paymentTermDays: number;
  invoiceAddress: string;
  status: string;
  lines?: {
    position: string;
    description: string;
    quantity: number;
    unitNetCents: number;
    vatRate: number;
    vatNote?: string;
  }[];
}

interface ClientRow {
  _id: unknown;
  customerNumber: number;
  name: string;
  invoiceAddress: string;
  defaultPaymentTermDays?: number;
}

const VAT_OPTIONS = [
  { value: 0.19, label: '19 %' },
  { value: 0.07, label: '7 %' },
  { value: 0.16, label: '16 %' },
  { value: 0, label: '0 % steuerbefreit' },
];

const DEFAULT_VAT_NOTE = 'Diese Leistung ist gemäß § 4 Nr. 21 UStG steuerbefreit.';

function defaultPeriod(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()}`;
}

let lineKey = 0;

export function InvoiceFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const isEdit = mode === 'edit';
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();

  const detail = trpc.invoices.get.useQuery({ id: id ?? '' }, { enabled: isEdit && !!id });
  const clients = trpc.clients.list.useQuery();

  const createDraft = trpc.invoices.createDraft.useMutation();
  const updateDraft = trpc.invoices.updateDraft.useMutation();
  const setLinesMutation = trpc.invoices.setLines.useMutation();
  const markSent = trpc.invoices.markSent.useMutation();
  const deleteDraft = trpc.invoices.deleteDraft.useMutation();
  const createClient = trpc.clients.create.useMutation();

  const [clientId, setClientId] = useState('');
  const [title, setTitle] = useState('');
  const [servicePeriod, setServicePeriod] = useState(defaultPeriod());
  const [paymentTermDays, setPaymentTermDays] = useState(30);
  const [address, setAddress] = useState('');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [showNewClient, setShowNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const initialized = useRef(false);

  const clientRows = (clients.data ?? []) as unknown as ClientRow[];

  useEffect(() => {
    if (initialized.current) return;
    if (isEdit) {
      if (!detail.data) return;
      const inv = detail.data as unknown as LoadedInvoice;
      setClientId(String(inv.clientId));
      setTitle(inv.title);
      setServicePeriod(inv.servicePeriod);
      setPaymentTermDays(inv.paymentTermDays);
      setAddress(inv.invoiceAddress);
      setLines(
        (inv.lines ?? []).map((l) => ({
          position: l.position,
          description: l.description,
          quantity: l.quantity,
          unitNetEuros: l.unitNetCents / 100,
          vatRate: l.vatRate,
          vatNote: l.vatNote,
        })),
      );
    }
    initialized.current = true;
  }, [isEdit, detail.data]);

  const totals = useMemo(() => computeTotals(lines), [lines]);
  const breakdown = useMemo(() => vatBreakdown(lines), [lines]);

  function selectClient(value: string) {
    if (value === '__new__') {
      setShowNewClient(true);
      return;
    }
    setClientId(value);
    const client = clientRows.find((c) => String(c._id) === value);
    if (client) {
      setAddress(client.invoiceAddress);
      setPaymentTermDays(client.defaultPaymentTermDays ?? 30);
    }
  }

  function patchLine(index: number, patch: Partial<EditorLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function addLine() {
    lineKey += 1;
    setLines((prev) => [
      ...prev,
      {
        position: String(prev.length + 1),
        description: '',
        quantity: 1,
        unitNetEuros: 0,
        vatRate: 0.19,
        vatNote: '',
      },
    ]);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateClient() {
    if (!newClientName.trim() || !newClientAddress.trim()) {
      toast.error('Name und Adresse des Kunden sind erforderlich.');
      return;
    }
    try {
      const created = (await createClient.mutateAsync({
        name: newClientName.trim(),
        invoiceAddress: newClientAddress,
      })) as unknown as { _id: unknown; invoiceAddress: string; defaultPaymentTermDays?: number };
      await utils.clients.list.invalidate();
      setClientId(String(created._id));
      setAddress(created.invoiceAddress);
      setPaymentTermDays(created.defaultPaymentTermDays ?? 30);
      setShowNewClient(false);
      setNewClientName('');
      setNewClientAddress('');
      toast.show('Kunde angelegt.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  function buildLines() {
    return lines.map((l) => ({
      position: l.position,
      description: l.description,
      quantity: Number(l.quantity) || 0,
      unitNetCents: eurosToCents(l.unitNetEuros),
      vatRate: l.vatRate as 0 | 0.07 | 0.16 | 0.19,
      ...(l.vatRate === 0 && l.vatNote ? { vatNote: l.vatNote } : {}),
    }));
  }

  function validate(): string | null {
    if (!clientId) return 'Bitte einen Kunden wählen.';
    if (!title.trim()) return 'Bitte einen Titel angeben.';
    if (lines.some((l) => !l.description.trim())) return 'Jede Position braucht eine Beschreibung.';
    return null;
  }

  async function persist(send: boolean) {
    const error = validate();
    if (error) {
      toast.error(error);
      return;
    }
    setBusy(true);
    try {
      let invoiceId = id;
      if (!isEdit) {
        const created = (await createDraft.mutateAsync({
          clientId,
          title: title.trim(),
          servicePeriod,
          paymentTermDays,
          ...(address ? { invoiceAddress: address } : {}),
        })) as unknown as { _id: unknown };
        invoiceId = String(created._id);
      } else {
        await updateDraft.mutateAsync({
          id: id!,
          title: title.trim(),
          servicePeriod,
          paymentTermDays,
          ...(address ? { invoiceAddress: address } : {}),
        });
      }
      await setLinesMutation.mutateAsync({ id: invoiceId!, lines: buildLines() });
      if (send) await markSent.mutateAsync({ id: invoiceId! });
      await utils.invalidate();
      toast.show(send ? 'Rechnung gesendet und in Drive abgelegt.' : 'Entwurf gespeichert.');
      navigate(`/invoices/${invoiceId}`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!isEdit || !id) {
      navigate('/invoices');
      return;
    }
    setBusy(true);
    try {
      await deleteDraft.mutateAsync({ id });
      await utils.invalidate();
      toast.show('Entwurf gelöscht.');
      navigate('/invoices');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isEdit && detail.isLoading) return <p>Laden …</p>;
  if (isEdit && detail.isError) return <p className="empty">Rechnung nicht gefunden.</p>;

  const loadedStatus = (detail.data as unknown as LoadedInvoice | undefined)?.status;
  const readOnly = isEdit && loadedStatus !== 'draft';

  return (
    <>
      <Link to={isEdit && id ? `/invoices/${id}` : '/invoices'} style={{ fontSize: 14 }}>
        ← Rechnungen
      </Link>
      <header className="page-head">
        <div className="row">
          <h1 className="num" style={{ fontWeight: 500 }}>
            {(detail.data as unknown as LoadedInvoice | undefined)?.status ? 'Entwurf bearbeiten' : 'Neue Rechnung'}
          </h1>
          <span className="badge b-draft">Entwurf</span>
        </div>
        <div className="row acts">
          <button type="button" className="btn danger" disabled={busy} onClick={handleDelete}>
            {isEdit ? 'Entwurf löschen' : 'Abbrechen'}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || readOnly}
            onClick={() => persist(false)}
          >
            Speichern
          </button>
          <button
            type="button"
            className="btn honey"
            disabled={busy || readOnly}
            onClick={() => persist(true)}
          >
            Senden &amp; ablegen
          </button>
        </div>
      </header>

      {readOnly ? (
        <p className="empty">Diese Rechnung ist nicht mehr im Entwurfsstatus.</p>
      ) : (
        <>
          <section className="card grid-form">
            <label className="lab">
              Kunde
              <select className="field" value={clientId} onChange={(e) => selectClient(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {clientRows.map((c) => (
                  <option key={String(c._id)} value={String(c._id)}>
                    {c.customerNumber} · {c.name}
                  </option>
                ))}
                <option value="__new__">+ Neuer Kunde …</option>
              </select>
            </label>
            <label className="lab">
              Titel
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="lab">
              Leistungszeitraum
              <input
                className="field num"
                value={servicePeriod}
                inputMode="numeric"
                onChange={(e) => setServicePeriod(e.target.value)}
              />
            </label>
            <label className="lab">
              Zahlungsziel (Tage)
              <input
                className="field num"
                type="number"
                value={paymentTermDays}
                onChange={(e) => setPaymentTermDays(Number(e.target.value))}
              />
            </label>
            <label className="lab" style={{ gridColumn: '1 / -1' }}>
              Rechnungsadresse <span className="hint">aus Kundenstamm, wird beim Senden eingefroren</span>
              <textarea
                className="field"
                rows={4}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
          </section>

          {showNewClient ? (
            <section className="card" aria-label="Neuer Kunde">
              <h2 style={{ marginTop: 0, fontSize: 18 }}>Neuer Kunde</h2>
              <div className="grid-form">
                <label className="lab">
                  Name
                  <input
                    className="field"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </label>
                <label className="lab" style={{ gridColumn: '1 / -1' }}>
                  Rechnungsadresse
                  <textarea
                    className="field"
                    rows={3}
                    value={newClientAddress}
                    onChange={(e) => setNewClientAddress(e.target.value)}
                  />
                </label>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn" onClick={handleCreateClient}>
                  Kunde anlegen
                </button>
                <button type="button" className="btn ghost" onClick={() => setShowNewClient(false)}>
                  Abbrechen
                </button>
              </div>
            </section>
          ) : null}

          <section className="card flush">
            <div className="card-head">
              <h2>Positionen</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                Rabatte als negative Position · Unterpositionen als 1.1, 1.2 …
              </span>
            </div>
            <div className="table-wrap">
              <table className="resp" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>Pos.</th>
                    <th>Beschreibung</th>
                    <th className="right" style={{ width: 90 }}>Menge</th>
                    <th className="right" style={{ width: 140 }}>Einzel netto €</th>
                    <th style={{ width: 170 }}>USt.</th>
                    <th className="right" style={{ width: 130 }}>Netto</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td data-l="Pos.">
                        <input
                          className="field num"
                          aria-label="Position"
                          value={line.position}
                          onChange={(e) => patchLine(index, { position: e.target.value })}
                        />
                      </td>
                      <td data-l="Beschreibung" className="w">
                        <input
                          className="field"
                          aria-label="Beschreibung"
                          value={line.description}
                          onChange={(e) => patchLine(index, { description: e.target.value })}
                        />
                        {line.vatRate === 0 ? (
                          <input
                            className="field"
                            style={{ marginTop: 6, fontSize: 13 }}
                            aria-label="Hinweis Steuerbefreiung"
                            value={line.vatNote ?? ''}
                            onChange={(e) => patchLine(index, { vatNote: e.target.value })}
                          />
                        ) : null}
                      </td>
                      <td data-l="Menge">
                        <input
                          className="field n"
                          aria-label="Menge"
                          type="number"
                          value={line.quantity}
                          onChange={(e) => patchLine(index, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td data-l="Einzel netto €">
                        <input
                          className="field n"
                          aria-label="Einzelpreis netto"
                          type="number"
                          step="0.01"
                          value={line.unitNetEuros}
                          onChange={(e) => patchLine(index, { unitNetEuros: Number(e.target.value) })}
                        />
                      </td>
                      <td data-l="USt.">
                        <select
                          className="field"
                          aria-label="Umsatzsteuer"
                          value={line.vatRate}
                          onChange={(e) =>
                            patchLine(index, {
                              vatRate: Number(e.target.value),
                              ...(Number(e.target.value) === 0 && !line.vatNote
                                ? { vatNote: DEFAULT_VAT_NOTE }
                                : {}),
                            })
                          }
                        >
                          {VAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-l="Netto" className="num right">
                        {formatEUR(
                          Math.round((Number(line.quantity) || 0) * eurosToCents(line.unitNetEuros)),
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon"
                          aria-label="Position entfernen"
                          onClick={() => removeLine(index)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              className="card-head"
              style={{ background: 'var(--surface-2)', alignItems: 'flex-start' }}
            >
              <button type="button" className="btn ghost" onClick={addLine}>
                + Position
              </button>
              <div className="totals">
                <span>Netto</span>
                <span className="amount num">{formatEUR(totals.netCents)}</span>
                {breakdown.map((b) => (
                  <span key={b.rate} style={{ display: 'contents' }}>
                    <span>
                      USt. {Math.round(b.rate * 100)} % auf {formatEUR(b.netCents)}
                    </span>
                    <span className="amount num">{formatEUR(b.vatCents)}</span>
                  </span>
                ))}
                <span className="total">Brutto</span>
                <span className="total amount num">{formatEUR(totals.grossCents)}</span>
              </div>
            </div>
          </section>
          <p className="muted" style={{ fontSize: 14 }}>
            „Senden &amp; ablegen“ setzt Rechnungsdatum (heute) und Fälligkeit, erzeugt das PDF mit
            Verwendungszweck und legt es in Drive ab. Danach sind Positionen gesperrt.
          </p>
        </>
      )}
    </>
  );
}
