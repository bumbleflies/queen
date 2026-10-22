import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { LanguageToggle } from '../components/LanguageToggle';
import { FolderPicker, type PickerFolder, type PickerScope } from '../components/FolderPicker';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';
import { useTheme } from '../theme/ThemeContext';

const SCOPE_KEYS: Record<PickerScope, DictKey> = {
  invoices: 'settings.driveInvoices',
  receipts: 'settings.driveReceipts',
};

function folderLabel(f: PickerFolder | null, none: string): string {
  if (!f) return none;
  return f.name ?? f.id;
}

function TaxRateSection() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const rate = trpc.settings.getTaxRate.useQuery();
  const setRate = trpc.settings.setTaxRate.useMutation();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (rate.data === undefined ? '' : String(Math.round(rate.data.rate * 1000) / 10));
  const pct = Number(shown.replace(',', '.'));
  const valid = shown.trim() !== '' && Number.isFinite(pct) && pct >= 0 && pct <= 60;

  async function save() {
    try {
      await setRate.mutateAsync({ rate: Math.round(pct * 10) / 1000 });
      await utils.settings.getTaxRate.invalidate();
      await utils.ledger.availableCash.invalidate();
      setDraft(null);
      toast.show(t('settings.taxSaved'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.taxTitle')}</h2>
      <div>
        <label className="lbl" htmlFor="tax-rate">{t('settings.taxRate')}</label>
        <div className="row" style={{ marginTop: 4 }}>
          <input
            id="tax-rate"
            className="field num"
            inputMode="decimal"
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: '6rem' }}
          />
          <button type="button" className="btn" disabled={!valid || setRate.isPending || draft === null} onClick={save}>
            {t('settings.taxSave')}
          </button>
        </div>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>{t('settings.taxHint')}</p>
      </div>
    </section>
  );
}

export function SettingsPage() {
  const me = trpc.me.useQuery();
  const user = me.data?.user;
  const folders = trpc.settings.getDriveFolders.useQuery(undefined, { enabled: user?.role === 'admin' });
  const [picker, setPicker] = useState<PickerScope | null>(null);
  const { t } = useLanguage();
  const { theme, setTheme } = useTheme();

  return (
    <>
      <header className="page-head">
        <h1>{t('settings.title')}</h1>
      </header>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.language')}</h2>
        <div className="row">
          <LanguageToggle className="btn" />
        </div>
      </section>

      {user?.role === 'admin' ? (
        <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.driveTitle')}</h2>
          <div className="grid-form">
            {(['invoices', 'receipts'] as PickerScope[]).map((scope) => {
              const f: PickerFolder | null = scope === 'invoices' ? folders.data?.invoices ?? null : folders.data?.receipts ?? null;
              return (
                <div key={scope}>
                  <div className="lbl">{t(SCOPE_KEYS[scope])}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    <span>{folderLabel(f, t('settings.drive.none'))}</span>
                    {folders.isError ? <span style={{ color: 'var(--danger)' }}>{(folders.error as unknown as Error).message}</span> : null}
                    <button type="button" className="btn" onClick={() => setPicker(scope)}>
                      {t('settings.drive.change')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {user?.role === 'admin' ? <TaxRateSection /> : null}

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.theme')}</h2>
        <div className="row" role="group" aria-label={t('settings.theme')}>
          {(
            [
              ['system', 'settings.themeSystem'],
              ['light', 'settings.themeLight'],
              ['dark', 'settings.themeDark'],
            ] as const
          ).map(([value, key]) => (
            <button
              key={value}
              type="button"
              className={`btn${theme === value ? '' : ' ghost'}`}
              aria-pressed={theme === value}
              title={t(key)}
              onClick={() => setTheme(value)}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.account')}</h2>
        <div className="grid-form">
          <div>
            <div className="lbl">{t('settings.email')}</div>
            <div style={{ marginTop: 4 }}>{user?.email ?? '—'}</div>
          </div>
          <div>
            <div className="lbl">{t('settings.role')}</div>
            <div style={{ marginTop: 4 }}>{user?.role ?? '—'}</div>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {t('settings.note')}
        </p>
      </section>

      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.links')}</h2>
        <Link to="/finance">{t('nav.finance')}</Link>
        <Link to="/reports">{t('nav.reports')}</Link>
        <a href="/api/export/invoices.csv">{t('settings.csv')}</a>
      </section>

      {picker ? (
        <FolderPicker
          scope={picker}
          current={picker === 'invoices' ? folders.data?.invoices ?? null : folders.data?.receipts ?? null}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </>
  );
}
