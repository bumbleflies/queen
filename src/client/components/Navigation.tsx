import { NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

const NAV_ITEMS: { to: string; label: string }[] = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/invoices', label: 'Rechnungen' },
  { to: '/clients', label: 'Kunden' },
  { to: '/bank', label: 'Bankabgleich' },
  { to: '/reports', label: 'Berichte' },
  { to: '/settings', label: 'Einstellungen' },
];

function Brand() {
  return (
    <div className="brand">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path
          d="M14 2 25 8.5v11L14 26 3 19.5v-11Z"
          fill="#E0A100"
          stroke="#1B1B1F"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M9 12.5 11.5 15 14 11l2.5 4L19 12.5 18 18H10Z" fill="#1B1B1F" />
      </svg>
      <span>queen</span>
    </div>
  );
}

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
