import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

const calls: unknown[] = [];
const invalidateCalls: unknown[] = [];
const shown: string[] = [];

const dryReport = {
  invoices: 9,
  creditNotes: 0,
  payments: 0,
  skipped: [{ ref: '20260529-01', reason: 'imported as paid without payment date' }],
};

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ ledger: { invalidate: async () => { invalidateCalls.push(1); } } }),
    accounts: { list: { useQuery: () => ({ data: [] }) } },
    ledger: {
      fiscalYears: { useQuery: () => ({ data: [] }) },
      list: { useQuery: () => ({ data: [] }) },
      trialBalance: { useQuery: () => ({ data: { rows: [], debitCents: 0, creditCents: 0 } }) },
      accountLedger: { useQuery: () => ({ data: [] }) },
      postManual: { useMutation: () => ({ mutateAsync: async () => {}, isPending: false }) },
      reverse: { useMutation: () => ({ mutateAsync: async () => {} }) },
    },
    admin: {
      ledgerBackfill: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            calls.push(input);
            return dryReport;
          },
          isPending: false,
        }),
      },
    },
    bank: {
      syncNow: { useMutation: () => ({ mutateAsync: async () => ({ ok: true, fetched: 0 }), isPending: false }) },
    },
  },
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: (m: string) => { shown.push(m); }, error: () => {} }),
}));

import { LedgerPage } from '../pages/LedgerPage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  calls.length = 0;
  invalidateCalls.length = 0;
  shown.length = 0;
});

describe('LedgerPage backfill', () => {
  it('check runs a dry run and shows counts plus skipped', async () => {
    render(
      <LanguageProvider>
        <LedgerPage />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prüfen' }));
    expect(await screen.findByText(/imported as paid without payment date/)).toBeInTheDocument();
    expect(calls).toEqual([{ year: new Date().getFullYear(), dryRun: true }]);
    expect(screen.getByText(/9 Rechnungen/)).toBeInTheDocument();
  });

  it('apply confirms and posts with dryRun:false, then invalidates', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(
        <LanguageProvider>
          <LedgerPage />
        </LanguageProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Fehlende einbuchen' }));
      expect(await screen.findByText(/imported as paid without payment date/)).toBeInTheDocument();
      expect(calls).toEqual([{ year: new Date().getFullYear(), dryRun: false }]);
      expect(invalidateCalls).toHaveLength(1);
      expect(shown).toEqual(['Fehlende Buchungen eingebucht.']);
    } finally {
      confirm.mockRestore();
    }
  });

  it('apply does nothing when the confirm is dismissed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(
        <LanguageProvider>
          <LedgerPage />
        </LanguageProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Fehlende einbuchen' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(calls).toEqual([]);
    } finally {
      confirm.mockRestore();
    }
  });
});
