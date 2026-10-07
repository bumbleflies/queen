import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { toEntryLines, type EntryFormRow } from '../lib/entryForm';

type Tab = 'journal' | 'balances' | 'account';

const KIND_LABEL: Record<string, string> = {
  opening: 'Eröffnung',
  invoice: 'Rechnung',
  credit_note: 'Storno-RE',
  payment: 'Zahlung',
  manual: 'Manuell',
  reversal: 'Storno',
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
      toast.show('Buchung erfasst.');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Buchung erfassen</h2>
      </div>
      <div className="grid-form" style={{ padding: 16 }}>
        <label className="lab">
          Art
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as 'manual' | 'opening')}>
            <option value="manual">Manuelle Buchung</option>
            <option value="opening">Eröffnungsbilanz (01.01.)</option>
          </select>
        </label>
        <label className="lab">
          Datum
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={kind === 'opening'} />
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          Buchungstext
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
            <th>Konto</th>
            <th className="right">Soll</th>
            <th className="right">Haben</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td data-l="Konto">
                <input className="field num" list="ledger-accounts" value={row.account} onChange={(e) => update(i, { account: e.target.value })} />
              </td>
              <td data-l="Soll" className="right">
                <input className="field n" inputMode="decimal" value={row.debit} onChange={(e) => update(i, { debit: e.target.value })} />
              </td>
              <td data-l="Haben" className="right">
                <input className="field n" inputMode="decimal" value={row.credit} onChange={(e) => update(i, { credit: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, { account: '', debit: '', credit: '' }])}>
                + Zeile
              </button>
            </td>
            <td data-l="Soll" className="num right">{formatEUR(parsed.debitCents)}</td>
            <td data-l="Haben" className="num right">{formatEUR(parsed.creditCents)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
      {parsed.errors.map((e) => (
        <p key={e} style={{ color: 'var(--danger)', margin: '8px 16px' }}>{e}</p>
      ))}
      {!balanced && parsed.errors.length === 0 && parsed.lines.length > 0 ? (
        <p style={{ color: 'var(--danger)', margin: '8px 16px' }}>Soll und Haben sind nicht ausgeglichen.</p>
      ) : null}
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onDone}>Abbrechen</button>
        <button
          type="button"
          className="btn"
          disabled={!balanced || parsed.errors.length > 0 || !text.trim() || postManual.isPending}
          onClick={submit}
        >
          Buchen
        </button>
      </div>
    </section>
  );
}

export function LedgerPage() {
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

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...((fiscalYears.data ?? []) as unknown as { year: number }[]).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  async function doReverse(id: string) {
    const reason = window.prompt('Grund für die Stornobuchung?');
    if (!reason) return;
    try {
      await reverse.mutateAsync({ id, reason });
      await utils.ledger.invalidate();
      toast.show('Storniert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const entries = (journal.data ?? []) as unknown as EntryRow[];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Buchhaltung</h1>
          <p className="page-sub">Journal, Summen- und Saldenliste, Kontoblatt (SKR04)</p>
        </div>
        <div className="row acts">
          <select className="field" style={{ width: 'auto' }} value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Geschäftsjahr">
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setShowForm(true)}>Buchung erfassen</button>
        </div>
      </header>

      {showForm ? <EntryForm key={year} year={year} onDone={() => setShowForm(false)} /> : null}

      <nav className="row" style={{ margin: '0 0 16px' }} aria-label="Ansicht">
        {(['journal', 'balances', 'account'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'chip on' : 'chip'} onClick={() => setTab(t)}>
            {t === 'journal' ? 'Journal' : t === 'balances' ? 'Saldenliste' : 'Konto'}
          </button>
        ))}
      </nav>

      {tab === 'journal' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Datum</th>
                  <th>Text</th>
                  <th>Art</th>
                  <th>Buchungen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id} className={e.active ? '' : 'muted'}>
                    <td data-l="Nr." className="num">{e.entryNumber}</td>
                    <td data-l="Datum" className="num">{formatDate(e.date)}</td>
                    <td data-l="Text" className="w">{e.text}</td>
                    <td data-l="Art">{KIND_LABEL[e.source.kind] ?? e.source.kind}</td>
                    <td data-l="Buchungen" className="num">
                      {e.lines.map((l, i) => (
                        <div key={`${i}-${l.account}-${l.debitCents}-${l.creditCents}`}>
                          {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                        </div>
                      ))}
                    </td>
                    <td>
                      {e.active && (e.source.kind === 'manual' || e.source.kind === 'opening') ? (
                        <button type="button" className="btn ghost" onClick={() => doReverse(e._id)}>Stornieren</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? <p className="empty">Keine Buchungen in {year}.</p> : null}
        </section>
      ) : null}

      {tab === 'balances' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Bezeichnung</th>
                  <th className="right">Soll</th>
                  <th className="right">Haben</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(balances.data?.rows ?? []).map((r) => (
                  <tr key={r.account}>
                    <td data-l="Konto" className="num">
                      <button type="button" className="btn ghost sm" onClick={() => { setAccount(r.account); setTab('account'); }}>{r.account}</button>
                    </td>
                    <td data-l="Bezeichnung" className="w">{r.name}</td>
                    <td data-l="Soll" className="num right">{formatEUR(r.debitCents)}</td>
                    <td data-l="Haben" className="num right">{formatEUR(r.creditCents)}</td>
                    <td data-l="Saldo" className="num right">
                      {formatEUR(Math.abs(r.balanceCents))} {r.balanceCents >= 0 ? 'S' : 'H'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Summe</td>
                  <td data-l="Soll" className="num right">{formatEUR(balances.data?.debitCents ?? 0)}</td>
                  <td data-l="Haben" className="num right">{formatEUR(balances.data?.creditCents ?? 0)}</td>
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
            <h2>Kontoblatt {account}</h2>
            <input className="field num" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Konto" style={{ width: '6rem' }} />
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Nr.</th>
                  <th>Text</th>
                  <th className="right">Soll</th>
                  <th className="right">Haben</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data ?? []).map((r) => (
                  <tr key={r.entryId}>
                    <td data-l="Datum" className="num">{formatDate(r.date)}</td>
                    <td data-l="Nr." className="num">{r.entryNumber}</td>
                    <td data-l="Text" className="w">{r.text}</td>
                    <td data-l="Soll" className="num right">{r.debitCents ? formatEUR(r.debitCents) : ''}</td>
                    <td data-l="Haben" className="num right">{r.creditCents ? formatEUR(r.creditCents) : ''}</td>
                    <td data-l="Saldo" className="num right">{formatEUR(r.runningCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(ledger.data ?? []).length === 0 ? <p className="empty">Keine Buchungen auf {account}.</p> : null}
        </section>
      ) : null}
    </>
  );
}
