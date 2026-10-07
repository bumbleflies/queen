import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';

vi.mock('../lib/trpc', () => ({
  trpc: {
    bank: { list: { useQuery: () => ({ data: [] }) } },
    me: { useQuery: () => ({ data: { user: { email: 'a@example.com', role: 'admin' } } }) },
  },
}));

import { Navigation } from '../components/Navigation';
import { SettingsPage } from '../pages/SettingsPage';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('i18n rollout', () => {
  it('Navigation shows Rechnungen in DE and Invoices after switching to EN', () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <Navigation />
        </MemoryRouter>
      </LanguageProvider>,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByText('Rechnungen')).toBeInTheDocument();
    fireEvent.click(within(header).getByRole('button', { name: 'EN' }));
    expect(within(header).getByText('Invoices')).toBeInTheDocument();
    expect(localStorage.getItem('queen-lang')).toBe('en');
  });

  it('Settings language switch persists', () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(screen.getByText('Sprache')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(localStorage.getItem('queen-lang')).toBe('en');
    expect(screen.getByText('Language')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'DE' }));
    expect(localStorage.getItem('queen-lang')).toBe('de');
    expect(screen.getByText('Sprache')).toBeInTheDocument();
  });
});
