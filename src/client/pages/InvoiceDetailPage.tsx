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
import { filingState, type FilingStateInvoice } from '../lib/filingState';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { t } = useLanguage();

  const detail = trpc.invoices.get.useQuery(
    { id: id ?? '' },
    {
      enabled: !!id,
      // The Drive upload runs as a background job — poll until it lands or fails.
      refetchInterval: (query) => {
        const data = query.state.data as unknown as FilingStateInvoice | undefined;
        return data && filingState(data) === 'pending' ? 3000 : false;
      },
    },
  );
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
  const [showLines, setShowLines] = useState(true);

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
    if (invoice.createdAt) events.push({ at: invoice.createdAt, text: t('detail.evDraft') });
    if (invoice.sentAt) {
      const drive = invoice.driveMetadata?.fileName;
      events.push({
        at: invoice.sentAt,
        text: drive ? `${t('detail.evSentPdf')} ${drive}` : t('detail.evSent'),
      });
    }
    if (invoice.paidAt) events.push({ at: invoice.paidAt, text: t('detail.evPaid') });
    if (invoice.canceledAt) events.push({ at: invoice.canceledAt, text: t('detail.evCanceled') });
    return events.reverse();
  }, [invoice, t]);

  async function handleDelete() {
    try {
      await deleteDraft.mutateAsync({ id: invoiceId });
      await utils.invalidate();
      toast.show(t('form.draftDeleted'));
      navigate('/invoices');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSend() {
    try {
      await markSent.mutateAsync({ id: invoiceId });
      await utils.invalidate();
      toast.show(t('form.issued'));
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
      toast.show(t('detail.paidMsg'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitCancel() {
    try {
      await cancel.mutateAsync({ id: invoiceId, ...(cancelReason ? { reason: cancelReason } : {}) });
      await utils.invalidate();
      setCancelOpen(false);
      toast.show(t('detail.creditMsg'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function copyReference() {
    if (!invoice) return;
    const ref = `${invoice.customerNumber}-${invoice.invoiceNumber}`;
    try {
      await navigator.clipboard.writeText(ref);
      toast.show(t('detail.refCopied'));
    } catch {
      toast.error(t('detail.copyFail'));
    }
  }

  if (detail.isLoading) return <p>{t('common.loadingShort')}</p>;
  if (detail.isError || !invoice) return <p className="empty">{t('detail.notFound')}</p>;

  const reference = `${invoice.customerNumber}-${invoice.invoiceNumber}`;
  const paidCents = (invoice.payments ?? []).reduce((sum, p) => sum + p.amountCents, 0);
  const openCents = (invoice.totals?.grossCents ?? 0) - paidCents;
  const overdue = overdueDays(invoice);
  const filing = filingState(invoice);

  const statusExtra = (() => {
    if (invoice.status === 'sent' && overdue > 0)
      return ` · ${overdue} ${t('detail.daysOverdue')}`;
    const due = toDate(invoice.dueDate);
    if (invoice.status === 'sent' && due) {
      const days = daysBetween(new Date(), due);
      if (days >= 0) return ` · ${t('detail.dueIn')} ${days} ${t('detail.daysPl')}`;
    }
    return '';
  })();

  return (
    <>
      <Link to="/invoices" style={{ fontSize: 14 }}>
        {t('detail.back')}
      </Link>
      <header className="page-head" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="row">
            <h1 className="num" style={{ margin: 0, fontSize: 28, fontWeight: 500 }}>
              {invoice.invoiceNumber}
            </h1>
            {invoice.kind === 'credit_note' ? (
              <span className="badge b-credit">{t('status.credit_note')}</span>
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
            {t('detail.openPdf')}
          </a>
        ) : filing === 'pending' ? (
          <span className="muted">{t('detail.pdfPending')}</span>
        ) : filing === 'failed' ? (
          <span className="badge b-over" title={invoice.driveMetadata?.failureReason ?? undefined}>
            {t('detail.filingFailed')}
          </span>
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
            assignPayment: () => navigate('/finance'),
          }}
        />
      </header>

      {filing === 'failed' ? (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {t('detail.driveFailed')} {invoice.driveMetadata?.failureReason}
        </p>
      ) : null}

      {linked ? (
        <p>
          {invoice.kind === 'credit_note' ? t('detail.creditFor') : t('detail.creditIs')}
          <Link to={`/invoices/${String(linked._id)}`} className="num">
            {linked.invoiceNumber}
          </Link>
        </p>
      ) : null}

      {paidOpen ? (
        <section className="card" role="dialog" aria-label={t('detail.markPaid')}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{t('detail.markPaid')}</h2>
          <div className="grid-form">
            <label className="lab">
              {t('detail.payDate')}
              <input
                className="field"
                type="date"
                value={paidDate}
                onChange={(e) => setPaidDate(e.target.value)}
              />
            </label>
            <label className="lab">
              {t('detail.noteOpt')}
              <input
                className="field"
                value={paidNote}
                onChange={(e) => setPaidNote(e.target.value)}
              />
            </label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" onClick={submitPaid}>
              {t('detail.markPaid')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setPaidOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : null}

      {cancelOpen ? (
        <section className="card dialog danger" role="dialog" aria-label={t('detail.cancelTitle')}>
          <h2>{t('detail.cancelTitle')}</h2>
          <p style={{ margin: 0, color: '#3a3a40', maxWidth: '70ch' }}>
            {t('detail.cancelExpl')}
          </p>
          <label className="lab">
            {t('detail.cancelReason')}
            <input
              className="field"
              value={cancelReason}
              placeholder={t('detail.cancelPh')}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" className="btn dangerfill" onClick={submitCancel}>
              {t('detail.createCredit')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="lbl">{t('detail.address')}</div>
          <div style={{ whiteSpace: 'pre-line' }}>{invoice.invoiceAddress}</div>
          <div className="muted" style={{ fontSize: 14 }}>
            {t('detail.customerNo')} <span className="num">{invoice.customerNumber}</span>
          </div>
        </section>
        <section
          className="card"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px 20px' }}
        >
          <div>
            <div className="lbl">{t('detail.invoiceDate')}</div>
            <div className="num" style={{ marginTop: 4 }}>{formatDate(invoice.invoiceDate)}</div>
          </div>
          <div>
            <div className="lbl">{t('form.period')}</div>
            <div className="num" style={{ marginTop: 4 }}>{invoice.servicePeriod}</div>
          </div>
          <div>
            <div className="lbl">{t('detail.term')}</div>
            <div style={{ marginTop: 4 }}>{invoice.paymentTermDays} {t('common.days')}</div>
          </div>
          <div>
            <div className="lbl">{t('detail.dueOn')}</div>
            <div className="num" style={{ marginTop: 4 }}>{formatDate(invoice.dueDate)}</div>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <div className="lbl">{t('detail.reference')}</div>
            <div className="row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
              <span className="num" style={{ fontSize: 17 }}>{reference}</span>
              <button type="button" className="btn ghost sm" onClick={copyReference}>
                {t('common.copy')}
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className="card flush">
        <div className="card-head">
          <h2>{t('form.lines')}</h2>
          <button
            type="button"
            className="btn ghost sm"
            aria-expanded={showLines}
            onClick={() => setShowLines((s) => !s)}
          >
            {showLines ? t('detail.hide') : `${invoice.lines?.length ?? 0} ${t('detail.posCount')}`}
          </button>
        </div>
        <div className="table-wrap" hidden={!showLines}>
          <table className="resp">
            <thead>
              <tr>
                <th>{t('form.pos')}</th>
                <th>{t('form.desc')}</th>
                <th className="right">{t('form.qty')}</th>
                <th className="right">{t('form.unitNet')}</th>
                <th className="right">{t('form.vat')}</th>
                <th className="right">{t('form.net')}</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.lines ?? []).map((l, i) => (
                <tr key={i}>
                  <td data-l={t('form.pos')} className="num">{l.position}</td>
                  <td data-l={t('form.desc')} className="w">
                    {l.description}
                    {l.vatNote ? <div className="muted" style={{ fontSize: 13 }}>{l.vatNote}</div> : null}
                  </td>
                  <td data-l={t('form.qty')} className="num right">{l.quantity}</td>
                  <td data-l={t('form.unitNet')} className="num right">{formatEUR(l.unitNetCents)}</td>
                  <td data-l={t('form.vat')} className="num right">{Math.round(l.vatRate * 100)} %</td>
                  <td data-l={t('form.net')} className="num right">
                    {formatEUR(Math.round(l.quantity * l.unitNetCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-head" style={{ background: 'var(--surface-2)', justifyContent: 'flex-end' }}>
          <div className="totals">
            <span>{t('form.net')}</span>
            <span className="amount num">{formatEUR(invoice.totals?.netCents ?? 0)}</span>
            {breakdown.map((b) => (
              <span key={b.rate} style={{ display: 'contents' }}>
                <span>
                  {t('form.vat')} {Math.round(b.rate * 100)} % {t('form.vatOn')} {formatEUR(b.netCents)}
                </span>
                <span className="amount num">{formatEUR(b.vatCents)}</span>
              </span>
            ))}
            <span className="total">{t('form.gross')}</span>
            <span className="total amount num">{formatEUR(invoice.totals?.grossCents ?? 0)}</span>
          </div>
        </div>
      </section>

      <div className="grid-2">
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('detail.payments')}</h2>
          {(invoice.payments ?? []).length === 0 ? (
            <p style={{ margin: 0 }} className="muted">
              {t('detail.noPayments')}
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
            <span>{t('detail.open')}</span>
            <span className="num" style={{ fontWeight: 500 }}>{formatEUR(openCents)}</span>
          </div>
        </section>
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('detail.history')}</h2>
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
