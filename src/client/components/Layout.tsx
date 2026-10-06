import { Outlet, useNavigate } from 'react-router-dom';
import { Navigation } from './Navigation';
import { trpc } from '../lib/trpc';

export function Layout() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  async function logout() {
    try {
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      await utils.invalidate();
      navigate('/login', { replace: true });
    }
  }

  const footer = (
    <button type="button" className="btn ghost" style={{ marginTop: 'auto' }} onClick={logout}>
      Abmelden
    </button>
  );

  return (
    <div className="shell">
      <Navigation footer={footer} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
