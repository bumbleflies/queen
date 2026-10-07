import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../i18n/LanguageContext';

const q = vi.hoisted(() => (data: unknown) => ({ useQuery: () => ({ data }) }));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ ledger: { invalidate: async () => {} } }),
    accounts: { list: q([]) },
    ledger: {
      fiscalYears: q([]),
      list: q([]),
      trialBalance: q({ rows: [], debitCents: 0, creditCents: 0 }),
      accountLedger: q([]),
      postManual: { useMutation: () => ({ mutateAsync: async () => {}, isPending: false }) },
      reverse: { useMutation: () => ({ mutateAsync: async () => {} }) },
    },
    bank: {
      syncNow: { useMutation: () => ({ mutateAsync: async () => ({ ok: true, fetched: 0 }), isPending: false }) },
    },
    admin: {
      ledgerBackfill: {
        useMutation: () => ({
          mutateAsync: async () => ({ invoices: 0, creditNotes: 0, payments: 0, skipped: [] }),
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {}, error: () => {} }) }));

import { LedgerPage } from '../pages/LedgerPage';

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'language', { value: 'de-DE', configurable: true });
  Object.defineProperty(navigator, 'languages', { value: ['de-DE', 'de'], configurable: true });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'language');
  Reflect.deleteProperty(navigator, 'languages');
});

function ToEn() {
  const { setLang } = useLanguage();
  return <button type="button" onClick={() => setLang('en')}>to-en</button>;
}

describe('LedgerPage i18n', () => {
  it('renders German, then English after switching language', () => {
    render(
      <LanguageProvider>
        <ToEn />
        <LedgerPage />
      </LanguageProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Buchhaltung' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saldenliste' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'to-en' }));
    expect(screen.getByRole('heading', { name: 'Accounting' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Trial balance' }));
    expect(screen.getByText('Total')).toBeInTheDocument();
  });
});
