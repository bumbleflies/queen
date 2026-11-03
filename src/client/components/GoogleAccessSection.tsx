import { useLanguage } from '../i18n/LanguageContext';

/**
 * The only way to widen or refresh the stored Google grant is the OAuth flow
 * itself: `/auth/google` runs with `prompt: 'consent'` and `access_type:
 * 'offline'`, so it shows the consent screen again and writes the new refresh
 * token to the user document. Every server message that says "reconnect in the
 * settings" means this link — before it existed, there was nothing to click.
 */
export function GoogleAccessSection() {
  const { t } = useLanguage();
  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.googleTitle')}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('settings.googleHint')}</p>
      <div className="row">
        <a className="btn" href="/auth/google">
          {t('settings.googleReconnect')}
        </a>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t('settings.googleCronHint')}</p>
    </section>
  );
}
