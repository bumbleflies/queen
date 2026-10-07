import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatDateTime, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { BookingDialog, type InboxRowLike } from '../components/BookingDialog';
import { EntryForm } from '../components/EntryForm';
import { BackfillSection } from '../components/BackfillSection';
import { LedgerViews } from '../components/LedgerViews';
import { suggestionsFor, type OpenItem, type Suggestion } from '../lib/paymentSuggest';

type StateFilter = 'open' | 'done' | 'ignored';
type DirFilter = 'all' | 'in' | 'out';

interface StreamSuggestion {
  supplierId: string;
  supplierName: string;
  account?: string;
  vatRate?: number;
  mode: 'normal' | 'vatOnly';
}

interface StreamRow {
  id: string;
  fireflyJournalId: string;
  date: string | Date;
  direction: 'in' | 'out';
  amountCents: number;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
  ignored: boolean;
  receipt?: { fileName?: string; link?: string } | null;
  receiptMissingReason?: string | null;
  matchedInvoiceId?: string;
  matchMethod?: string;
  state: 'open' | 'invoice' | 'booked';
  suggestion?: StreamSuggestion | null;
  invoice?: { invoiceNumber: string; status: string } | null;
  entry?: {
    entryId: string;
    entryNumber: string;
    lines: { account: string; debitCents: number; creditCents: number }[];
  } | null;
  supplierName?: string | null;
}

interface ReconcileRunRow {
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  error?: string | null;
}

function signed(amountCents: number, direction: 'in' | 'out'): number {
  return direction === 'out' ? -amountCents : amountCents;
}

function suggestionLabel(s: StreamSuggestion | null): string | null {
  if (!s) return null;
  const account = s.account ?? 'USt';
  const vat = s.vatRate === undefined ? '' : ` · ${Math.round(s.vatRate * 100)} %`;
  return `${s.supplierName} → ${account}${vat}`;
}

export function FinancePage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const [stateF, setStateF] = useState<StateFilter>('open');
  const [dir, setDir] = useState<DirFilter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<InboxRowLike | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [showLedger, setShowLedger] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);

  const fiscalYears = trpc.ledger.fiscalYears.useQuery();
  const stream = trpc.bookings.stream.useQuery({ year });
  const openItemsQuery = trpc.reports.openItems.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const stats = trpc.bookings.stats.useQuery({ year });
  const balance = trpc.bookings.balanceCheck.useQuery({ year });

  const assign = trpc.bank.assign.useMutation();
  const unassign = trpc.bank.unassign.useMutation();
  const ignore = trpc.bank.ignore.useMutation();
  const unignore = trpc.bank.unignore.useMutation();
  const syncNow = trpc.bank.syncNow.useMutation();
  const runNow = trpc.reconcile.runNow.useMutation();
  const bookBulk = trpc.bookings.bookBulk.useMutation();
  const unbook = trpc.bookings.unbook.useMutation();

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...((fiscalYears.data ?? []) as unknown as { year: number }[]).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  const openItems = (openItemsQuery.data?.items ?? []) as unknown as OpenItem[];
  const rows = (stream.data ?? []) as unknown as StreamRow[];

  const withInvoices = (r: StreamRow) => suggestionsFor(r, openItems, lang).suggestions.length > 0;
  const filtered = rows.filter((r) => {
    if (dir !== 'all' && r.direction !== dir) return false;
    if (stateF === 'open') return r.state === 'open' && !r.ignored;
    if (stateF === 'done') return r.state !== 'open';
    if (stateF === 'ignored') return r.state === 'open' && r.ignored;
    return true;
  });

  const suggestable = filtered.filter((r) => r.state === 'open' && !(r.direction === 'in' && withInvoices(r)));

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleAll() {
    setSelected((s) => (s.length === suggestable.length ? [] : suggestable.map((r) => r.id)));
  }

  async function doAssign(bankTxId: string, invoiceId: string) {
    try {
      await assign.mutateAsync({ bankTxId, invoiceId });
      await utils.invalidate();
      toast.show(t('bank.assigned'));
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

  async function doIgnore(bankTxId: string) {
    try {
      await ignore.mutateAsync({ bankTxId });
      await utils.invalidate();
      toast.show(t('bank.ignored'));
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

  async function doUnbook(bankTxId: string) {
    const reason = window.prompt(t('bookings.unbookReason'));
    if (!reason) return;
    try {
      await unbook.mutateAsync({ bankTxId, reason });
      await utils.bookings.invalidate();
      await utils.ledger.invalidate();
      toast.show(t('bookings.booked'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doBulk() {
    try {
      const results = await bookBulk.mutateAsync({ bankTxIds: selected });
      const ok = results.filter((r) => r.ok).length;
      setSelected([]);
      await utils.bookings.invalidate();
      await utils.ledger.invalidate();
      toast.show(`${ok} ${t('bookings.bulkDone')}`);
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

  const run = (reconcile.data ?? null) as unknown as ReconcileRunRow | null;
  const runLabel = run?.finishedAt
    ? `${t('bank.lastRun')} ${formatDateTime(run.finishedAt)}`
    : t('bank.noRun');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('nav.finance')}</h1>
          <p className="page-sub">{t('finance.sub')}</p>
        </div>
        <div className="row acts">
          <select className="field" style={{ width: 'auto' }} value={year} onChange={(e) => { setYear(Number(e.target.value)); setSelected([]); setActive(null); }} aria-label={t('ledger.fiscalYear')}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="button" className="btn ghost" onClick={handleSync}>{t('bank.syncNow')}</button>
          <button type="button" className="btn ghost" onClick={() => setResyncOpen(true)}>{t('bank.fullSync')}</button>
          <button type="button" className="btn ghost" onClick={handleRun}>{t('bank.runNow')}</button>
          <button type="button" className="btn" onClick={() => setShowEntry(!showEntry)}>{t('ledger.new')}</button>
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
            <button type="button" className="btn ghost" disabled={syncNow.isPending} onClick={() => setResyncOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </section>
      ) : null}

      <section className="card" style={{ padding: '14px 20px', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row">
          <span className={`badge ${run?.error ? 'b-cancel' : 'b-paid'}`}>{run?.error ? t('bank.error') : t('bank.ok')}</span>
          <span>{runLabel}</span>
          {run ? (
            <span className="muted" style={{ fontSize: 14 }}>
              {run.fetched ?? 0} {t('bank.entries')} · {run.matched ?? 0} {t('bank.auto')} · {run.partial ?? 0} {t('bank.partial')} · {run.unmatched ?? 0} {t('bank.openWord')}
            </span>
          ) : null}
        </div>
        <div className="row">
          <span>{t('bookings.balance.ledger')}: <span className="num">{formatEUR(balance.data?.ledgerCents ?? 0)}</span></span>
          <span>
            {t('bookings.balance.bank')}: <span className="num">{balance.data?.bankCents == null ? t('bookings.balance.unavailable') : formatEUR(balance.data.bankCents)}</span>
          </span>
          {balance.data?.diffCents != null && balance.data.diffCents !== 0 ? (
            <span style={{ color: 'var(--danger)' }}>{t('bookings.balance.diff')}: <span className="num">{formatEUR(balance.data.diffCents)}</span></span>
          ) : (
            <span className="muted">{t('bookings.balance.ok')}</span>
          )}
          <span className="muted" style={{ fontSize: 14 }}>
            {stats.data?.open ?? 0} {t('bookings.open')} · {stats.data?.missingReceipts ?? 0} {t('bookings.missingReceipts')}
          </span>
        </div>
      </section>

      {active ? (
        <div style={{ marginBottom: 16 }}>
          <BookingDialog year={year} tx={active} onDone={() => { setActive(null); }} />
        </div>
      ) : null}

      <nav className="row" style={{ margin: '0 0 16px' }} aria-label={t('ledger.view')}>
        {(['open', 'done', 'ignored'] as StateFilter[]).map((id) => (
          <button key={id} type="button" className={stateF === id ? 'chip on' : 'chip'} onClick={() => { setStateF(id); setSelected([]); }}>
            {t(`finance.state.${id}`)}
          </button>
        ))}
        {(['all', 'in', 'out'] as DirFilter[]).map((d) => (
          <button key={d} type="button" className={dir === d ? 'chip on' : 'chip'} onClick={() => { setDir(d); setSelected([]); }}>
            {t(`bookings.dir.${d}`)}
          </button>
        ))}
        <button type="button" className={showLedger ? 'chip on' : 'chip'} onClick={() => setShowLedger(!showLedger)}>
          {t('finance.journalToggle')}
        </button>
      </nav>

      {stateF === 'open' ? (
        <section className="card flush">
          <div className="row acts" style={{ padding: 16 }}>
            <button type="button" className="btn" disabled={selected.length === 0 || bookBulk.isPending} onClick={doBulk}>
              {t('bookings.bulk')} ({selected.length})
            </button>
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={suggestable.length > 0 && selected.length === suggestable.length} onChange={toggleAll} aria-label={t('bookings.bulk')} /></th>
                  <th>{t('bookings.col.date')}</th>
                  <th>{t('bookings.col.counterparty')}</th>
                  <th>{t('bookings.col.purpose')}</th>
                  <th className="right">{t('bookings.col.amount')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const { reason, suggestions } = suggestionsFor(r, openItems, lang);
                  return (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(r.id)}
                          disabled={!!(r.direction === 'in' && suggestions.length > 0) || !r.suggestion}
                          onChange={() => toggle(r.id)}
                          aria-label={r.description}
                        />
                      </td>
                      <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                      <td data-l={t('bookings.col.counterparty')}>
                        <div className="row" style={{ gap: 6 }}>
                          {r.ignored ? <span className="badge b-over">{t('bank.ignored')}</span> : null}
                          <span>{r.direction === 'out' ? '− ' : '+ '}{r.counterpartyName ?? t('bank.unknown')}</span>
                        </div>
                        {r.counterpartyIban ? <div className="muted num" style={{ fontSize: 13 }}>{r.counterpartyIban}</div> : null}
                      </td>
                      <td data-l={t('bookings.col.purpose')} className="w">
                        {suggestions.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <span className="muted num" style={{ fontSize: 13 }}>{r.description}</span>
                            <div className="lbl">{reason}</div>
                            {suggestions.map((s: Suggestion) => (
                              <div className="sug" key={s.id}>
                                <div style={{ minWidth: 0 }}>
                                  <span className="num">{s.invoiceNumber}</span> · {s.clientName}
                                  <div className="muted" style={{ fontSize: 13 }}>{s.why}</div>
                                </div>
                                <div className="row">
                                  <span className="num">{formatEUR(s.openCents)}</span>
                                  <button type="button" className="btn sm" onClick={() => doAssign(r.id, s.id)}>
                                    {t('bank.assign')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            <span className="num" title={r.description}>{r.description.slice(0, 80)}</span>
                            {r.direction === 'in' ? <div className="lbl">{reason}</div> : null}
                            {r.suggestion ? (
                              <div className="muted" style={{ fontSize: 13 }}>{suggestionLabel(r.suggestion)}</div>
                            ) : (
                              <div className="muted" style={{ fontSize: 13 }}>{t('bookings.noSuggestion')}</div>
                            )}
                          </>
                        )}
                      </td>
                      <td data-l={t('bookings.col.amount')} className="num right">{formatEUR(signed(r.amountCents, r.direction))}</td>
                      <td>
                        <div className="row acts" style={{ flexWrap: 'nowrap' }}>
                          <button type="button" className="btn ghost sm" onClick={() => setActive({ ...r, suggestion: r.suggestion ?? null })}>{t('bookings.book')}</button>
                          {r.direction === 'in' ? (
                            r.ignored ? (
                              <button type="button" className="btn ghost sm" onClick={() => doUnignore(r.id)}>{t('bank.restore')}</button>
                            ) : (
                              <button type="button" className="btn ghost sm" onClick={() => doIgnore(r.id)}>{t('bank.noInvoice')}</button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? <p className="empty">{t('bookings.empty')}</p> : null}
        </section>
      ) : (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('bookings.col.date')}</th>
                  <th>{t('bookings.col.counterparty')}</th>
                  <th>{t('bookings.col.purpose')}</th>
                  <th className="right">{t('bookings.col.amount')}</th>
                  <th>{t('bank.result')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="muted">
                    <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                    <td data-l={t('bookings.col.counterparty')}>
                      {r.direction === 'out' ? '− ' : '+ '}{r.state === 'booked' && r.supplierName ? r.supplierName : (r.counterpartyName ?? '')}
                    </td>
                    <td data-l={t('bookings.col.purpose')} className="w num" title={r.description}>{r.description.slice(0, 80)}</td>
                    <td data-l={t('bookings.col.amount')} className="num right">{formatEUR(signed(r.amountCents, r.direction))}</td>
                    {r.state === 'invoice' ? (
                      <>
                        <td data-l={t('bank.result')}>
                          <span className="row" style={{ gap: 6 }}>
                            <span className="num">
                              {r.invoice ? <Link to={`/invoices/${r.matchedInvoiceId}`}>{r.invoice.invoiceNumber}</Link> : '—'}
                            </span>
                            <span className={`badge ${r.invoice?.status === 'paid' ? 'b-paid' : 'b-sent'}`}>
                              {r.invoice?.status === 'paid' ? t('status.paid') : t('status.partial')}
                            </span>
                            <span className="muted">{r.matchMethod === 'reference' ? t('bank.ref') : t('bank.manual')}</span>
                          </span>
                        </td>
                        <td>
                          <button type="button" className="btn ghost sm" onClick={() => doUnassign(r.id)}>{t('bank.unassign')}</button>
                        </td>
                      </>
                    ) : r.state === 'booked' ? (
                      <>
                        <td data-l={t('ledger.entries')} className="num">
                          {r.entry?.entryNumber ? <div>{r.entry.entryNumber}</div> : null}
                          {(r.entry?.lines ?? []).map((l, i) => (
                            <div key={`${i}-${l.account}-${l.debitCents}-${l.creditCents}`}>
                              {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                            </div>
                          ))}
                          {r.receipt?.link ? (
                            <a href={r.receipt.link} target="_blank" rel="noreferrer">{r.receipt.fileName}</a>
                          ) : r.receiptMissingReason ? (
                            <span className="muted">{r.receiptMissingReason}</span>
                          ) : (
                            <span className="badge b-over">{t('bookings.receipt.missing')}</span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="btn ghost sm" onClick={() => doUnbook(r.id)}>{t('bookings.unbook')}</button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td data-l={t('bank.result')}>
                          <span className="badge b-over">{t('bank.ignored')}</span>
                        </td>
                        <td>
                          <button type="button" className="btn ghost sm" onClick={() => doUnignore(r.id)}>{t('bank.restore')}</button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 ? <p className="empty">{t('bookings.emptyBooked')}</p> : null}
        </section>
      )}

      {showEntry ? <EntryForm key={`entry-${year}`} year={year} onDone={() => setShowEntry(false)} /> : null}

      {showLedger ? (
        <>
          <BackfillSection key={`backfill-${year}`} year={year} />
          <LedgerViews year={year} />
        </>
      ) : null}
    </>
  );
}
