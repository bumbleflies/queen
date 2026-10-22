import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatDate, formatDateTime, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { BookingDialog, type InboxRowLike } from '../components/BookingDialog';
import { EntryForm } from '../components/EntryForm';
import { BackfillSection } from '../components/BackfillSection';
import { AvailableCashCard } from '../components/AvailableCashCard';
import { LedgerViews } from '../components/LedgerViews';
import { RuleDialog, RulesSection, draftFromTransaction, type RuleDraft } from '../components/RulesSection';
import { FullSyncDialog, ReceiptPickDialog, StornoDialog, type StornoTarget } from '../components/FinanceDialogs';
import { suggestionsFor, type OpenItem, type Suggestion } from '../lib/paymentSuggest';
import type { BankBookingMode, SplitPart } from '../../server/lib/accounting/postingRules';

type Tab = 'open' | 'done' | 'ignored' | 'rules' | 'journal';
type DirFilter = 'all' | 'in' | 'out';

const TABS: Tab[] = ['open', 'done', 'ignored', 'rules', 'journal'];

interface StreamSuggestion {
  supplierId?: string;
  kreditorNumber?: number;
  matchedBy: 'iban' | 'purpose' | 'name' | 'history' | 'receipt';
  lastBookedAt?: string | Date;
  split?: SplitPart[];
  reading?: { vendor: string; totalCents: number; lines: { vatRate: number; grossCents: number; account: string }[] };
  supplierName: string;
  account?: string;
  vatRate?: number;
  mode: BankBookingMode;
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
    auto?: boolean;
    lines: { account: string; debitCents: number; creditCents: number }[];
  } | null;
  supplierName?: string | null;
}

interface ReceiptMatch {
  id: string;
  name: string;
  link: string;
}

interface ReconcileRunRow {
  finishedAt?: string | Date | null;
  fetched?: number;
  matched?: number;
  partial?: number;
  unmatched?: number;
  autoBooked?: number;
  autoBookFailed?: number;
  error?: string | null;
}

interface AccountRow {
  number: string;
  name: string;
}

function signed(amountCents: number, direction: 'in' | 'out'): number {
  return direction === 'out' ? -amountCents : amountCents;
}

/** A suggestion that can be booked without asking anything (same rule as bookBulk). */
function complete(s: StreamSuggestion | null | undefined): s is StreamSuggestion {
  if (!s) return false;
  if (s.split && s.split.length >= 2) return true;
  return s.vatRate !== undefined && (s.mode === 'vatOnly' || !!s.account);
}

type ReadHint = 'failed' | 'noText' | 'unavailable' | 'noReceipt';

/** Firefly placeholders like "(unknown destination)" are not a counterparty. */
function counterparty(name: string | null | undefined): string | null {
  return name && !name.startsWith('(') ? name : null;
}

export function FinancePage() {
  const { t, lang } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab) ? (params.get('tab') as Tab) : 'open';
  const dir: DirFilter = params.get('dir') === 'in' || params.get('dir') === 'out' ? (params.get('dir') as DirFilter) : 'all';
  const accountParam = params.get('account');
  const [year, setYear] = useState(new Date().getFullYear());
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<InboxRowLike | null>(null);
  const [showEntry, setShowEntry] = useState(false);
  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [storno, setStorno] = useState<StornoTarget | null>(null);
  const [receiptFor, setReceiptFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [resyncOpen, setResyncOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const me = trpc.me.useQuery();
  const isAdmin = me.data?.user?.role === 'admin';
  const fiscalYears = trpc.ledger.fiscalYears.useQuery();
  const stream = trpc.bookings.stream.useQuery({ year });
  const receiptMatches = trpc.bookings.receiptMatches.useQuery({ year }, { retry: false });
  const openItemsQuery = trpc.reports.openItems.useQuery();
  const reconcile = trpc.reconcile.status.useQuery();
  const stats = trpc.bookings.stats.useQuery({ year });
  const balance = trpc.bookings.balanceCheck.useQuery({ year });
  const suppliers = trpc.suppliers.list.useQuery();
  const accounts = trpc.accounts.list.useQuery();

  const assign = trpc.bank.assign.useMutation();
  const ignore = trpc.bank.ignore.useMutation();
  const unignore = trpc.bank.unignore.useMutation();
  const unassign = trpc.bank.unassign.useMutation();
  const syncNow = trpc.bank.syncNow.useMutation();
  const runNow = trpc.reconcile.runNow.useMutation();
  const book = trpc.bookings.book.useMutation();
  const readReceipt = trpc.bookings.readReceipt.useMutation();
  const [readHints, setReadHints] = useState<Record<string, ReadHint>>({});
  const [reading, setReading] = useState<string | null>(null);
  const bookBulk = trpc.bookings.bookBulk.useMutation();
  const unbook = trpc.bookings.unbook.useMutation();

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...((fiscalYears.data ?? []) as unknown as { year: number }[]).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  const accountNames = useMemo(
    () => new Map(((accounts.data ?? []) as unknown as AccountRow[]).map((a) => [a.number, a.name])),
    [accounts.data],
  );
  const openItems = (openItemsQuery.data?.items ?? []) as unknown as OpenItem[];
  const rows = (stream.data ?? []) as unknown as StreamRow[];
  const matches = (receiptMatches.data?.matches ?? {}) as Record<string, ReceiptMatch>;

  const openRows = rows.filter((r) => r.state === 'open' && !r.ignored);
  const invoiceHits = (r: StreamRow) => (r.direction === 'in' ? suggestionsFor(r, openItems, lang).suggestions.length > 0 : false);
  const bookableRow = (r: StreamRow) => !invoiceHits(r) && complete(r.suggestion);
  const counts = {
    open: openRows.length,
    sug: openRows.filter(bookableRow).length,
    noRule: openRows.filter((r) => !invoiceHits(r) && !r.suggestion).length,
    inv: openRows.filter(invoiceHits).length,
    done: rows.filter((r) => r.state !== 'open').length,
    ignored: rows.filter((r) => r.state === 'open' && r.ignored).length,
  };

  const byDir = (r: StreamRow) => dir === 'all' || r.direction === dir;
  const inbox = openRows.filter(byDir);
  const suggestable = inbox.filter(bookableRow);
  const chosen = selected.filter((id) => suggestable.some((r) => r.id === id));
  const bulkIds = chosen.length > 0 ? chosen : suggestable.map((r) => r.id);
  const listed = rows.filter((r) => byDir(r) && (tab === 'done' ? r.state !== 'open' : r.state === 'open' && r.ignored));

  function setTab(next: Tab) {
    setSelected([]);
    setParams((p) => {
      p.set('tab', next);
      return p;
    });
  }

  function setDir(next: DirFilter) {
    setSelected([]);
    setParams((p) => {
      if (next === 'all') p.delete('dir');
      else p.set('dir', next);
      return p;
    });
  }

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function refresh() {
    await utils.bookings.invalidate();
    await utils.ledger.invalidate();
  }

  async function undo(bankTxIds: string[]) {
    try {
      for (const bankTxId of bankTxIds) await unbook.mutateAsync({ bankTxId, reason: t('finance.undoReason') });
      await refresh();
      toast.show(t('finance.undone'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function bookOne(r: StreamRow) {
    const s = r.suggestion;
    if (!complete(s)) return;
    const match = matches[r.id];
    try {
      const res = await book.mutateAsync({
        bankTxId: r.id,
        account: s.account ?? '',
        vatRate: s.vatRate ?? 0,
        mode: s.mode,
        ...(s.split ? { split: s.split } : {}),
        supplierId: s.supplierId,
        receipt: match ? { driveFileId: match.id, fileName: match.name, link: match.link } : undefined,
      });
      setSelected((sel) => sel.filter((x) => x !== r.id));
      await refresh();
      toast.show(t('finance.booked').replace('{entry}', res?.entryNumber ?? ''), { label: t('finance.undo'), onClick: () => undo([r.id]) });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function readOne(r: StreamRow) {
    setReading(r.id);
    try {
      const res = await readReceipt.mutateAsync(readHints[r.id] === 'failed' || readHints[r.id] === 'noText' ? { bankTxId: r.id, force: true } : { bankTxId: r.id });
      setReadHints((h) => {
        const next = { ...h };
        if (res.status === 'ok') delete next[r.id];
        else next[r.id] = res.status;
        return next;
      });
      if (res.status === 'ok') await refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setReading(null);
    }
  }

  async function doBulk() {
    try {
      const results = await bookBulk.mutateAsync({ bankTxIds: bulkIds });
      const ok = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      setSelected([]);
      await refresh();
      if (ok.length > 0) {
        toast.show(
          t('finance.bulkDone').replace('{n}', String(ok.length)).replace('{r}', String(ok.filter((r) => r.receipt).length)),
          { label: t('finance.undo'), onClick: () => undo(ok.map((r) => r.bankTxId)) },
        );
      }
      if (failed.length > 0) {
        toast.error(t('finance.bulkFailed').replace('{n}', String(failed.length)).replace('{msg}', failed[0].error ?? ''));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function bankAction(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      await utils.invalidate();
      toast.show(message);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function handleSync(full: boolean) {
    setMenuOpen(false);
    try {
      const result = await syncNow.mutateAsync(full ? { full: true } : undefined);
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
  const runLabel = run?.finishedAt ? `${t('bank.lastRun')} ${formatDateTime(run.finishedAt)}` : t('bank.noRun');
  const bal = balance.data;

  function outcome(r: StreamRow) {
    const { reason, suggestions } = suggestionsFor(r, openItems, lang);
    if (suggestions.length > 0) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {suggestions.map((s: Suggestion) => (
            <div className="sug outcome inv" key={s.id} style={{ marginTop: 0 }}>
              <div style={{ minWidth: 0 }}>
                <span className="what num">{s.invoiceNumber}</span> · {s.clientName} · <span className="num">{formatEUR(s.openCents)}</span>
                <div className="rc">{s.why}</div>
              </div>
              <button type="button" className="btn sm" onClick={() => bankAction(() => assign.mutateAsync({ bankTxId: r.id, invoiceId: s.id }), t('bank.assigned'))}>
                {t('bank.assign')}
              </button>
            </div>
          ))}
        </div>
      );
    }
    const match = matches[r.id];
    const receiptLine = match ? (
      <span className="rc">
        {t('finance.outcome.receipt')} <a href={match.link} target="_blank" rel="noreferrer">{match.name}</a>
      </span>
    ) : null;
    const s = r.suggestion;
    return (
      <>
        {r.direction === 'in' ? <div className="lbl" style={{ marginTop: 6 }}>{reason}</div> : null}
        {s ? (
          <div className="outcome ok">
            <span className="what">
              ✓ {s.split ? t('finance.outcome.split').replace('{n}', String(s.split.length)) : s.mode === 'vatOnly' ? t('finance.outcome.vatOnly') : `${s.account ?? '—'} ${accountNames.get(s.account ?? '') ?? ''}`.trim()}
              {s.mode === 'reverseCharge' ? ` · ${t('finance.outcome.reverseCharge')}` : ''}
              {s.vatRate !== undefined ? ` · ${Math.round(s.vatRate * 100)} %` : ''}
            </span>
            <span className="rc">
              {s.matchedBy === 'receipt'
                ? t('finance.outcome.receipt.read').replace('{vendor}', s.reading?.vendor ?? s.supplierName)
                : s.matchedBy === 'history' && s.lastBookedAt
                  ? t('finance.outcome.history').replace('{date}', formatDate(s.lastBookedAt))
                  : t('finance.outcome.rule').replace('{name}', s.supplierName)}
            </span>
            {s.reading
              ? s.reading.lines.map((l) => (
                <span className="rc num" key={`${l.account}-${l.vatRate}-${l.grossCents}`}>
                  {Math.round(l.vatRate * 100)} % · {formatEUR(l.grossCents)}
                </span>
              ))
              : null}
            {receiptLine ?? (receiptMatches.data?.available ? <span className="rc">{t('finance.outcome.noReceipt')}</span> : null)}
          </div>
        ) : (
          <div className="outcome warn">
            <span className="what">{t('finance.outcome.noRule')}</span>
            {receiptLine}
            {readHints[r.id] ? <span className="rc">{t(`finance.readReceipt.${readHints[r.id]}`)}</span> : null}
          </div>
        )}
      </>
    );
  }

  function rowActions(r: StreamRow) {
    const hasInvoice = invoiceHits(r);
    const openDialog = () => setActive({ ...r, suggestion: r.suggestion ?? null });
    return (
      <div className="row acts" style={{ flexWrap: 'nowrap' }}>
        {hasInvoice ? null : complete(r.suggestion) ? (
          <>
            <button type="button" className="btn sm" disabled={book.isPending} onClick={() => bookOne(r)}>{t('bookings.book')}</button>
            <button type="button" className="btn ghost sm" onClick={openDialog}>{t('finance.adjust')}</button>
          </>
        ) : r.suggestion ? (
          <button type="button" className="btn sm" onClick={openDialog}>{t('finance.adjust')}</button>
        ) : (
          <>
            {matches[r.id] && receiptMatches.data?.readingAvailable ? (
              <button type="button" className="btn ghost sm" disabled={reading === r.id} onClick={() => readOne(r)}>{t('finance.readReceipt')}</button>
            ) : null}
            {isAdmin ? (
              <button type="button" className="btn honey sm" onClick={() => setRuleDraft(draftFromTransaction(r))}>{t('rules.new')}</button>
            ) : null}
            <button type="button" className="btn ghost sm" onClick={openDialog}>{t('finance.manual')}</button>
          </>
        )}
        {r.direction === 'in' ? (
          <button type="button" className="btn ghost sm" onClick={() => bankAction(() => ignore.mutateAsync({ bankTxId: r.id }), t('bank.ignored'))}>
            {t('bank.noInvoice')}
          </button>
        ) : null}
      </div>
    );
  }

  const tabCount: Partial<Record<Tab, number>> = {
    open: counts.open,
    done: counts.done,
    ignored: counts.ignored,
    rules: (suppliers.data ?? []).length,
  };
  const tabLabel: Record<Tab, string> = {
    open: t('finance.state.open'),
    done: t('finance.state.done'),
    ignored: t('finance.state.ignored'),
    rules: t('finance.rulesToggle'),
    journal: t('finance.journalToggle'),
  };

  const dirSwitch = (
    <div className="seg" role="group" aria-label={t('finance.dir')}>
      {(['all', 'in', 'out'] as DirFilter[]).map((d) => (
        <button key={d} type="button" className={dir === d ? 'on' : ''} aria-pressed={dir === d} onClick={() => setDir(d)}>
          {t(`bookings.dir.${d}`)}
        </button>
      ))}
    </div>
  );

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
          <button type="button" className="btn ghost" onClick={() => setShowEntry(!showEntry)}>{t('ledger.new')}</button>
          <div className="menu-wrap" ref={menuRef}>
            <button
              type="button"
              className="btn ghost"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t('finance.more')}
              title={t('finance.more')}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="menu" role="menu">
                <button type="button" role="menuitem" onClick={() => handleSync(false)}>{t('bank.syncNow')}</button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    void bankAction(() => runNow.mutateAsync(), t('bank.runStarted'));
                  }}
                >
                  {t('bank.runNow')}
                </button>
                <button type="button" role="menuitem" className="danger" onClick={() => { setMenuOpen(false); setResyncOpen(true); }}>
                  {t('bank.fullSync')} …
                </button>
                <div className="meta">
                  {run?.error ? <span style={{ color: 'var(--danger)' }}>{t('bank.error')}: {run.error}</span> : runLabel}
                  {run ? ` · ${run.fetched ?? 0} ${t('bank.entries')} · ${run.matched ?? 0} ${t('bank.auto')}` : null}
                  {run?.autoBooked ? ` · ${t('finance.autoBooked').replace('{n}', String(run.autoBooked))}` : null}
                  {run?.autoBookFailed ? ` · ${t('finance.autoBookFailed').replace('{n}', String(run.autoBookFailed))}` : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <AvailableCashCard year={year} />

      <section className="card fin-summary" aria-label={t('finance.summary.open')}>
        <div><span className="big num">{counts.open}</span> {t('finance.summary.open')}</div>
        <div className="muted">
          {t('finance.summary.counts').replace('{sug}', String(counts.sug)).replace('{noRule}', String(counts.noRule)).replace('{inv}', String(counts.inv))}
        </div>
        <span className="sep" />
        <div>
          {stats.data?.missingReceipts ? (
            <span className="badge b-over">{t('finance.summary.missingReceipts').replace('{n}', String(stats.data.missingReceipts))}</span>
          ) : (
            <span className="muted">{t('finance.summary.receiptsOk')}</span>
          )}
        </div>
        <span className="sep" />
        {bal?.diffCents == null ? (
          <div className="muted">{t('bookings.balance.unavailable')}</div>
        ) : bal.diffCents === 0 ? (
          <div className="bal-ok">{t('finance.summary.bankOk')}</div>
        ) : (
          <div className="bal-bad">{t('finance.summary.bankDiff').replace('{diff}', formatEUR(bal.diffCents))}</div>
        )}
        {run?.error ? <span className="badge b-cancel">{t('bank.error')}</span> : null}
      </section>

      {showEntry ? <EntryForm key={`entry-${year}`} year={year} onDone={() => setShowEntry(false)} /> : null}

      <nav className="tabs" role="tablist" aria-label={t('ledger.view')}>
        {TABS.map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>
            {tabLabel[id]}
            {tabCount[id] !== undefined ? <span className="count num">{tabCount[id]}</span> : null}
          </button>
        ))}
      </nav>

      {tab === 'open' ? (
        counts.open === 0 && stream.data ? (
          <section className="card done-state" style={{ marginTop: 14 }}>
            <div className="big">{t('finance.allDone')}</div>
            <p className="muted">{t('finance.allDoneSub').replace('{year}', String(year))}</p>
            <button type="button" className="btn ghost" onClick={() => setTab('done')}>{t('finance.showDone')}</button>
          </section>
        ) : (
          <>
            <div className="fin-subbar">
              {dirSwitch}
              <button type="button" className="btn" disabled={bulkIds.length === 0 || bookBulk.isPending} onClick={doBulk}>
                {chosen.length > 0
                  ? t('finance.bulkSelected').replace('{n}', String(chosen.length))
                  : suggestable.length === 1
                    ? t('finance.bulkOne')
                    : suggestable.length > 1
                      ? t('finance.bulkAll').replace('{n}', String(suggestable.length))
                    : t('finance.bulkNone')}
              </button>
            </div>
            <section className="card flush">
              {inbox.length === 0 ? (
                <p className="empty">
                  {t('finance.filterEmpty')}{' '}
                  <button type="button" className="btn ghost sm" onClick={() => setDir('all')}>{t('finance.showAll')}</button>
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="resp">
                    <thead>
                      <tr>
                        <th />
                        <th>{t('bookings.col.date')}</th>
                        <th>{t('bookings.col.counterparty')} · {t('bookings.col.purpose')}</th>
                        <th className="right">{t('bookings.col.amount')}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {inbox.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {bookableRow(r) ? (
                              <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label={r.description} />
                            ) : null}
                          </td>
                          <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                          <td data-l={t('bookings.col.counterparty')} className="w">
                            <div>
                              <strong>{counterparty(r.counterpartyName) ?? t('finance.noCounterparty')}</strong>
                              {r.counterpartyIban ? <span className="muted num" style={{ fontSize: 12, marginLeft: 8 }}>{r.counterpartyIban}</span> : null}
                            </div>
                            <div className="num" style={{ fontSize: 13 }} title={r.description}>{r.description.slice(0, 120)}</div>
                            {outcome(r)}
                          </td>
                          <td data-l={t('bookings.col.amount')} className="num right" style={{ whiteSpace: 'nowrap' }}>{formatEUR(signed(r.amountCents, r.direction))}</td>
                          <td>{rowActions(r)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )
      ) : null}

      {tab === 'done' || tab === 'ignored' ? (
        <>
          <div className="fin-subbar">{dirSwitch}</div>
          <section className="card flush">
            {listed.length === 0 ? (
              <p className="empty">{tab === 'done' ? t('bookings.emptyBooked') : t('finance.ignoredEmpty')}</p>
            ) : (
              <div className="table-wrap">
                <table className="resp">
                  <thead>
                    <tr>
                      <th>{t('bookings.col.date')}</th>
                      <th>{t('bookings.col.counterparty')}</th>
                      <th className="right">{t('bookings.col.amount')}</th>
                      <th>{t('bank.result')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {listed.map((r) => (
                      <tr key={r.id}>
                        <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                        <td data-l={t('bookings.col.counterparty')} className="w">
                          <strong>{r.state === 'booked' && r.supplierName ? r.supplierName : (counterparty(r.counterpartyName) ?? t('finance.noCounterparty'))}</strong>
                          <div className="muted num" style={{ fontSize: 13 }} title={r.description}>{r.description.slice(0, 80)}</div>
                        </td>
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
                              <button type="button" className="btn ghost sm" onClick={() => bankAction(() => unassign.mutateAsync({ bankTxId: r.id }), t('bank.unassigned'))}>
                                {t('bank.unassign')}
                              </button>
                            </td>
                          </>
                        ) : r.state === 'booked' ? (
                          <>
                            <td data-l={t('ledger.entries')} className="num" style={{ fontSize: 13 }}>
                              {r.entry?.entryNumber ? (
                                <div>
                                  <strong>{r.entry.entryNumber}</strong>
                                  {r.entry.auto ? <> <span className="badge b-sent">{t('finance.autoBadge')}</span></> : null}
                                </div>
                              ) : null}
                              {(r.entry?.lines ?? []).map((l, i) => (
                                <div key={`${i}-${l.account}-${l.debitCents}-${l.creditCents}`}>
                                  {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                                </div>
                              ))}
                              <div style={{ marginTop: 4 }}>
                                {r.receipt?.link ? (
                                  <a href={r.receipt.link} target="_blank" rel="noreferrer">{r.receipt.fileName}</a>
                                ) : r.receiptMissingReason ? (
                                  <span className="muted">{r.receiptMissingReason}</span>
                                ) : (
                                  <span className="row" style={{ gap: 6 }}>
                                    <span className="badge b-over">{t('bookings.receipt.missing')}</span>
                                    <button type="button" className="btn ghost sm" onClick={() => setReceiptFor(r.id)}>{t('bookings.receipt.choose')}</button>
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn ghost sm"
                                onClick={() => setStorno({
                                  bankTxId: r.id,
                                  entryNumber: r.entry?.entryNumber ?? '',
                                  counterparty: r.supplierName ?? counterparty(r.counterpartyName) ?? t('finance.noCounterparty'),
                                  amountCents: signed(r.amountCents, r.direction),
                                })}
                              >
                                {t('bookings.unbook')}
                              </button>
                            </td>
                          </>
                        ) : (
                          <>
                            <td data-l={t('bank.result')}>
                              <span className="badge b-over">{t('bank.ignored')}</span>
                            </td>
                            <td>
                              <button type="button" className="btn ghost sm" onClick={() => bankAction(() => unignore.mutateAsync({ bankTxId: r.id }), t('bank.unignored'))}>
                                {t('bank.restore')}
                              </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {tab === 'rules' ? <div style={{ marginTop: 14 }}><RulesSection year={year} /></div> : null}

      {tab === 'journal' ? (
        <div style={{ marginTop: 14 }}>
          <BackfillSection key={`backfill-${year}`} year={year} />
          <LedgerViews key={accountParam ?? 'none'} year={year} initialView={accountParam ? 'account' : 'journal'} initialAccount={accountParam ?? '1800'} />
        </div>
      ) : null}

      {active ? <BookingDialog year={year} tx={active} onDone={() => setActive(null)} /> : null}
      {ruleDraft ? <RuleDialog draft={ruleDraft} openRows={openRows} onDone={() => setRuleDraft(null)} /> : null}
      {storno ? <StornoDialog target={storno} onClose={() => setStorno(null)} /> : null}
      {receiptFor ? <ReceiptPickDialog year={year} bankTxId={receiptFor} onClose={() => setReceiptFor(null)} /> : null}
      {resyncOpen ? <FullSyncDialog pending={syncNow.isPending} onConfirm={() => handleSync(true)} onClose={() => setResyncOpen(false)} /> : null}
    </>
  );
}
