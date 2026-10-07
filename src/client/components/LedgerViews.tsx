import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

type LedgerView = 'journal' | 'balances' | 'account';

export const KIND_KEYS: Record<string, DictKey> = {
  opening: 'ledger.kind.opening',
  invoice: 'ledger.kind.invoice',
  credit_note: 'ledger.kind.credit_note',
  payment: 'ledger.kind.payment',
  manual: 'ledger.kind.manual',
  reversal: 'ledger.kind.reversal',
};

export interface EntryRow {
  _id: string;
  entryNumber: string;
  date: string;
  text: string;
  active: boolean;
  source: { kind: string };
  lines: { account: string; debitCents: number; creditCents: number }[];
}

/** Journal, Saldenliste and Kontoblatt — the reporting views of the immutable SKR04 ledger. */
export function LedgerViews({ year }: { year: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [view, setView] = useState<LedgerView>('journal');
  const [account, setAccount] = useState('1800');
  const journal = trpc.ledger.list.useQuery({ year }, { enabled: view === 'journal' });
  const balances = trpc.ledger.trialBalance.useQuery({ year }, { enabled: view === 'balances' });
  const accountLedger = trpc.ledger.accountLedger.useQuery({ year, account }, { enabled: view === 'account' });
  const reverse = trpc.ledger.reverse.useMutation();

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

  const entries = (journal.data ?? []) as unknown as EntryRow[];

  return (
    <>
      <nav className="row" style={{ margin: '16px 0' }} aria-label={t('ledger.view')}>
        {(['journal', 'balances', 'account'] as LedgerView[]).map((id) => (
          <button key={id} type="button" className={view === id ? 'chip on' : 'chip'} onClick={() => setView(id)}>
            {t(`ledger.tab.${id}`)}
          </button>
        ))}
      </nav>

      {view === 'journal' ? (
        <section className="card flush" style={{ marginBottom: 16 }}>
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

      {view === 'balances' ? (
        <section className="card flush" style={{ marginBottom: 16 }}>
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
                      <button type="button" className="btn ghost sm" onClick={() => { setAccount(r.account); setView('account'); }}>{r.account}</button>
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

      {view === 'account' ? (
        <section className="card flush" style={{ marginBottom: 16 }}>
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
                {(accountLedger.data ?? []).map((r) => (
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
          {(accountLedger.data ?? []).length === 0 ? <p className="empty">{t('ledger.emptyOn')} {account}.</p> : null}
        </section>
      ) : null}
    </>
  );
}
