import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Brand } from './Brand';
import { trpc } from '../lib/trpc';

type IconName = 'home' | 'invoices' | 'clients' | 'bank' | 'reports' | 'ledger' | 'settings' | 'logout';

const ICON_PATHS: Record<IconName, ReactNode> = {
  home: <path d="M3 12h7V3H3zM14 21h7v-9h-7zM14 3h7v5h-7zM3 21h7v-5H3z" />,
  invoices: <path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h8M9 17h8" />,
  clients: (
    <>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5" />
    </>
  ),
  bank: <path d="M3 10h18L12 4zM5 10v8M10 10v8M14 10v8M19 10v8M3 20h18" />,
  ledger: <path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16" />,
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
};

export function NavIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: IconName;
  badge?: 'bank';
}

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', short: 'Start', icon: 'home' },
  { to: '/invoices', label: 'Rechnungen', short: 'Rechnungen', icon: 'invoices' },
  { to: '/clients', label: 'Kunden', short: 'Kunden', icon: 'clients' },
  { to: '/bank', label: 'Bankabgleich', short: 'Bank', icon: 'bank', badge: 'bank' },
  { to: '/ledger', label: 'Buchhaltung', short: 'Buchh.', icon: 'ledger' },
  { to: '/reports', label: 'Berichte', short: 'Berichte', icon: 'reports' },
];

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');

/**
 * Desktop: dark top bar with inline links. Mobile (≤ 760 px): the same bar
 * shrinks to brand + settings/logout and the sections move to a bottom tab
 * bar in thumb reach.
 */
export function Navigation({ onLogout }: { onLogout?: () => void }) {
  const unmatched = trpc.bank.list.useQuery({ unmatchedOnly: true });
  const bankCount = unmatched.data?.length ?? 0;

  const badge = (item: NavItem) =>
    item.badge === 'bank' && bankCount > 0 ? (
      <span className="nav-badge num" aria-label={`${bankCount} offen`}>
        {bankCount}
      </span>
    ) : null;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/dashboard" className="topbar-brand" aria-label="queen – Dashboard">
            <Brand size={24} className="brand" />
          </Link>
          <nav className="topnav" aria-label="Hauptnavigation">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={navClass}>
                {item.label}
                {badge(item)}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-tools">
            <NavLink
              to="/settings"
              className={({ isActive }) => `topbar-icon${isActive ? ' on' : ''}`}
              aria-label="Einstellungen"
              title="Einstellungen"
            >
              <NavIcon name="settings" size={18} />
            </NavLink>
            {onLogout ? (
              <button
                type="button"
                className="topbar-icon"
                onClick={onLogout}
                aria-label="Abmelden"
                title="Abmelden"
              >
                <NavIcon name="logout" size={18} />
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <nav className="tabbar" aria-label="Hauptnavigation mobil">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={navClass}>
            <span className="tabbar-ico">
              <NavIcon name={item.icon} size={22} />
              {badge(item)}
            </span>
            {item.short}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
