import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { toEntryLines, type EntryFormError, type EntryFormRow } from '../lib/entryForm';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

type Tab = 'journal' | 'balances' | 'account';

const KIND_KEYS: Record<string, DictKey> = {
  opening: 'ledger.kind.opening',
  invoice: 'ledger.kind.invoice',
  credit_note: 'ledger.kind.credit_note',
  payment: 'ledger.kind.payment',
  manual: 'ledger.kind.manual',
  reversal: 'ledger.kind.reversal',
};

const ERROR_KEYS: Record<Exclude<EntryFormError['code'], 'badAmount'>, DictKey> = {
  noAccount: 'ledger.err.noAccount',
  bothSides: 'ledger.err.bothSides',
  noAmount: 'ledger.err.noAmount',
  notPositive: 'ledger.err.notPositive',
};

const emptyRows = (): EntryFormRow[] => [
  { account: '', debit: '', credit: '' },
  { account: '', debit: '', credit: '' },
];

interface EntryRow {
  _id: string;
  entryNumber: string;
  date: string;
  text: string;
  active: boolean;
  source: { kind: string };
  lines: { account: string; debitCents: number; creditCents: number }[];
}

function EntryForm({ year, onDone }: { year: number; onDone: () => void }) {
  const { t } = useLanguage();
  const errorText = (e: EntryFormError) =>
    `${t('ledger.err.row')} ${e.row}: ${
      e.code === 'badAmount' ? `${t('ledger.err.amount')} „${e.raw}“ ${t('ledger.err.invalid')}` : t(ERROR_KEYS[e.code])
    }`;
  const toast = useToast();
  const utils = trpc.useUtils();
  const accounts = trpc.accounts.list.useQuery();
  const postManual = trpc.ledger.postManual.useMutation();
  const [kind, setKind] = useState<'manual' | 'opening'>('manual');
  const [date, setDate] = useState(`${year}-01-01`);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EntryFormRow[]>(emptyRows);
  const parsed = useMemo(() => toEntryLines(rows), [rows]);
  const balanced = parsed.debitCents === parsed.creditCents && parsed.debitCents > 0;

  function update(i: number, patch: Partial<EntryFormRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    try {
      // Parse <input type="date"> as a LOCAL date — new Date('YYYY-MM-DD') would be UTC midnight.
      const [y, m, d] = date.split('-').map(Number);
      await postManual.mutateAsync({
        kind,
        date: new Date(y, m - 1, d),
        ...(kind === 'opening' ? { year } : {}),
        text,
        lines: parsed.lines,
      });
      await utils.ledger.invalidate();
      toast.show(t('ledger.posted'));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>{t('ledger.new')}</h2>
      </div>
      <div className="grid-form" style={{ padding: 16 }}>
        <label className="lab">
          {t('ledger.kindLabel')}
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as 'manual' | 'opening')}>
            <option value="manual">{t('ledger.kindManual')}</option>
            <option value="opening">{t('ledger.kindOpening')}</option>
          </select>
        </label>
        <label className="lab">
          {t('tbl.date')}
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={kind === 'opening'} />
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          {t('ledger.text')}
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <datalist id="ledger-accounts">
        {((accounts.data ?? []) as unknown as { number: string; name: string }[]).map((a) => (
          <option key={a.number} value={a.number}>{`${a.number} ${a.name}`}</option>
        ))}
      </datalist>
      <div className="table-wrap">
      <table className="resp">
        <thead>
          <tr>
            <th>{t('ledger.account')}</th>
            <th className="right">{t('ledger.debit')}</th>
            <th className="right">{t('ledger.credit')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td data-l="Konto">
                <input className="field num" list="ledger-accounts" value={row.account} onChange={(e) => update(i, { account: e.target.value })} />
              </td>
              <td data-l={t('ledger.debit')} className="right">
                <input className="field n" inputMode="decimal" value={row.debit} onChange={(e) => update(i, { debit: e.target.value })} />
              </td>
              <td data-l={t('ledger.credit')} className="right">
                <input className="field n" inputMode="decimal" value={row.credit} onChange={(e) => update(i, { credit: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, { account: '', debit: '', credit: '' }])}>
                {t('ledger.addRow')}
              </button>
            </td>
            <td data-l={t('ledger.debit')} className="num right">{formatEUR(parsed.debitCents)}</td>
            <td data-l={t('ledger.credit')} className="num right">{formatEUR(parsed.creditCents)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
      {parsed.errors.map((e) => (
        <p key={`${e.row}-${e.code}`} style={{ color: 'var(--danger)', margin: '8px 16px' }}>{errorText(e)}</p>
      ))}
      {!balanced && parsed.errors.length === 0 && parsed.lines.length > 0 ? (
        <p style={{ color: 'var(--danger)', margin: '8px 16px' }}>{t('ledger.unbalanced')}</p>
      ) : null}
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
        <button
          type="button"
          className="btn"
          disabled={!balanced || parsed.errors.length > 0 || !text.trim() || postManual.isPending}
          onClick={submit}
        >
          {t('ledger.post')}
        </button>
      </div>
    </section>
  );
}

interface BackfillReport {
  invoices: number;
  creditNotes: number;
  payments: number;
  skipped: { ref: string; reason: string }[];
}

function BackfillSection({ year }: { year: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const backfill = trpc.admin.ledgerBackfill.useMutation();
  const [report, setReport] = useState<BackfillReport | null>(null);

  async function check() {
    try {
      const res = await backfill.mutateAsync({ year, dryRun: true });
      setReport(res as unknown as BackfillReport);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function apply() {
    if (!window.confirm(t('ledger.backfill.confirm'))) return;
    try {
      const res = await backfill.mutateAsync({ year, dryRun: false });
      setReport(res as unknown as BackfillReport);
      await utils.ledger.invalidate();
      toast.show(t('ledger.backfill.posted'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const empty =
    report !== null &&
    report.invoices === 0 &&
    report.creditNotes === 0 &&
    report.payments === 0 &&
    report.skipped.length === 0;

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <h2>{t('ledger.backfill.title')}</h2>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>{t('ledger.backfill.sub')}</p>
        </div>
        <div className="row acts">
          <button type="button" className="btn ghost" disabled={backfill.isPending} onClick={check}>
            {t('ledger.backfill.check')}
          </button>
          <button type="button" className="btn" disabled={backfill.isPending} onClick={apply}>
            {t('ledger.backfill.apply')}
          </button>
        </div>
      </div>
      {report ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <span className="num">{report.invoices} {t('ledger.backfill.invoices')}</span>
            <span className="num">{report.creditNotes} {t('ledger.backfill.creditNotes')}</span>
            <span className="num">{report.payments} {t('ledger.backfill.payments')}</span>
          </div>
          {empty ? <p className="empty" style={{ margin: 0 }}>{t('ledger.backfill.none')}</p> : null}
          {report.skipped.length > 0 ? (
            <div>
              <div className="lbl">{t('ledger.backfill.skipped')}</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {report.skipped.map((s) => (
                  <li key={s.ref} className="num">{s.ref} — {s.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function LedgerPage() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('journal');
  const [account, setAccount] = useState('1800');
  const [showForm, setShowForm] = useState(false);
  const fiscalYears = trpc.ledger.fiscalYears.useQuery();
  const journal = trpc.ledger.list.useQuery({ year }, { enabled: tab === 'journal' });
  const balances = trpc.ledger.trialBalance.useQuery({ year }, { enabled: tab === 'balances' });
  const ledger = trpc.ledger.accountLedger.useQuery({ year, account }, { enabled: tab === 'account' });
  const reverse = trpc.ledger.reverse.useMutation();
  const fullSync = trpc.bank.syncNow.useMutation();

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...((fiscalYears.data ?? []) as unknown as { year: number }[]).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  async function doReverse(id: string) {
    const reason = window.prompt(t('ledger.reversePrompt'));
    if (!reason) return;
    try {
      await reverse.mutateAsync({ id, reason });
      await utils.ledger.invalidate();
      toast.show(t('ledger.reversed'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function doFullBankSync() {
    if (!window.confirm(t('ledger.resyncConfirm'))) return;
    try {
      const res = await fullSync.mutateAsync({ full: true });
      if (res.ok) {
        toast.show(`${t('bank.synced')} ${res.fetched} ${t('bank.bookings')}.`);
      } else {
        toast.error(res.error ?? t('bank.syncFail'));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const entries = (journal.data ?? []) as unknown as EntryRow[];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('nav.ledger')}</h1>
          <p className="page-sub">{t('ledger.sub')}</p>
        </div>
        <div className="row acts">
          <select className="field" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label={t('ledger.fiscalYear')}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn ghost"
            disabled={fullSync.isPending}
            title={t('ledger.resyncConfirm')}
            onClick={doFullBankSync}
          >
            {fullSync.isPending ? t('ledger.resyncRunning') : t('ledger.resyncBank')}
          </button>
          <button type="button" className="btn" onClick={() => setShowForm(true)}>{t('ledger.new')}</button>
        </div>
      </header>

      {showForm ? <EntryForm key={year} year={year} onDone={() => setShowForm(false)} /> : null}

      <BackfillSection key={`backfill-${year}`} year={year} />

      <nav className="row" style={{ margin: '0 0 16px' }} aria-label={t('ledger.view')}>
        {(['journal', 'balances', 'account'] as Tab[]).map((id) => (
          <button key={id} type="button" className={tab === id ? 'chip on' : 'chip'} onClick={() => setTab(id)}>
            {t(`ledger.tab.${id}`)}
          </button>
        ))}
      </nav>

      {tab === 'journal' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('tbl.nr')}</th>
                  <th>{t('tbl.date')}</th>
                  <th>{t('ledger.textShort')}</th>
                  <th>{t('ledger.kindLabel')}</th>
                  <th>{t('ledger.entries')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id} className={e.active ? '' : 'muted'}>
                    <td data-l={t('tbl.nr')} className="num">{e.entryNumber}</td>
                    <td data-l={t('tbl.date')} className="num">{formatDate(e.date)}</td>
                    <td data-l={t('ledger.textShort')} className="w">{e.text}</td>
                    <td data-l={t('ledger.kindLabel')}>{KIND_KEYS[e.source.kind] ? t(KIND_KEYS[e.source.kind]) : e.source.kind}</td>
                    <td data-l={t('ledger.entries')} className="num">
                      {e.lines.map((l, i) => (
                        <div key={`${i}-${l.account}-${l.debitCents}-${l.creditCents}`}>
                          {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                        </div>
                      ))}
                    </td>
                    <td>
                      {e.active && (e.source.kind === 'manual' || e.source.kind === 'opening') ? (
                        <button type="button" className="btn ghost" onClick={() => doReverse(e._id)}>{t('ledger.reverse')}</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? <p className="empty">{t('ledger.emptyIn')} {year}.</p> : null}
        </section>
      ) : null}

      {tab === 'balances' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('ledger.account')}</th>
                  <th>{t('ledger.accountName')}</th>
                  <th className="right">{t('ledger.debit')}</th>
                  <th className="right">{t('ledger.credit')}</th>
                  <th className="right">{t('ledger.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(balances.data?.rows ?? []).map((r) => (
                  <tr key={r.account}>
                    <td data-l={t('ledger.account')} className="num">
                      <button type="button" className="btn ghost sm" onClick={() => { setAccount(r.account); setTab('account'); }}>{r.account}</button>
                    </td>
                    <td data-l={t('ledger.accountName')} className="w">{r.name}</td>
                    <td data-l={t('ledger.debit')} className="num right">{formatEUR(r.debitCents)}</td>
                    <td data-l={t('ledger.credit')} className="num right">{formatEUR(r.creditCents)}</td>
                    <td data-l={t('ledger.balance')} className="num right">
                      {formatEUR(Math.abs(r.balanceCents))} {r.balanceCents >= 0 ? 'S' : 'H'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>{t('ledger.sum')}</td>
                  <td data-l={t('ledger.debit')} className="num right">{formatEUR(balances.data?.debitCents ?? 0)}</td>
                  <td data-l={t('ledger.credit')} className="num right">{formatEUR(balances.data?.creditCents ?? 0)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'account' ? (
        <section className="card flush">
          <div className="card-head">
            <h2>{t('ledger.accountLedger')} {account}</h2>
            <input className="field num" value={account} onChange={(e) => setAccount(e.target.value)} aria-label={t('ledger.account')} style={{ width: '6rem' }} />
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>{t('tbl.date')}</th>
                  <th>{t('tbl.nr')}</th>
                  <th>{t('ledger.textShort')}</th>
                  <th className="right">{t('ledger.debit')}</th>
                  <th className="right">{t('ledger.credit')}</th>
                  <th className="right">{t('ledger.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data ?? []).map((r) => (
                  <tr key={r.entryId}>
                    <td data-l="Datum" className="num">{formatDate(r.date)}</td>
                    <td data-l="Nr." className="num">{r.entryNumber}</td>
                    <td data-l="Text" className="w">{r.text}</td>
                    <td data-l={t('ledger.debit')} className="num right">{r.debitCents ? formatEUR(r.debitCents) : ''}</td>
                    <td data-l={t('ledger.credit')} className="num right">{r.creditCents ? formatEUR(r.creditCents) : ''}</td>
                    <td data-l={t('ledger.balance')} className="num right">{formatEUR(r.runningCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(ledger.data ?? []).length === 0 ? <p className="empty">{t('ledger.emptyOn')} {account}.</p> : null}
        </section>
      ) : null}
    </>
  );
}
