import { useEffect, useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { REVERSE_CHARGE_RATE, type BankBookingMode } from '../../server/lib/accounting/postingRules';
import { suggest, type SuggestTx } from '../../server/lib/accounting/suggest';
import { purposePrefix } from '../../server/lib/accounting/ruleLearning';
import { formatDate } from '../lib/format';

export interface RuleRow {
  id: string;
  kreditorNumber: number;
  name: string;
  ibans: string[];
  namePatterns: string[];
  purposePatterns: string[];
  defaultAccount: string | null;
  defaultVatRate: number | null;
  defaultMode: BankBookingMode;
  archived: boolean;
  autoBook: boolean;
  /** 'learned' rules come from a confirmed booking, not from the dialog. */
  origin: 'manual' | 'learned';
  learnedAt: string | null;
  openHits: number;
}

/** What the rule dialog starts from: an existing rule (with id) or a prefill. */
export interface RuleDraft {
  id?: string;
  name: string;
  ibans: string[];
  namePatterns: string[];
  purposePatterns: string[];
  defaultAccount: string | null;
  defaultVatRate: number | null;
  defaultMode: BankBookingMode;
  autoBook?: boolean;
}

interface AccountRow {
  number: string;
  name: string;
}

interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  items: { name: string; kreditorNumber: number | null; action: 'create' | 'update' | 'unchanged' }[];
  errors: string[];
}

export const emptyRule: RuleDraft = {
  name: '',
  ibans: [],
  namePatterns: [],
  purposePatterns: [],
  defaultAccount: null,
  defaultVatRate: 0.19,
  defaultMode: 'normal',
};

/** Prefill for "Regel anlegen" from an inbox row without a suggestion. */
export function draftFromTransaction(tx: {
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
}): RuleDraft {
  // Firefly shows "(unknown destination)" etc. when GLS gives no counterparty.
  const name = tx.counterpartyName && !tx.counterpartyName.startsWith('(') ? tx.counterpartyName.trim() : '';
  // The same prefix the learned rules use: cut before the invoice number or Drive link.
  const purpose = purposePrefix(tx.description) ?? tx.description.trim().slice(0, 40);
  return {
    ...emptyRule,
    name: name || purpose,
    ibans: tx.counterpartyIban ? [tx.counterpartyIban] : [],
    namePatterns: name ? [name] : [],
    purposePatterns: name || tx.counterpartyIban || !purpose ? [] : [purpose],
  };
}

const lines = (text: string) => text.split('\n').map((s) => s.trim()).filter((s) => s !== '');

function vatLabel(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)} %`;
}

/** `openRows`: open bank rows to show how many this rule would match while typing. */
export function RuleDialog({ draft, openRows, onDone }: { draft: RuleDraft; openRows?: SuggestTx[]; onDone: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const accounts = trpc.accounts.list.useQuery();
  const create = trpc.suppliers.create.useMutation();
  const update = trpc.suppliers.update.useMutation();

  const [name, setName] = useState(draft.name);
  const [ibans, setIbans] = useState(draft.ibans.join('\n'));
  const [purposePatterns, setPurposePatterns] = useState(draft.purposePatterns.join('\n'));
  const [namePatterns, setNamePatterns] = useState(draft.namePatterns.join('\n'));
  const [account, setAccount] = useState(draft.defaultAccount ?? '');
  const [vatRate, setVatRate] = useState(draft.defaultVatRate ?? 0);
  const [mode, setMode] = useState<BankBookingMode>(draft.defaultMode);
  const [autoBook, setAutoBook] = useState(!!draft.autoBook);

  const title = draft.id ? t('rules.dialog.titleEdit') : t('rules.dialog.titleNew');

  const hits = useMemo(() => {
    if (!openRows) return null;
    const probe = {
      _id: 'draft',
      kreditorNumber: 0,
      name,
      ibans: lines(ibans),
      namePatterns: lines(namePatterns),
      purposePatterns: lines(purposePatterns),
    };
    return openRows.filter((r) => suggest(r, [probe])).length;
  }, [openRows, name, ibans, namePatterns, purposePatterns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  async function save() {
    const fields = {
      name: name.trim(),
      ibans: lines(ibans),
      purposePatterns: lines(purposePatterns),
      namePatterns: lines(namePatterns),
      defaultAccount: mode === 'vatOnly' ? null : account.trim() || null,
      defaultVatRate: mode === 'reverseCharge' ? REVERSE_CHARGE_RATE : vatRate,
      defaultMode: mode,
      autoBook,
    };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...fields });
      else await create.mutateAsync(fields);
      await utils.suppliers.invalidate();
      await utils.bookings.invalidate();
      toast.show(hits ? t('rules.savedWithHits').replace('{n}', String(hits)) : t('rules.saved'));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
    >
      <section
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: '100%', maxWidth: 640, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}
      >
        <div className="card-head">
          <h2>{title}</h2>
        </div>
        <div className="grid-form" style={{ padding: 16 }}>
          <label className="lab" style={{ gridColumn: '1 / -1' }}>
            {t('rules.dialog.name')}
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="lab" style={{ gridColumn: '1 / -1' }}>
            {t('rules.dialog.ibans')}
            <textarea className="field num" rows={2} value={ibans} onChange={(e) => setIbans(e.target.value)} />
          </label>
          <label className="lab">
            {t('rules.dialog.purposePatterns')}
            <textarea className="field" rows={3} value={purposePatterns} onChange={(e) => setPurposePatterns(e.target.value)} />
          </label>
          <label className="lab">
            {t('rules.dialog.namePatterns')}
            <textarea className="field" rows={3} value={namePatterns} onChange={(e) => setNamePatterns(e.target.value)} />
          </label>
          <p className="muted" style={{ gridColumn: '1 / -1', margin: 0, fontSize: 13 }}>{t('rules.dialog.onePerLine')}</p>
          <label className="lab">
            {t('bookings.dialog.account')}
            <input
              className="field"
              list="rule-accounts"
              value={account}
              disabled={mode === 'vatOnly'}
              placeholder={t('rules.dialog.noAccount')}
              onChange={(e) => setAccount(e.target.value)}
            />
          </label>
          <label className="lab">
            {t('bookings.dialog.vat')}
            <select
              className="field"
              value={mode === 'reverseCharge' ? REVERSE_CHARGE_RATE : vatRate}
              disabled={mode === 'reverseCharge'}
              onChange={(e) => setVatRate(Number(e.target.value))}
            >
              <option value={0}>0 %</option>
              <option value={0.07}>7 %</option>
              <option value={0.19}>19 %</option>
            </select>
          </label>
          <label className="lab">
            {t('bookings.dialog.mode')}
            <select
              className="field"
              value={mode}
              onChange={(e) => {
                const next = e.target.value as BankBookingMode;
                setMode(next);
                if (next === 'reverseCharge') setVatRate(REVERSE_CHARGE_RATE);
              }}
            >
              <option value="normal">{t('bookings.dialog.mode.normal')}</option>
              <option value="vatOnly">{t('bookings.dialog.mode.vatOnly')}</option>
              <option value="reverseCharge">{t('bookings.dialog.mode.reverseCharge')}</option>
            </select>
          </label>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" checked={autoBook} aria-describedby="rule-autobook-hint" onChange={(e) => setAutoBook(e.target.checked)} />
              {t('rules.dialog.autoBook')}
            </label>
            <p id="rule-autobook-hint" className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{t('rules.dialog.autoBookHint')}</p>
          </div>
        </div>
        {hits !== null ? (
          <p className="muted" style={{ margin: 0, padding: '0 16px', fontSize: 14 }} aria-live="polite">
            {hits > 0 ? t('rules.matchesOpen').replace('{n}', String(hits)) : t('rules.matchesNone')}
          </p>
        ) : null}
        <datalist id="rule-accounts">
          {((accounts.data ?? []) as unknown as AccountRow[]).map((a) => (
            <option key={a.number} value={a.number}>{`${a.number} ${a.name}`}</option>
          ))}
        </datalist>
        <div className="row acts" style={{ padding: 16 }}>
          <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
          <button
            type="button"
            className="btn"
            disabled={name.trim() === '' || create.isPending || update.isPending}
            onClick={save}
          >
            {t('common.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

function ImportDialog({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const importJson = trpc.suppliers.importJson.useMutation();
  const [json, setJson] = useState('');
  const [check, setCheck] = useState<ImportResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  function edit(text: string) {
    setJson(text);
    setCheck(null);
  }

  async function run(dryRun: boolean) {
    try {
      const res = (await importJson.mutateAsync({ json, dryRun })) as ImportResult;
      if (dryRun) {
        setCheck(res);
        return;
      }
      if (res.errors.length > 0) {
        setCheck(res);
        return;
      }
      await utils.suppliers.invalidate();
      await utils.bookings.invalidate();
      toast.show(t('rules.importDialog.done'));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const summary = check
    ? t('rules.importDialog.summary')
        .replace('{created}', String(check.created))
        .replace('{updated}', String(check.updated))
        .replace('{unchanged}', String(check.unchanged))
    : '';

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
    >
      <section
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label={t('rules.importDialog.title')}
        style={{ width: '100%', maxWidth: 720, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}
      >
        <div className="card-head">
          <div>
            <h2>{t('rules.importDialog.title')}</h2>
            <p className="page-sub" style={{ margin: '4px 0 0' }}>{t('rules.importDialog.hint')}</p>
          </div>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea
            className="field num"
            rows={10}
            value={json}
            aria-label={t('rules.importDialog.title')}
            placeholder='[{ "name": "…", "namePatterns": ["…"], "defaultAccount": "6855", "defaultVatRate": 0 }]'
            onChange={(e) => edit(e.target.value)}
          />
          <label className="lab">
            {t('rules.importDialog.file')}
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) edit(await file.text());
              }}
            />
          </label>
          {check ? (
            check.errors.length > 0 ? (
              <ul style={{ color: 'var(--danger)', margin: 0, paddingLeft: 20 }}>
                {check.errors.map((err) => <li key={err}>{err}</li>)}
              </ul>
            ) : (
              <div>
                <div className="lbl">{summary}</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                  {check.items.map((item) => (
                    <li key={`${item.kreditorNumber ?? ''}-${item.name}`}>
                      <span>{item.name}</span>{' '}
                      <span className={`badge ${item.action === 'create' ? 'b-paid' : item.action === 'update' ? 'b-sent' : 'b-draft'}`}>
                        {t(`rules.importDialog.action.${item.action}`)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </div>
        <div className="row acts" style={{ padding: 16 }}>
          <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
          <button type="button" className="btn ghost" disabled={json.trim() === '' || importJson.isPending} onClick={() => run(true)}>
            {t('rules.importDialog.check')}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!check || check.errors.length > 0 || importJson.isPending}
            onClick={() => run(false)}
          >
            {t('rules.importDialog.apply')}
          </button>
        </div>
      </section>
    </div>
  );
}

function MatchChips({ rule }: { rule: RuleRow }) {
  const { t } = useLanguage();
  const chips = [
    ...rule.ibans.map((v) => ['rules.match.iban', v] as const),
    ...rule.purposePatterns.map((v) => ['rules.match.purpose', v] as const),
    ...rule.namePatterns.map((v) => ['rules.match.name', v] as const),
  ];
  if (chips.length === 0) return <span className="badge b-over">{t('rules.match.none')}</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {chips.map(([label, value]) => (
        <div key={`${label}-${value}`}>
          <span className="muted" style={{ fontSize: 13 }}>{t(label)}: </span>
          <span className="num">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function RulesSection({ year }: { year: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const isAdmin = me.data?.user?.role === 'admin';
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const [importing, setImporting] = useState(false);
  const overview = trpc.suppliers.overview.useQuery({ year, includeArchived: showArchived });
  const setArchived = trpc.suppliers.setArchived.useMutation();
  const rows = (overview.data ?? []) as RuleRow[];

  async function toggleArchived(rule: RuleRow) {
    try {
      await setArchived.mutateAsync({ id: rule.id, archived: !rule.archived });
      await utils.suppliers.invalidate();
      await utils.bookings.invalidate();
      toast.show(rule.archived ? t('rules.restored') : t('rules.archivedToast'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function exportRules() {
    try {
      const data = await utils.suppliers.exportJson.fetch();
      const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `queen-regeln-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card flush" style={{ marginBottom: 16 }} aria-label={t('rules.title')}>
      <div className="card-head" style={{ padding: 16 }}>
        <div>
          <h2>{t('rules.title')}</h2>
          <p className="page-sub" style={{ margin: '4px 0 0', maxWidth: '70ch' }}>{t('rules.sub')}</p>
        </div>
      </div>
      <div className="row acts" style={{ padding: '0 16px 16px' }}>
        {isAdmin ? (
          <>
            <button type="button" className="btn" onClick={() => setDraft(emptyRule)}>{t('rules.new')}</button>
            <button type="button" className="btn ghost" onClick={() => setImporting(true)}>{t('rules.import')}</button>
            <button type="button" className="btn ghost" onClick={exportRules}>{t('rules.export')}</button>
          </>
        ) : (
          <span className="muted">{t('rules.readOnly')}</span>
        )}
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('rules.showArchived')}
        </label>
      </div>
      <div className="table-wrap">
        <table className="resp">
          <thead>
            <tr>
              <th>{t('rules.col.number')}</th>
              <th>{t('rules.col.name')}</th>
              <th>{t('rules.col.match')}</th>
              <th>{t('rules.col.account')}</th>
              <th>{t('rules.col.vat')}</th>
              <th className="right">{t('rules.col.hits')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.archived ? 'muted' : undefined}>
                <td data-l={t('rules.col.number')} className="num">{r.kreditorNumber}</td>
                <td data-l={t('rules.col.name')}>
                  {r.name}
                  {r.origin === 'learned' ? (
                    <>
                      {' '}
                      <span
                        className="badge b-draft"
                        title={t('rules.learnedTitle').replace('{date}', formatDate(r.learnedAt))}
                      >
                        {t('rules.learned')}
                      </span>
                    </>
                  ) : null}
                  {r.autoBook ? <> <span className="badge b-sent" title={t('rules.autoTitle')}>{t('rules.auto')}</span></> : null}
                  {r.archived ? <> <span className="badge b-draft">{t('rules.archived')}</span></> : null}
                </td>
                <td data-l={t('rules.col.match')} className="w"><MatchChips rule={r} /></td>
                <td data-l={t('rules.col.account')} className="num">
                  {r.defaultMode === 'vatOnly'
                    ? t('rules.vatOnly')
                    : r.defaultMode === 'reverseCharge'
                      ? `${r.defaultAccount ?? '—'} · ${t('rules.reverseCharge')}`
                      : (r.defaultAccount ?? '—')}
                </td>
                <td data-l={t('rules.col.vat')} className="num">
                  {vatLabel(r.defaultMode === 'reverseCharge' ? REVERSE_CHARGE_RATE : r.defaultVatRate)}
                </td>
                <td data-l={t('rules.col.hits')} className="num right">{t('rules.hits').replace('{n}', String(r.openHits))}</td>
                <td>
                  {isAdmin ? (
                    <div className="row acts" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="btn ghost sm" onClick={() => setDraft({ ...r })}>{t('rules.edit')}</button>
                      <button type="button" className="btn ghost sm" disabled={setArchived.isPending} onClick={() => toggleArchived(r)}>
                        {r.archived ? t('rules.restore') : t('rules.archive')}
                      </button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && !overview.isLoading ? <p className="empty">{t('rules.empty')}</p> : null}
      {draft ? <RuleDialog draft={draft} onDone={() => setDraft(null)} /> : null}
      {importing ? <ImportDialog onDone={() => setImporting(false)} /> : null}
    </section>
  );
}
