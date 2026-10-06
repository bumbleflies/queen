import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Brand } from './Brand';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/invoices', label: 'Rechnungen' },
  { to: '/clients', label: 'Kunden' },
  { to: '/bank', label: 'Bankabgleich' },
  { to: '/reports', label: 'Berichte' },
  { to: '/settings', label: 'Einstellungen' },
];

export function Navigation({ footer }: { footer?: ReactNode }) {
  return (
    <nav className="nav" aria-label="Hauptnavigation">
      <Brand />
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'on' : '')}>
          {item.label}
        </NavLink>
      ))}
      {footer}
    </nav>
  );
}
