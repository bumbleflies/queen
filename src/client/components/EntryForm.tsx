import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { toEntryLines, type EntryFormError, type EntryFormRow } from '../lib/entryForm';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

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

export function EntryForm({ year, onDone }: { year: number; onDone: () => void }) {
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
    <section className="card" style={{ marginBottom: 16 }}>
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
