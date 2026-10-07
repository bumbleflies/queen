import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime, formatEUR } from '../lib/format';
import { suggestionsFor } from '../lib/suggestions';
import { useLanguage } from '../i18n/LanguageContext';

interface BankTx {
  _id: unknown;
  fireflyJournalId: string;
  date: string | Date;
  amountCents: number;
  currency: string;
  description: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  matchedInvoiceId?: unknown;
  matchMethod?: string;
  ignored?: boolean;
}

interface OpenItem {
  id: string;
  invoiceNumber: string;
  customerNumber: number;
  clientName: string;
  openCents: number;
  dueDate?: string | Date | null;
}

interface ClientRow {
  _id: unknown;
  name: string;
}

interface InvoiceSummary {
  _id: unknown;
  invoiceNumber: string;
  kind: string;
  status: string;
  customerNumber: number;
  clientId: unknown;
  totals: { grossCents: number };
  payments: { amountCents: number }[];
  dueDate?: string | Date | null;
}

interface ReconcileRunRow {
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

export function BankPage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const bank = trpc.bank.list.useQuery();
  const openItemsQuery = trpc.reports.openItems.useQuery();
  const invoices = trpc.invoices.list.useQuery();
  const clients = trpc.clients.list.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const assign = trpc.bank.assign.useMutation();
  const unassign = trpc.bank.unassign.useMutation();
  const ignore = trpc.bank.ignore.useMutation();
  const unignore = trpc.bank.unignore.useMutation();
  const syncNow = trpc.bank.syncNow.useMutation();
  const runNow = trpc.reconcile.runNow.useMutation();
  const { lang, t } = useLanguage();

  const [tab, setTab] = useState<'open' | 'done' | 'ignored'>('open');
  const [resyncOpen, setResyncOpen] = useState(false);

  const txs = (bank.data ?? []) as unknown as BankTx[];
  const openItems = (openItemsQuery.data?.items ?? []) as unknown as OpenItem[];
  // Paid-but-unpaid invoices (e.g. imported as paid without a payment
  // transaction) still await their bank transaction: suggest them too.
  const awaitablePaid = useMemo(() => {
    const openIds = new Set(openItems.map((i) => i.id));
    const names = new Map(
      ((clients.data ?? []) as unknown as ClientRow[]).map((c) => [String(c._id), c.name]),
    );
    return ((invoices.data ?? []) as unknown as InvoiceSummary[])
      .filter(
        (inv) =>
          inv.status === 'paid' &&
          inv.kind !== 'credit_note' &&
          (inv.payments ?? []).length === 0 &&
          !openIds.has(String(inv._id)),
      )
      .map((inv) => ({
        id: String(inv._id),
        invoiceNumber: inv.invoiceNumber,
        customerNumber: inv.customerNumber,
        clientName: names.get(String(inv.clientId)) ?? '',
        openCents: inv.totals.grossCents,
        dueDate: inv.dueDate,
      }));
  }, [invoices.data, clients.data, openItems]);
  const candidates = useMemo(() => [...openItems, ...awaitablePaid], [openItems, awaitablePaid]);
  const invoiceById = useMemo(() => {
    const map = new Map<string, InvoiceSummary>();
    for (const inv of (invoices.data ?? []) as unknown as InvoiceSummary[]) {
      map.set(String(inv._id), inv);
    }
    return map;
  }, [invoices.data]);

  const openTxs = txs.filter((t) => !t.matchedInvoiceId && !t.ignored);
  const doneTxs = txs.filter((t) => !!t.matchedInvoiceId && !t.ignored);
  const ignoredTxs = txs.filter((t) => t.ignored);

  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const runLabel = run?.finishedAt
    ? `${t('bank.lastRun')} ${formatDateTime(run.finishedAt)}`
    : t('bank.noRun');

  async function doAssign(bankTxId: string, invoiceId: string) {
    try {
      await assign.mutateAsync({ bankTxId, invoiceId });
      await utils.invalidate();
      toast.show(t('bank.assigned'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doIgnore(bankTxId: string) {
    try {
      await ignore.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show(t('bank.ignored'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doUnassign(bankTxId: string) {
    try {
      await unassign.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show(t('bank.unassigned'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doUnignore(bankTxId: string) {
    try {
      await unignore.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show(t('bank.unignored'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSync() {
    try {
      const result = await syncNow.mutateAsync();
      await utils.invalidate();
      if (result.ok) toast.show(`${t('bank.synced')} ${result.fetched} ${t('bank.bookings')}.`);
      else toast.error(result.error ?? t('bank.syncFail'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleRun() {
    try {
      await runNow.mutateAsync();
      await utils.invalidate();
      toast.show(t('bank.runStarted'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleFullSync() {
    try {
      const result = await syncNow.mutateAsync({ full: true });
      await utils.invalidate();
      if (result.ok) {
        toast.show(`${t('bank.synced')} ${result.fetched} ${t('bank.bookings')}.`);
        setResyncOpen(false);
      } else toast.error(result.error ?? t('bank.syncFail'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('nav.bank')}</h1>
          <p className="page-sub">{t('bank.sub')}</p>
        </div>
        <div className="row acts">
          <button type="button" className="btn ghost" onClick={handleSync}>
            {t('bank.syncNow')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={syncNow.isPending}
            onClick={() => setResyncOpen(true)}
          >
            {syncNow.isPending ? t('bank.fullSyncRunning') : t('bank.fullSync')}
          </button>
          <button type="button" className="btn" onClick={handleRun}>
            {t('bank.runNow')}
          </button>
        </div>
      </header>

      {resyncOpen ? (
        <section className="card" role="dialog" aria-label={t('bank.fullSyncTitle')} style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>{t('bank.fullSyncTitle')}</h2>
          <p style={{ margin: '8px 0 0', maxWidth: '70ch' }}>{t('bank.fullSyncConfirm')}</p>
          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn" disabled={syncNow.isPending} onClick={handleFullSync}>
              {syncNow.isPending ? t('bank.fullSyncRunning') : t('bank.fullSync')}
            </button>
            <button
              type="button"
              className="btn ghost"
              disabled={syncNow.isPending}
              onClick={() => setResyncOpen(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card row" style={{ padding: '14px 20px' }}>
        <span className={`badge ${run?.error ? 'b-cancel' : 'b-paid'}`}>{run?.error ? t('bank.error') : t('bank.ok')}</span>
        <span>{runLabel}</span>
        {run ? (
          <span className="muted" style={{ fontSize: 14 }}>
            {run.fetched ?? 0} {t('bank.entries')} · {run.matched ?? 0} {t('bank.auto')} ·{' '}
            {run.partial ?? 0} {t('bank.partial')} · {run.unmatched ?? 0} {t('bank.openWord')}
          </span>
        ) : null}
      </section>

      <div role="tablist" aria-label={t('bank.bookings')} className="tabs">
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'open' ? ' on' : ''}`}
          onClick={() => setTab('open')}
        >
          {t('bank.tabOpen')} ({openTxs.length})
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'done' ? ' on' : ''}`}
          onClick={() => setTab('done')}
        >
          {t('bank.tabDone')} ({doneTxs.length})
        </button>
        <button
          type="button"
          role="tab"
          className={`tab${tab === 'ignored' ? ' on' : ''}`}
          onClick={() => setTab('ignored')}
        >
          {t('bank.tabIgnored')} ({ignoredTxs.length})
        </button>
      </div>

      {tab === 'open' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {openTxs.map((tx) => {
            const { reason, suggestions } = suggestionsFor(tx, candidates, lang);
            return (
              <article className="card" key={String(tx._id)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{tx.counterpartyName || t('bank.unknown')}</div>
                    <div className="num muted" style={{ fontSize: 13, marginTop: 2 }}>
                      {tx.counterpartyIban} · {formatDate(tx.date)}
                    </div>
                  </div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 500, color: '#1E5B32' }}>
                    {formatEUR(tx.amountCents)}
                  </div>
                </div>
                <div className="ref-box">
                  <span className="muted">{t('bank.purpose')}:</span> <span className="num">{tx.description}</span>
                  <div className="reason">{reason}</div>
                </div>
                {suggestions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div className="lbl">{t('bank.suggestions')}</div>
                    {suggestions.map((s) => (
                      <div className="sug" key={s.id}>
                        <div style={{ minWidth: 0 }}>
                          <span className="num">{s.invoiceNumber}</span> · {s.clientName}
                          <div className="muted" style={{ fontSize: 13 }}>{s.why}</div>
                        </div>
                        <div className="row">
                          <span className="num">{formatEUR(s.openCents)}</span>
                          <button
                            type="button"
                            className="btn"
                            onClick={() => doAssign(String(tx._id), s.id)}
                          >
                            {t('bank.assign')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="row acts">
                  <Link className="btn ghost" to="/invoices">
                    {t('bank.otherInvoice')}
                  </Link>
                  <button type="button" className="btn ghost" onClick={() => doIgnore(String(tx._id))}>
                    {t('bank.noInvoice')}
                  </button>
                </div>
              </article>
            );
          })}
          {openTxs.length === 0 ? (
            <section className="card empty">{t('bank.allDone')}</section>
          ) : null}
        </div>
      ) : null}

      {tab === 'done' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('tbl.date')}</th>
                  <th>{t('bank.cp')}</th>
                  <th>{t('bank.invoice')}</th>
                  <th>{t('bank.method')}</th>
                  <th className="right">{t('bank.amount')}</th>
                  <th>{t('bank.result')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {doneTxs.map((tx) => {
                  const inv = invoiceById.get(String(tx.matchedInvoiceId));
                  return (
                    <tr key={String(tx._id)}>
                      <td data-l={t('tbl.date')} className="num">{formatDate(tx.date)}</td>
                      <td data-l={t('bank.cp')}>{tx.counterpartyName}</td>
                      <td data-l={t('bank.invoice')} className="num">
                        {inv ? <Link to={`/invoices/${String(inv._id)}`}>{inv.invoiceNumber}</Link> : '—'}
                      </td>
                      <td data-l={t('bank.method')}>{tx.matchMethod === 'reference' ? t('bank.ref') : t('bank.manual')}</td>
                      <td data-l={t('bank.amount')} className="num right">{formatEUR(tx.amountCents)}</td>
                      <td data-l={t('bank.result')}>
                        <span className={`badge ${inv?.status === 'paid' ? 'b-paid' : 'b-sent'}`}>
                          {inv?.status === 'paid' ? t('status.paid') : t('status.partial')}
                        </span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn ghost sm"
                          onClick={() => doUnassign(String(tx._id))}
                        >
                          {t('bank.unassign')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {doneTxs.length === 0 ? <p className="empty">{t('bank.noDone')}</p> : null}
        </section>
      ) : null}

      {tab === 'ignored' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('tbl.date')}</th>
                  <th>{t('bank.cp')}</th>
                  <th>{t('bank.purpose')}</th>
                  <th className="right">{t('bank.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ignoredTxs.map((tx) => (
                  <tr key={String(tx._id)}>
                    <td data-l={t('tbl.date')} className="num">{formatDate(tx.date)}</td>
                    <td data-l={t('bank.cp')}>{tx.counterpartyName}</td>
                    <td data-l={t('bank.purpose')} className="num w">{tx.description}</td>
                    <td data-l={t('bank.amount')} className="num right">{formatEUR(tx.amountCents)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost sm"
                        onClick={() => doUnignore(String(tx._id))}
                      >
                        {t('bank.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ignoredTxs.length === 0 ? <p className="empty">{t('bank.noIgnored')}</p> : null}
        </section>
      ) : null}
    </>
  );
}
