import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { LanguageToggle } from '../components/LanguageToggle';
import { useLanguage } from '../i18n/LanguageContext';
import { useTheme } from '../theme/ThemeContext';

export function SettingsPage() {
  const me = trpc.me.useQuery();
  const user = me.data?.user;
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

      <section
        className="card"
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
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
    </>
  );
}
