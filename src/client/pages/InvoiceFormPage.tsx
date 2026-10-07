import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatEUR } from '../lib/format';
import { computeTotals, eurosToCents, vatBreakdown, type EditorLine } from '../lib/lineTotals';
import { useLanguage } from '../i18n/LanguageContext';

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

const VAT_RATES = [0.19, 0.07, 0.16, 0];

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
  const { t } = useLanguage();

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

  const VAT_OPTIONS = VAT_RATES.map((value) => ({
    value,
    label: value === 0 ? t('form.vatExempt') : `${Math.round(value * 100)} %`,
  }));

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
      toast.error(t('form.clientNeed'));
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
      toast.show(t('form.clientCreated'));
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
    if (!clientId) return t('form.needClient');
    if (!title.trim()) return t('form.needTitle');
    if (lines.some((l) => !l.description.trim())) return t('form.needDesc');
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
      toast.show(send ? t('form.issued') : t('form.draftSaved'));
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
      toast.show(t('form.draftDeleted'));
      navigate('/invoices');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isEdit && detail.isLoading) return <p>{t('common.loadingShort')}</p>;
  if (isEdit && detail.isError) return <p className="empty">{t('form.notFound')}</p>;

  const loadedStatus = (detail.data as unknown as LoadedInvoice | undefined)?.status;
  const readOnly = isEdit && loadedStatus !== 'draft';

  return (
    <>
      <Link to={isEdit && id ? `/invoices/${id}` : '/invoices'} style={{ fontSize: 14 }}>
        {t('form.back')}
      </Link>
      <header className="page-head">
        <div className="row">
          <h1 className="num" style={{ fontWeight: 500 }}>
            {(detail.data as unknown as LoadedInvoice | undefined)?.status ? t('form.editTitle') : t('form.newTitle')}
          </h1>
          <span className="badge b-draft">{t('status.draft')}</span>
        </div>
        <div className="row acts">
          <button type="button" className="btn danger" disabled={busy} onClick={handleDelete}>
            {isEdit ? t('form.deleteDraft') : t('form.cancelBtn')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy || readOnly}
            onClick={() => persist(false)}
          >
            {t('common.save')}
          </button>
          <button
            type="button"
            className="btn honey"
            disabled={busy || readOnly}
            onClick={() => persist(true)}
          >
            {t('form.issue')}
          </button>
        </div>
      </header>

      {readOnly ? (
        <p className="empty">{t('form.notDraft')}</p>
      ) : (
        <>
          <section className="card grid-form">
            <label className="lab">
              {t('form.customer')}
              <select className="field" value={clientId} onChange={(e) => selectClient(e.target.value)}>
                <option value="">{t('form.choose')}</option>
                {clientRows.map((c) => (
                  <option key={String(c._id)} value={String(c._id)}>
                    {c.customerNumber} · {c.name}
                  </option>
                ))}
                <option value="__new__">{t('form.newCustomerOpt')}</option>
              </select>
            </label>
            <label className="lab">
              {t('form.title')}
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="lab">
              {t('form.period')}
              <input
                className="field num"
                value={servicePeriod}
                inputMode="numeric"
                onChange={(e) => setServicePeriod(e.target.value)}
              />
            </label>
            <label className="lab">
              {t('form.term')}
              <input
                className="field num"
                type="number"
                value={paymentTermDays}
                onChange={(e) => setPaymentTermDays(Number(e.target.value))}
              />
            </label>
            <label className="lab" style={{ gridColumn: '1 / -1' }}>
              {t('form.address')} <span className="hint">{t('form.addressHint')}</span>
              <textarea
                className="field"
                rows={4}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
          </section>

          {showNewClient ? (
            <section className="card" aria-label={t('form.newCustomer')}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{t('form.newCustomer')}</h2>
              <div className="grid-form">
                <label className="lab">
                  {t('form.name')}
                  <input
                    className="field"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                  />
                </label>
                <label className="lab" style={{ gridColumn: '1 / -1' }}>
                  {t('form.address')}
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
                  {t('form.createCustomer')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setShowNewClient(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            </section>
          ) : null}

          <section className="card flush">
            <div className="card-head">
              <h2>{t('form.lines')}</h2>
              <span className="muted" style={{ fontSize: 13 }}>
                {t('form.linesHint')}
              </span>
            </div>
            <div className="table-wrap">
              <table className="resp" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>{t('form.pos')}</th>
                    <th>{t('form.desc')}</th>
                    <th className="right" style={{ width: 90 }}>{t('form.qty')}</th>
                    <th className="right" style={{ width: 140 }}>{t('form.unitNet')}</th>
                    <th style={{ width: 170 }}>{t('form.vat')}</th>
                    <th className="right" style={{ width: 130 }}>{t('form.net')}</th>
                    <th style={{ width: 52 }} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => (
                    <tr key={index}>
                      <td data-l={t('form.pos')}>
                        <input
                          className="field num"
                          aria-label={t('form.pos')}
                          value={line.position}
                          onChange={(e) => patchLine(index, { position: e.target.value })}
                        />
                      </td>
                      <td data-l={t('form.desc')} className="w">
                        <input
                          className="field"
                          aria-label={t('form.desc')}
                          value={line.description}
                          onChange={(e) => patchLine(index, { description: e.target.value })}
                        />
                        {line.vatRate === 0 ? (
                          <input
                            className="field"
                            style={{ marginTop: 6, fontSize: 13 }}
                            aria-label={t('form.vatExempt')}
                            value={line.vatNote ?? ''}
                            onChange={(e) => patchLine(index, { vatNote: e.target.value })}
                          />
                        ) : null}
                      </td>
                      <td data-l={t('form.qty')}>
                        <input
                          className="field n"
                          aria-label={t('form.qty')}
                          type="number"
                          value={line.quantity}
                          onChange={(e) => patchLine(index, { quantity: Number(e.target.value) })}
                        />
                      </td>
                      <td data-l={t('form.unitNet')}>
                        <input
                          className="field n"
                          aria-label={t('form.unitNet')}
                          type="number"
                          step="0.01"
                          value={line.unitNetEuros}
                          onChange={(e) => patchLine(index, { unitNetEuros: Number(e.target.value) })}
                        />
                      </td>
                      <td data-l={t('form.vat')}>
                        <select
                          className="field"
                          aria-label={t('form.vat')}
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
                      <td data-l={t('form.net')} className="num right">
                        {formatEUR(
                          Math.round((Number(line.quantity) || 0) * eurosToCents(line.unitNetEuros)),
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon"
                          aria-label={t('form.removeLine')}
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
                {t('form.addLine')}
              </button>
              <div className="totals">
                <span>{t('form.net')}</span>
                <span className="amount num">{formatEUR(totals.netCents)}</span>
                {breakdown.map((b) => (
                  <span key={b.rate} style={{ display: 'contents' }}>
                    <span>
                      {t('form.vat')} {Math.round(b.rate * 100)} % {t('form.vatOn')} {formatEUR(b.netCents)}
                    </span>
                    <span className="amount num">{formatEUR(b.vatCents)}</span>
                  </span>
                ))}
                <span className="total">{t('form.gross')}</span>
                <span className="total amount num">{formatEUR(totals.grossCents)}</span>
              </div>
            </div>
          </section>
          <p className="muted" style={{ fontSize: 14 }}>
            {t('form.note')}
          </p>
        </>
      )}
    </>
  );
}
