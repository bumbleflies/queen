import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * The invite token arrives in the URL fragment, which browsers never send to a
 * server: it reaches queen only in the POST body below. `replaceState` also drops
 * it from history, so it is not left behind in the address bar.
 */
export function InvitePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, '');
    if (!token) {
      setInvalid(true);
      return;
    }
    window.history.replaceState(null, '', '/invite');
    let cancelled = false;
    fetch('/auth/invite/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) navigate('/dashboard', { replace: true });
        else setInvalid(true);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="auth">
      <div className="card auth-card">
        <Brand size={40} className="auth-brand" />
        <div className="auth-intro">
          <h1>{t('auth.title')}</h1>
          <p className="muted">{invalid ? t('invite.invalid') : t('invite.working')}</p>
        </div>
        {invalid ? (
          <Link className="btn honey" to="/login">
            {t('invite.toLogin')}
          </Link>
        ) : null}
      </div>
    </main>
  );
}
