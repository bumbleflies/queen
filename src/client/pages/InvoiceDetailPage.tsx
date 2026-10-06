import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { StatusBadge } from '../components/StatusBadge';
import { InvoiceActions } from '../components/InvoiceActions';
import {
  daysBetween,
  formatDate,
  formatDateTime,
  formatEUR,
  overdueDays,
  toDate,
} from '../lib/format';
import { vatBreakdown, type EditorLine } from '../lib/lineTotals';

interface DetailLine {
  position: string;
  description: string;
  quantity: number;
  unitNetCents: number;
  vatRate: number;
  vatNote?: string;
}

interface DetailInvoice {
  _id: unknown;
  invoiceNumber: string;
  legacy: boolean;
  kind: string;
  cancels?: unknown;
  customerNumber: number;
  clientId: unknown;
  invoiceAddress: string;
  title: string;
  invoiceDate?: string | Date | null;
  servicePeriod: string;
  paymentTermDays: number;
  dueDate?: string | Date | null;
  status: string;
  sentAt?: string | Date | null;
  paidAt?: string | Date | null;
  canceledAt?: string | Date | null;
  createdAt?: string | Date | null;
  totals?: { netCents: number; vatCents: number; grossCents: number } | null;
  payments?: { amountCents: number; date?: string | Date | null; reference?: string }[] | null;
  driveMetadata?: { link?: string; fileName?: string; failureReason?: string } | null;
  footerNotes?: string[] | null;
  lines?: DetailLine[];
}

interface InvoiceSummary {
  _id: unknown;
  invoiceNumber: string;
  cancels?: unknown;
  kind?: string | null;
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();

  const detail = trpc.invoices.get.useQuery({ id: id ?? '' }, { enabled: !!id });
  const list = trpc.invoices.list.useQuery();
  const markPaid = trpc.invoices.markPaid.useMutation();
  const cancel = trpc.invoices.cancel.useMutation();
  const deleteDraft = trpc.invoices.deleteDraft.useMutation();
  const markSent = trpc.invoices.markSent.useMutation();

  const [paidOpen, setPaidOpen] = useState(false);
  const [paidDate, setPaidDate] = useState(new Date().toISOString().slice(0, 10));
  const [paidNote, setPaidNote] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showLines, setShowLines] = useState(false);

  const invoice = detail.data as unknown as DetailInvoice | undefined;
  const invoiceId = id ?? '';

  const linked = useMemo(() => {
    const rows = (list.data ?? []) as unknown as InvoiceSummary[];
    if (!invoice) return null;
    if (invoice.kind === 'credit_note' && invoice.cancels) {
      return rows.find((r) => String(r._id) === String(invoice.cancels)) ?? null;
    }
    if (invoice.status === 'canceled') {
      return rows.find((r) => String(r.cancels) === invoiceId) ?? null;
    }
    return null;
  }, [list.data, invoice, invoiceId]);

  const breakdown = useMemo(() => {
    if (!invoice) return [];
    const editorLines: EditorLine[] = (invoice.lines ?? []).map((l) => ({
      position: l.position,
      description: l.description,
      quantity: l.quantity,
      unitNetEuros: l.unitNetCents / 100,
      vatRate: l.vatRate,
    }));
    return vatBreakdown(editorLines);
  }, [invoice]);

  const history = useMemo(() => {
    if (!invoice) return [];
    const events: { at: string | Date; text: string }[] = [];
    if (invoice.createdAt) events.push({ at: invoice.createdAt, text: 'Entwurf erstellt' });
    if (invoice.sentAt) {
      const drive = invoice.driveMetadata?.fileName;
      events.push({
        at: invoice.sentAt,
        text: drive ? `gesendet, PDF in Drive abgelegt · ${drive}` : 'gesendet',
      });
    }
    if (invoice.paidAt) events.push({ at: invoice.paidAt, text: 'als bezahlt markiert' });
    if (invoice.canceledAt) events.push({ at: invoice.canceledAt, text: 'storniert' });
    return events.reverse();
  }, [invoice]);

  async function handleDelete() {
    try {
      await deleteDraft.mutateAsync({ id: invoiceId });
      await utils.invalidate();
      toast.show('Entwurf gelöscht.');
      navigate('/invoices');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSend() {
    try {
      await markSent.mutateAsync({ id: invoiceId });
      await utils.invalidate();
      toast.show('Rechnung gesendet und in Drive abgelegt.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitPaid() {
    try {
      await markPaid.mutateAsync({
        id: invoiceId,
        paidAt: new Date(paidDate),
        ...(paidNote ? { note: paidNote } : {}),
      });
      await utils.invalidate();
      setPaidOpen(false);
      toast.show('Rechnung als bezahlt markiert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitCancel() {
    try {
      await cancel.mutateAsync({ id: invoiceId, ...(cancelReason ? { reason: cancelReason } : {}) });
      await utils.invalidate();
      setCancelOpen(false);
      toast.show('Stornorechnung erstellt.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function copyReference() {
    if (!invoice) return;
    const ref = `${invoice.customerNumber}-${invoice.invoiceNumber}`;
    try {
      await navigator.clipboard.writeText(ref);
      toast.show('Verwendungszweck kopiert.');
    } catch {
      toast.error('Kopieren nicht möglich.');
    }
  }

  if (detail.isLoading) return <p>Laden …</p>;
  if (detail.isError || !invoice) return <p className="empty">Rechnung nicht gefunden.</p>;

  const reference = `${invoice.customerNumber}-${invoice.invoiceNumber}`;
  const paidCents = (invoice.payments ?? []).reduce((sum, p) => sum + p.amountCents, 0);
  const openCents = (invoice.totals?.grossCents ?? 0) - paidCents;
  const overdue = overdueDays(invoice);

  const statusExtra = (() => {
    if (invoice.status === 'sent' && overdue > 0) return ` · ${overdue} Tage überfällig`;
    const due = toDate(invoice.dueDate);
    if (invoice.status === 'sent' && due) {
      const days = daysBetween(new Date(), due);
      if (days >= 0) return ` · fällig in ${days} Tagen`;
    }
    return '';
  })();

  return (
    <>
      <Link to="/invoices" style={{ fontSize: 14 }}>
        ← Rechnungen
      </Link>
      <header className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row">
            <h1 className="num" style={{ margin: 0, fontSize: 28, fontWeight: 500 }}>
              {invoice.invoiceNumber}
            </h1>
            {invoice.kind === 'credit_note' ? (
              <span className="badge b-credit">Stornorechnung</span>
            ) : (
              <StatusBadge invoice={invoice} />
            )}
            {invoice.kind !== 'credit_note' && statusExtra ? (
              <span className="muted">{statusExtra}</span>
            ) : null}
          </div>
          <p style={{ margin: '6px 0 0 0', fontSize: 18 }}>{invoice.title}</p>
        </div>
        {invoice.driveMetadata?.link ? (
          <a className="btn ghost" href={invoice.driveMetadata.link} target="_blank" rel="noreferrer">
            PDF öffnen
          </a>
        ) : null}
        <InvoiceActions
          status={invoice.status}
          kind={invoice.kind}
          handlers={{
            edit: () => navigate(`/invoices/${invoiceId}/edit`),
            delete: handleDelete,
            send: handleSend,
            markPaid: () => setPaidOpen(true),
            cancel: () => setCancelOpen(true),
            assignPayment: () => navigate('/bank'),
          }}
        />
      </header>

      {linked ? (
        <p>
          {invoice.kind === 'credit_note' ? 'Storno zu ' : 'Stornorechnung: '}
          <Link to={`/invoices/${String(linked._id)}`} className="num">
            {linked.invoiceNumber}
          </Link>
        </p>
      ) : null}

      {paidOpen ? (
        <section className="card" role="dialog" aria-label="Als bezahlt markieren">
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Als bezahlt markieren</h2>
          <div className="grid-form">
            <label className="lab">
              Zahlungsdatum
              <input
                className="field"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </label>
            <label className="lab">
              Notiz (optional)
              <input
                className="field"
                value={paidNote}
                onChange={(e) => setPaidNote(e.target.value)}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={submitPaid}>
              Als bezahlt markieren
            </button>
            <button type="button" className="btn ghost" onClick={() => setPaidOpen(false)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : null}

      {cancelOpen ? (
        <section className="card dialog danger" role="dialog" aria-label="Rechnung stornieren">
          <h2>Rechnung stornieren</h2>
          <p style={{ margin: 0, color: '#3a3a40', maxWidth: '70ch' }}>
            Gesendete Rechnungen werden nicht gelöscht. queen erzeugt eine Stornorechnung mit allen
            Positionen negiert, legt sie als PDF in Drive ab und setzt diese Rechnung auf
            „storniert“.
          </p>
          <label className="lab">
            Grund (erscheint auf der Stornorechnung)
            <input
              className="field"
              value={cancelReason}
              placeholder="z. B. falscher Leistungszeitraum"
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" className="btn dangerfill" onClick={submitCancel}>
              Stornorechnung erstellen
            </button>
            <button type="button" className="btn ghost" onClick={() => setCancelOpen(false)}>
              Abbrechen
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="lbl">Rechnungsadresse</div>
          <div style={{ whiteSpace: 'pre-line' }}>{invoice.invoiceAddress}</div>
          <div className="muted" style={{ fontSize: 14 }}>
            Kundennr. <span className="num">{invoice.customerNumber}</span>
          </div>
        </section>
        <section
          className="card"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 20px' }}
        >
          <div>
            <div className="lbl">Rechnungsdatum</div>
            <div className="num" style={{ marginTop: 4 }}>{formatDate(invoice.invoiceDate)}</div>
          </div>
          <div>
            <div className="lbl">Leistungszeitraum</div>
            <div className="num" style={{ marginTop: 4 }}>{invoice.servicePeriod}</div>
          </div>
          <div>
            <div className="lbl">Zahlungsziel</div>
            <div style={{ marginTop: 4 }}>{invoice.paymentTermDays} Tage</div>
          </div>
          <div>
            <div className="lbl">Fällig am</div>
            <div className="num" style={{ marginTop: 4 }}>{formatDate(invoice.dueDate)}</div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="lbl">Verwendungszweck</div>
            <div className="row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
              <span className="num" style={{ fontSize: 17 }}>{reference}</span>
              <button type="button" className="btn ghost sm" onClick={copyReference}>
                Kopieren
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="card flush">
        <div className="card-head">
          <h2>Positionen</h2>
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={showLines}
            onClick={() => setShowLines((s) => !s)}
          >
            {showLines ? 'Ausblenden' : `${invoice.lines?.length ?? 0} Positionen`}
          </button>
        </div>
        <div className="table-wrap" hidden={!showLines}>
          <table className="resp">
            <thead>
              <tr>
                <th>Pos.</th>
                <th>Beschreibung</th>
                <th className="right">Menge</th>
                <th className="right">Einzel netto</th>
                <th className="right">USt.</th>
                <th className="right">Netto</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines ?? []).map((l, i) => (
                <tr key={i}>
                  <td data-l="Pos." className="num">{l.position}</td>
                  <td data-l="Beschreibung" className="w">
                    {l.description}
                    {l.vatNote ? <div className="muted" style={{ fontSize: 13 }}>{l.vatNote}</div> : null}
                  </td>
                  <td data-l="Menge" className="num right">{l.quantity}</td>
                  <td data-l="Einzel netto" className="num right">{formatEUR(l.unitNetCents)}</td>
                  <td data-l="USt." className="num right">{Math.round(l.vatRate * 100)} %</td>
                  <td data-l="Netto" className="num right">
                    {formatEUR(Math.round(l.quantity * l.unitNetCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-head" style={{ background: 'var(--surface-2)', justifyContent: 'flex-end' }}>
          <div className="totals">
            <span>Netto</span>
            <span className="amount num">{formatEUR(invoice.totals?.netCents ?? 0)}</span>
            {breakdown.map((b) => (
              <span key={b.rate} style={{ display: 'contents' }}>
                <span>
                  USt. {Math.round(b.rate * 100)} % auf {formatEUR(b.netCents)}
                </span>
                <span className="amount num">{formatEUR(b.vatCents)}</span>
              </span>
            ))}
            <span className="total">Brutto</span>
            <span className="total amount num">{formatEUR(invoice.totals?.grossCents ?? 0)}</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Zahlungen</h2>
          {(invoice.payments ?? []).length === 0 ? (
            <p style={{ margin: 0 }} className="muted">
              Noch kein Zahlungseingang. Nächster Bankabgleich täglich 07:30.
            </p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(invoice.payments ?? []).map((p, i) => (
                <li key={i}>
                  <span className="num">{formatDate(p.date)}</span> ·{' '}
                  <span className="num">{formatEUR(p.amountCents)}</span>
                  {p.reference ? <span className="muted"> · {p.reference}</span> : null}
                </li>
              ))}
            </ul>
          )}
          <div
            className="row"
            style={{ justifyContent: 'space-between', borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}
          >
            <span>Offen</span>
            <span className="num" style={{ fontWeight: 500 }}>{formatEUR(openCents)}</span>
          </div>
        </section>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Verlauf</h2>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
            {history.map((e, i) => (
              <li key={i}>
                <span className="num">{formatDateTime(e.at)}</span> {e.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
