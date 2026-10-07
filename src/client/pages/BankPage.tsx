import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { formatDate, formatDateTime, formatEUR } from '../lib/format';
import { parseReference } from '../lib/reference';
import { useLanguage } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/LanguageContext';

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

interface InvoiceSummary {
  _id: unknown;
  invoiceNumber: string;
  status: string;
}

interface ReconcileRunRow {
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

interface Suggestion {
  id: string;
  invoiceNumber: string;
  clientName: string;
  openCents: number;
  why: string;
  exact: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

const BANK_TEXT: Record<Lang, {
  noRef: string;
  mismatch: (customerNumber: number | null, invoiceNumber: string, actual: number) => string;
  recognized: string;
  whyRef: string;
  whyExact: string;
  whyPayer: string;
}> = {
  de: {
    noRef: 'Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.',
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Kundennummer ${customerNumber} passt nicht zu Rechnung ${invoiceNumber} (Kunde ${actual}).`,
    recognized: 'Verwendungszweck erkannt, Betrag/Nummer prüfen.',
    whyRef: 'Rechnungsnr. passt',
    whyExact: 'Betrag exakt',
    whyPayer: 'Auftraggeber ≈ Kunde',
  },
  en: {
    noRef: 'No reference in customerNo-invoiceNo format found.',
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Customer number ${customerNumber} does not match invoice ${invoiceNumber} (customer ${actual}).`,
    recognized: 'Reference recognized, check amount/number.',
    whyRef: 'Invoice no. matches',
    whyExact: 'Exact amount',
    whyPayer: 'Payer ≈ customer',
  },
};

function suggestionsFor(tx: BankTx, openItems: OpenItem[], lang: Lang = 'de'): { reason: string; suggestions: Suggestion[] } {
  const txt = BANK_TEXT[lang];
  const parsed = parseReference(tx.description);
  const out: Suggestion[] = [];
  let reason = txt.noRef;

  if (parsed) {
    const candidate = openItems.find((i) => i.invoiceNumber === parsed.invoiceNumber);
    if (candidate && parsed.customerNumber !== null && parsed.customerNumber !== candidate.customerNumber) {
      reason = txt.mismatch(parsed.customerNumber, parsed.invoiceNumber, candidate.customerNumber);
    } else if (candidate) {
      reason = txt.recognized;
    }
  }

  for (const item of openItems) {
    const whys: string[] = [];
    let exact = false;
    if (parsed && parsed.invoiceNumber === item.invoiceNumber) whys.push(txt.whyRef);
    if (item.openCents === tx.amountCents) {
      whys.push(txt.whyExact);
      exact = true;
    }
    if (
      tx.counterpartyName &&
      normalize(item.clientName).length > 0 &&
      normalize(tx.counterpartyName).includes(normalize(item.clientName))
    ) {
      whys.push(txt.whyPayer);
    }
    if (whys.length > 0) {
      out.push({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        clientName: item.clientName,
        openCents: item.openCents,
        why: whys.join(' · '),
        exact,
      });
    }
  }

  out.sort((a, b) => Number(b.exact) - Number(a.exact));
  return { reason, suggestions: out };
}

export function BankPage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const bank = trpc.bank.list.useQuery();
  const openItemsQuery = trpc.reports.openItems.useQuery();
  const invoices = trpc.invoices.list.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const assign = trpc.bank.assign.useMutation();
  const unassign = trpc.bank.unassign.useMutation();
  const ignore = trpc.bank.ignore.useMutation();
  const unignore = trpc.bank.unignore.useMutation();
  const syncNow = trpc.bank.syncNow.useMutation();
  const runNow = trpc.reconcile.runNow.useMutation();
  const { lang, t } = useLanguage();

  const [tab, setTab] = useState<'open' | 'done' | 'ignored'>('open');

  const txs = (bank.data ?? []) as unknown as BankTx[];
  const openItems = (openItemsQuery.data?.items ?? []) as unknown as OpenItem[];
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
          <button type="button" className="btn" onClick={handleRun}>
            {t('bank.runNow')}
          </button>
        </div>
      </header>

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
            const { reason, suggestions } = suggestionsFor(tx, openItems, lang);
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
