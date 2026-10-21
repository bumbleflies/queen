import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';

const cash = vi.hoisted(() => ({
  current: {
    bankCents: 1000000,
    vatCents: 190000,
    provisionsCents: 50000,
    estimatedTaxCents: 330000,
    liabilitiesCents: 20000,
    availableCents: 410000,
    profitCents: 1000000,
    taxRate: 0.33,
    bankSource: 'firefly',
    asOf: '2026-10-22T00:00:00.000Z',
    openCount: 0,
  } as Record<string, unknown>,
}));

const setRate = vi.hoisted(() => vi.fn(async (input: { rate: number }) => input));

vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {}, error: () => {} }) }));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      settings: { getTaxRate: { invalidate: async () => {} } },
      ledger: { availableCash: { invalidate: async () => {} } },
    }),
    me: { useQuery: () => ({ data: { user: { email: 'a@example.de', role: 'admin' } } }) },
    settings: {
      getDriveFolders: { useQuery: () => ({ data: null, isError: false }) },
      getTaxRate: { useQuery: () => ({ data: { rate: 0.33 } }) },
      setTaxRate: { useMutation: () => ({ mutateAsync: setRate, isPending: false }) },
    },
    ledger: { availableCash: { useQuery: () => ({ data: cash.current, isError: false }) } },
  },
}));

import { AvailableCashCard } from '../components/AvailableCashCard';
import { SettingsPage } from '../pages/SettingsPage';

function renderCard(compact = false) {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AvailableCashCard year={2026} compact={compact} />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  cash.current = { ...cash.current, bankSource: 'firefly', openCount: 0, bankError: undefined };
});

describe('AvailableCashCard', () => {
  it('shows each line and the result', () => {
    renderCard();
    expect(screen.getByText('Kontostand')).toBeInTheDocument();
    expect(screen.getByText('− Umsatzsteuer (offen)')).toBeInTheDocument();
    expect(screen.getByText('= frei verfügbar')).toBeInTheDocument();
    expect(screen.getByText('10.000,00 €')).toBeInTheDocument();
    expect(screen.getByText('4.100,00 €')).toBeInTheDocument();
  });

  it('marks the estimate', () => {
    renderCard();
    expect(screen.getByText(/Schätzung \(33 %\)/)).toBeInTheDocument();
  });

  it('warns when transactions are open', () => {
    cash.current = { ...cash.current, openCount: 4 };
    renderCard();
    expect(screen.getByText('4 Umsätze noch nicht gebucht — Betrag vorläufig')).toBeInTheDocument();
  });

  it('says when the bank figure is from the ledger and why', () => {
    cash.current = { ...cash.current, bankSource: 'ledger', bankError: 'Firefly down' };
    renderCard();
    expect(screen.getByText(/laut Buchhaltung/)).toBeInTheDocument();
    expect(screen.getByText(/Bank: Firefly down/)).toBeInTheDocument();
  });

  it('links deductions to the account ledger', () => {
    renderCard();
    const link = screen.getByRole('link', { name: /Umsatzsteuer \(offen\)/ });
    expect(link).toHaveAttribute('href', '/finance?tab=journal&account=3806');
  });
});

describe('SettingsPage tax rate', () => {
  it('shows percent and saves a fraction', async () => {
    render(
      <MemoryRouter>
        <LanguageProvider>
          <SettingsPage />
        </LanguageProvider>
      </MemoryRouter>,
    );
    const input = screen.getByLabelText('Steuersatz für Schätzung (%)');
    expect(input).toHaveValue('33');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(setRate).toHaveBeenCalledWith({ rate: 0.3 }));
  });
});
