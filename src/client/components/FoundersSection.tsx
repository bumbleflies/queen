import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Modal } from './FinanceDialogs';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';

interface FounderRow {
  id: string;
  name: string;
  shortName: string;
  emails: string[];
  loginEmail: string;
  iban: string;
  bic: string;
  liabilityAccount: string;
  legacyCreditorNumber: number | null;
  active: boolean;
}

interface FounderDraft {
  name: string;
  shortName: string;
  emails: string;
  loginEmail: string;
  iban: string;
  bic: string;
  liabilityAccount: string;
  legacyCreditorNumber: string;
}

const emptyDraft: FounderDraft = {
  name: '',
  shortName: '',
  emails: '',
  loginEmail: '',
  iban: '',
  bic: '',
  liabilityAccount: '3500',
  legacyCreditorNumber: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmails(raw: string): string[] {
  return [...new Set(raw.split(/[,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, '').toUpperCase();
}

/** DE89370400440532013000 → DE89 3704 0044 0532 0130 00 (no data invented). */
function displayIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

function draftFrom(founder: FounderRow): FounderDraft {
  return {
    name: founder.name,
    shortName: founder.shortName,
    emails: founder.emails.join(', '),
    loginEmail: founder.loginEmail,
    iban: founder.iban,
    bic: founder.bic,
    liabilityAccount: founder.liabilityAccount,
    legacyCreditorNumber: founder.legacyCreditorNumber === null ? '' : String(founder.legacyCreditorNumber),
  };
}

function FounderDialog({ founder, onClose }: { founder: FounderRow | null; onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const create = trpc.founders.create.useMutation();
  const update = trpc.founders.update.useMutation();
  const [draft, setDraft] = useState<FounderDraft>(() => (founder ? draftFrom(founder) : emptyDraft));
  const [saving, setSaving] = useState(false);

  const emails = normalizeEmails(draft.emails);
  const loginEmail = draft.loginEmail.trim().toLowerCase();
  const iban = normalizeIban(draft.iban);
  const legacy = draft.legacyCreditorNumber.trim();
  const legacyNumber = legacy === '' ? undefined : Number(legacy);
  const valid =
    draft.name.trim() !== '' &&
    draft.shortName.trim() !== '' &&
    emails.length > 0 &&
    emails.every((email) => EMAIL_RE.test(email)) &&
    EMAIL_RE.test(loginEmail) &&
    loginEmail.endsWith('@bumbleflies.de') &&
    iban.length >= 15 &&
    iban.length <= 34 &&
    draft.bic.trim().length <= 11 &&
    /^\d{4}$/.test(draft.liabilityAccount.trim()) &&
    (legacyNumber === undefined ||
      (Number.isInteger(legacyNumber) && legacyNumber >= 70000 && legacyNumber <= 99999));

  function set(key: keyof FounderDraft, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      if (founder) {
        await update.mutateAsync({
          id: founder.id,
          name: draft.name.trim(),
          shortName: draft.shortName.trim(),
          emails,
          loginEmail,
          iban,
          bic: draft.bic.trim(),
          liabilityAccount: draft.liabilityAccount.trim(),
        });
        toast.show(t('expenses.founders.updated'));
      } else {
        await create.mutateAsync({
          name: draft.name.trim(),
          shortName: draft.shortName.trim(),
          emails,
          loginEmail,
          iban,
          bic: draft.bic.trim() || undefined,
          liabilityAccount: draft.liabilityAccount.trim(),
          legacyCreditorNumber: legacyNumber,
        });
        toast.show(t('expenses.founders.created'));
      }
      await utils.founders.list.invalidate();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={founder ? t('expenses.founders.editTitle') : t('expenses.founders.add')} onClose={onClose}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <label className="lab">
          {t('expenses.founders.name')}
          <input className="field" value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.shortName')}
          <input className="field" value={draft.shortName} onChange={(e) => set('shortName', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.emails')}
          <input className="field" value={draft.emails} onChange={(e) => set('emails', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.loginEmail')}
          <input className="field" type="email" value={draft.loginEmail} onChange={(e) => set('loginEmail', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.iban')}
          <input className="field num" value={draft.iban} onChange={(e) => set('iban', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.bic')}
          <input className="field" value={draft.bic} onChange={(e) => set('bic', e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.founders.liabilityAccount')}
          <input className="field num" value={draft.liabilityAccount} onChange={(e) => set('liabilityAccount', e.target.value)} />
        </label>
        {founder ? null : (
          <label className="lab">
            {t('expenses.founders.legacyNumber')}
            <input
              className="field num"
              value={draft.legacyCreditorNumber}
              onChange={(e) => set('legacyCreditorNumber', e.target.value)}
            />
          </label>
        )}
        {valid ? null : <p className="muted" style={{ margin: 0, color: 'var(--danger)' }}>{t('expenses.founders.invalid')}</p>}
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('expenses.founders.cancel')}</button>
        <button type="button" className="btn" disabled={!valid || saving} onClick={save}>
          {saving ? t('expenses.founders.saving') : t('expenses.founders.save')}
        </button>
      </div>
    </Modal>
  );
}

function AddEmailDialog({ founder, onClose }: { founder: FounderRow; onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const addEmail = trpc.founders.addEmail.useMutation();
  const [email, setEmail] = useState('');
  const valid = EMAIL_RE.test(email.trim());

  async function save() {
    if (!valid) return;
    try {
      await addEmail.mutateAsync({ id: founder.id, email: email.trim().toLowerCase() });
      await utils.founders.list.invalidate();
      toast.show(t('expenses.founders.emailSaved'));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal title={t('expenses.founders.emailTitle')} sub={founder.name} onClose={onClose}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <label className="lab">
          {t('expenses.founders.emails')}
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {valid ? null : <p className="muted" style={{ margin: 0, color: 'var(--danger)' }}>{t('expenses.founders.emailInvalid')}</p>}
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('expenses.founders.cancel')}</button>
        <button type="button" className="btn" disabled={!valid || addEmail.isPending} onClick={save}>
          {t('expenses.founders.save')}
        </button>
      </div>
    </Modal>
  );
}

interface ImportResult {
  rows: number;
  created: number;
  updated: number;
  unchanged: number;
  items: { name: string; loginEmail: string; action: 'create' | 'update' | 'unchanged' }[];
  errors: string[];
}

/** Bulk registry import with a mandatory check before the real write. */
function ImportDialog({ onDone }: { onDone: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const importJson = trpc.founders.importJson.useMutation();
  const [json, setJson] = useState('');
  const [check, setCheck] = useState<ImportResult | null>(null);

  function edit(text: string) {
    setJson(text);
    setCheck(null);
  }

  async function run(dryRun: boolean) {
    try {
      const res = (await importJson.mutateAsync({ json, dryRun })) as ImportResult;
      if (dryRun || res.errors.length > 0) {
        setCheck(res);
        return;
      }
      await utils.founders.list.invalidate();
      toast.show(t('expenses.founders.importDialog.done'));
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const summary = check
    ? t('expenses.founders.importDialog.summary')
        .replace('{created}', String(check.created))
        .replace('{updated}', String(check.updated))
        .replace('{unchanged}', String(check.unchanged))
    : '';

  return (
    <Modal title={t('expenses.founders.importDialog.title')} sub={t('expenses.founders.importDialog.hint')} onClose={onDone}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="lab">
          {t('expenses.founders.importDialog.json')}
          <textarea
            className="field num"
            rows={10}
            value={json}
            placeholder='[{ "name": "…", "shortName": "…", "emails": ["…"], "loginEmail": "…@bumbleflies.de", "iban": "DE…" }]'
            onChange={(e) => edit(e.target.value)}
          />
        </label>
        <label className="lab">
          {t('expenses.founders.importDialog.file')}
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
                  <li key={`${item.loginEmail}-${item.name}`}>
                    <span>{item.name}</span>{' '}
                    <span className={`badge ${item.action === 'create' ? 'b-paid' : item.action === 'update' ? 'b-sent' : 'b-draft'}`}>
                      {t(`expenses.founders.importDialog.action.${item.action}`)}
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
          {t('expenses.founders.importDialog.check')}
        </button>
        <button
          type="button"
          className="btn"
          disabled={!check || check.errors.length > 0 || importJson.isPending}
          onClick={() => run(false)}
        >
          {t('expenses.founders.importDialog.apply')}
        </button>
      </div>
    </Modal>
  );
}

/** Admin registry for the addresses and payout target behind the expense flow. */
export function FoundersSection() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const founders = trpc.founders.list.useQuery();
  const setActive = trpc.founders.setActive.useMutation();
  const [dialog, setDialog] = useState<{ founder: FounderRow | null } | null>(null);
  const [emailFor, setEmailFor] = useState<FounderRow | null>(null);
  const [importing, setImporting] = useState(false);

  async function toggle(founder: FounderRow) {
    try {
      await setActive.mutateAsync({ id: founder.id, active: !founder.active });
      await utils.founders.list.invalidate();
      toast.show(t('expenses.founders.stateSaved'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card-head">
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('expenses.founders.title')}</h2>
          <p className="muted" style={{ margin: '4px 0 0' }}>{t('expenses.founders.hint')}</p>
        </div>
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => setImporting(true)}>
            {t('expenses.founders.import')}
          </button>
          <button type="button" className="btn" onClick={() => setDialog({ founder: null })}>
            {t('expenses.founders.add')}
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="resp">
          <thead>
            <tr>
              <th>{t('expenses.founders.name')}</th>
              <th>{t('expenses.founders.shortName')}</th>
              <th>{t('expenses.founders.loginEmail')}</th>
              <th>{t('expenses.founders.iban')}</th>
              <th>{t('expenses.founders.liabilityAccount')}</th>
              <th>{t('expenses.founders.active')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(founders.data ?? []).map((founder) => (
              <tr key={founder.id} style={founder.active ? undefined : { opacity: 0.55 }}>
                <td data-l={t('expenses.founders.name')}>{founder.name}</td>
                <td data-l={t('expenses.founders.shortName')}>{founder.shortName}</td>
                <td data-l={t('expenses.founders.loginEmail')}>{founder.loginEmail}</td>
                <td data-l={t('expenses.founders.iban')} className="num">{displayIban(founder.iban)}</td>
                <td data-l={t('expenses.founders.liabilityAccount')} className="num">{founder.liabilityAccount}</td>
                <td>
                  <span className={`badge ${founder.active ? 'b-paid' : 'b-cancel'}`}>
                    {founder.active ? t('expenses.founders.active') : t('expenses.founders.inactive')}
                  </span>
                </td>
                <td>
                  <div className="row">
                    <button type="button" className="btn ghost sm" onClick={() => setDialog({ founder })}>
                      {t('expenses.founders.edit')}
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => setEmailFor(founder)}>
                      {t('expenses.founders.addEmail')}
                    </button>
                    <button type="button" className="btn ghost sm" onClick={() => toggle(founder)}>
                      {founder.active ? t('expenses.founders.archive') : t('expenses.founders.restore')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {founders.isError ? (
        <p style={{ color: 'var(--danger)', margin: 0 }}>{(founders.error as unknown as Error).message}</p>
      ) : null}

      {dialog ? <FounderDialog founder={dialog.founder} onClose={() => setDialog(null)} /> : null}
      {emailFor ? <AddEmailDialog founder={emailFor} onClose={() => setEmailFor(null)} /> : null}
      {importing ? <ImportDialog onDone={() => setImporting(false)} /> : null}
    </section>
  );
}
