import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';

type SessionStatus = 'loading' | 'authed' | 'unauthed';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const { t } = useLanguage();

  useEffect(() => {
    let cancelled = false;
    fetch('/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!cancelled) {
          setStatus(res.ok ? 'authed' : 'unauthed');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('unauthed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <p>{t('common.loadingShort')}</p>;
  }
  if (status === 'unauthed') {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
