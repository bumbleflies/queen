import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
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

const originalNavLang = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');

function setBrowserLang(lang: string, languages: string[] = [lang]) {
  Object.defineProperty(navigator, 'language', { value: lang, configurable: true });
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  setBrowserLang('de-DE', ['de-DE', 'de']);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'language');
  Reflect.deleteProperty(navigator, 'languages');
  if (originalNavLang) {
    Object.defineProperty(Navigator.prototype, 'language', originalNavLang);
  }
});

describe('i18n rollout', () => {
  it('Navigation shows Rechnungen in DE and Invoices after toggling to EN', () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <Navigation />
        </MemoryRouter>
      </LanguageProvider>,
    );
    const header = screen.getByRole('banner');
    expect(within(header).getByText('Rechnungen')).toBeInTheDocument();
    const toggle = within(header).getByRole('button', { name: 'Wechseln zu Englisch' });
    expect(within(toggle).getByText('EN')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(header).getByText('Invoices')).toBeInTheDocument();
    expect(localStorage.getItem('queen-lang')).toBe('en');
    expect(within(header).getByRole('button', { name: 'Switch to German' })).toBeInTheDocument();
  });

  it('Settings language toggle persists and offers only the other language', () => {
    render(
      <LanguageProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </LanguageProvider>,
    );
    expect(screen.getByText('Sprache')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Wechseln zu Englisch' }));
    expect(localStorage.getItem('queen-lang')).toBe('en');
    expect(screen.getByText('Language')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to German' }));
    expect(localStorage.getItem('queen-lang')).toBe('de');
    expect(screen.getByText('Sprache')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Wechseln zu Englisch' })).toBeInTheDocument();
  });
});
