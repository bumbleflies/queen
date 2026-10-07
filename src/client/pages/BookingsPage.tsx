import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { BookingDialog, type InboxRowLike } from '../components/BookingDialog';
import type { BankBookingMode } from '../../server/lib/accounting/postingRules';

type Tab = 'inbox' | 'booked';
type DirFilter = 'all' | 'in' | 'out';

interface Suggestion {
  supplierId: string;
  supplierName: string;
  account?: string;
  vatRate?: number;
  mode: BankBookingMode;
}

interface InboxRow {
  id: string;
  fireflyJournalId: string;
  date: string | Date;
  direction: 'in' | 'out';
  amountCents: number;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
  ignored: boolean;
  suggestion: Suggestion | null;
}

interface BookedRow extends Omit<InboxRow, 'suggestion'> {
  entryId: string;
  entryNumber: string;
  lines: { account: string; debitCents: number; creditCents: number }[];
  supplierName?: string | null;
  receipt?: { fileName: string; link: string } | null;
  receiptMissingReason?: string | null;
}

function signed(amountCents: number, direction: 'in' | 'out'): number {
  return direction === 'out' ? -amountCents : amountCents;
}

function suggestionLabel(s: Suggestion | null): string | null {
  if (!s) return null;
  const account = s.account ?? 'USt';
  const vat = s.vatRate === undefined ? '' : ` · ${Math.round(s.vatRate * 100)} %`;
  return `${s.supplierName} → ${account}${vat}`;
}

export function BookingsPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('inbox');
  const [dir, setDir] = useState<DirFilter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<InboxRowLike | null>(null);
  const [bulkErrors, setBulkErrors] = useState<{ id: string; error: string }[]>([]);

  const fiscalYears = trpc.ledger.fiscalYears.useQuery();
  const inbox = trpc.bookings.inbox.useQuery({ year }, { enabled: tab === 'inbox' });
  const booked = trpc.bookings.booked.useQuery({ year }, { enabled: tab === 'booked' });
  const stats = trpc.bookings.stats.useQuery({ year });
  const balance = trpc.bookings.balanceCheck.useQuery({ year });
  const bookBulk = trpc.bookings.bookBulk.useMutation();
  const unbook = trpc.bookings.unbook.useMutation();

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...((fiscalYears.data ?? []) as unknown as { year: number }[]).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  const rows = ((inbox.data ?? []) as unknown as InboxRow[]).filter((r) => dir === 'all' || r.direction === dir);
  const bookedRows = ((booked.data ?? []) as unknown as BookedRow[]).filter((r) => dir === 'all' || r.direction === dir);
  const suggestable = rows.filter((r) => r.suggestion);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function toggleAll() {
    setSelected((s) => (s.length === suggestable.length ? [] : suggestable.map((r) => r.id)));
  }

  async function doBulk() {
    setBulkErrors([]);
    try {
      const results = await bookBulk.mutateAsync({ bankTxIds: selected });
      const ok = results.filter((r) => r.ok);
      const failed = results
        .filter((r) => !r.ok)
        .map((r) => ({ id: r.bankTxId, error: r.error ?? t('bookings.bulkFailed') }));
      setBulkErrors(failed);
      setSelected([]);
      await utils.bookings.invalidate();
      await utils.ledger.invalidate();
      toast.show(`${ok.length} ${t('bookings.bulkDone')}`);
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

  const bal = balance.data as unknown as
    | { ledgerCents: number; bankCents: number | null; diffCents: number | null; error?: string }
    | undefined;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('bookings.title')}</h1>
          <p className="page-sub">{t('bookings.sub')}</p>
        </div>
        <div className="row acts">
          <select className="field" style={{ width: 'auto' }} value={year} onChange={(e) => { setYear(Number(e.target.value)); setSelected([]); setActive(null); }} aria-label={t('ledger.fiscalYear')}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </header>

      <section className="card row" style={{ padding: '14px 20px', marginBottom: 16 }}>
        <span>{t('bookings.balance.ledger')}: <span className="num">{formatEUR(bal?.ledgerCents ?? 0)}</span></span>
        <span>
          {t('bookings.balance.bank')}: <span className="num">{bal?.bankCents == null ? t('bookings.balance.unavailable') : formatEUR(bal.bankCents)}</span>
        </span>
        {bal?.diffCents != null && bal.diffCents !== 0 ? (
          <span style={{ color: 'var(--danger)' }}>{t('bookings.balance.diff')}: <span className="num">{formatEUR(bal.diffCents)}</span></span>
        ) : (
          <span className="muted">{t('bookings.balance.ok')}</span>
        )}
        <span className="muted" style={{ fontSize: 14 }}>
          {stats.data?.open ?? 0} {t('bookings.open')} · {stats.data?.missingReceipts ?? 0} {t('bookings.missingReceipts')}
        </span>
      </section>

      {active && tab === 'inbox' ? (
        <div style={{ marginBottom: 16 }}>
          <BookingDialog year={year} tx={active} onDone={() => { setActive(null); }} />
        </div>
      ) : null}

      <nav className="row" style={{ margin: '0 0 16px' }} aria-label={t('ledger.view')}>
        {(['inbox', 'booked'] as Tab[]).map((id) => (
          <button key={id} type="button" className={tab === id ? 'chip on' : 'chip'} onClick={() => setTab(id)}>
            {t(`bookings.tab.${id}`)}
          </button>
        ))}
        {(['all', 'in', 'out'] as DirFilter[]).map((d) => (
          <button key={d} type="button" className={dir === d ? 'chip on' : 'chip'} onClick={() => setDir(d)}>
            {t(`bookings.dir.${d}`)}
          </button>
        ))}
      </nav>

      {tab === 'inbox' ? (
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
                  <th>{t('bookings.col.suggestion')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" checked={selected.includes(r.id)} disabled={!r.suggestion} onChange={() => toggle(r.id)} aria-label={r.description} /></td>
                    <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                    <td data-l={t('bookings.col.counterparty')}>
                      {r.direction === 'out' ? '− ' : '+ '}{r.counterpartyName ?? ''}
                      {r.counterpartyIban ? <div className="muted num" style={{ fontSize: 13 }}>{r.counterpartyIban}</div> : null}
                    </td>
                    <td data-l={t('bookings.col.purpose')} className="w" title={r.description}>{r.description.slice(0, 80)}</td>
                    <td data-l={t('bookings.col.amount')} className="num right">{formatEUR(signed(r.amountCents, r.direction))}</td>
                    <td data-l={t('bookings.col.suggestion')} className="muted">{suggestionLabel(r.suggestion) ?? t('bookings.noSuggestion')}</td>
                    <td>
                      <button type="button" className="btn ghost sm" onClick={() => setActive(r)}>{t('bookings.book')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? <p className="empty">{t('bookings.empty')}</p> : null}
          {bulkErrors.length > 0 ? (
            <ul style={{ margin: '8px 16px', paddingLeft: 20, color: 'var(--danger)' }}>
              {bulkErrors.map((e) => (
                <li key={e.id} className="num">{e.id} — {e.error}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {tab === 'booked' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('bookings.col.date')}</th>
                  <th>{t('bookings.col.entry')}</th>
                  <th>{t('bookings.col.counterparty')}</th>
                  <th>{t('bookings.col.purpose')}</th>
                  <th className="right">{t('bookings.col.amount')}</th>
                  <th>{t('ledger.entries')}</th>
                  <th>{t('bookings.col.receipt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {bookedRows.map((r) => (
                  <tr key={r.id}>
                    <td data-l={t('bookings.col.date')} className="num">{formatDate(r.date)}</td>
                    <td data-l={t('bookings.col.entry')} className="num">{r.entryNumber}</td>
                    <td data-l={t('bookings.col.counterparty')}>{r.supplierName ?? r.counterpartyName}</td>
                    <td data-l={t('bookings.col.purpose')} className="w" title={r.description}>{r.description.slice(0, 80)}</td>
                    <td data-l={t('bookings.col.amount')} className="num right">{formatEUR(signed(r.amountCents, r.direction))}</td>
                    <td data-l={t('ledger.entries')} className="num">
                      {r.lines.map((l, i) => (
                        <div key={`${i}-${l.account}-${l.debitCents}-${l.creditCents}`}>
                          {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                        </div>
                      ))}
                    </td>
                    <td data-l={t('bookings.col.receipt')}>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bookedRows.length === 0 ? <p className="empty">{t('bookings.emptyBooked')}</p> : null}
        </section>
      ) : null}
    </>
  );
}
