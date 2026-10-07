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

  return (
    <div className="shell">
      <Navigation onLogout={logout} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
