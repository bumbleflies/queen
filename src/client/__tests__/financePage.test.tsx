import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

import { MemoryRouter } from 'react-router-dom';

const q = vi.hoisted(() => (data: unknown) => ({ useQuery: () => ({ data, isError: false }) }));
const calls: Record<string, unknown[]> = {};
const shown: string[] = [];

const streamRows = vi.hoisted(() => [
  {
    id: 'tx1',
    fireflyJournalId: '1:0',
    date: '2026-03-04T00:00:00.000Z',
    direction: 'out',
    amountCents: 11900,
    counterpartyName: 'Acme GmbH',
    counterpartyIban: 'DE02120300000000202051',
    description: 'Miete März',
    ignored: false,
    state: 'open',
    suggestion: { supplierId: 's1', supplierName: 'Acme GmbH', account: '6837', vatRate: 0.19, mode: 'normal' },
  },
  {
    id: 'tx2',
    fireflyJournalId: '2:0',
    date: '2026-03-05T00:00:00.000Z',
    direction: 'in',
    amountCents: 21420,
    counterpartyName: 'Kunde AG',
    counterpartyIban: null,
    description: '10009-20260809-01',
    ignored: false,
    state: 'open',
    suggestion: null,
  },
  {
    id: 'tx5',
    fireflyJournalId: '5:0',
    date: '2026-03-02T00:00:00.000Z',
    direction: 'in',
    amountCents: 5000,
    counterpartyName: 'Amt',
    counterpartyIban: null,
    description: 'Steuererstattung',
    ignored: true,
    state: 'open',
    suggestion: null,
  },
  {
    id: 'tx3',
    fireflyJournalId: '3:0',
    date: '2026-02-01T00:00:00.000Z',
    direction: 'out',
    amountCents: 11900,
    counterpartyName: 'Acme GmbH',
    counterpartyIban: null,
    description: 'Miete Februar',
    ignored: false,
    state: 'booked',
    suggestion: null,
    supplierName: 'Acme GmbH',
    receipt: null,
    receiptMissingReason: null,
    entry: {
      entryId: 'e1',
      entryNumber: '2026-00010',
      lines: [
        { account: '1406', debitCents: 1900, creditCents: 0 },
        { account: '1800', debitCents: 0, creditCents: 11900 },
        { account: '6837', debitCents: 10000, creditCents: 0 },
      ],
    },
  },
  {
    id: 'tx4',
    fireflyJournalId: '4:0',
    date: '2026-02-15T00:00:00.000Z',
    direction: 'in',
    amountCents: 21420,
    counterpartyName: 'Kunde AG',
    counterpartyIban: null,
    description: 'Verwendungszweck 10009-20260910-01',
    ignored: false,
    state: 'invoice',
    matchedInvoiceId: 'inv1',
    matchMethod: 'reference',
    suggestion: null,
    invoice: { invoiceNumber: '20260910-01', status: 'paid' },
  },
]);

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      bookings: { invalidate: async () => {} },
      ledger: { invalidate: async () => {} },
      invalidate: async () => {},
    }),
    ledger: {
      fiscalYears: q([{ year: 2026 }]),
      list: q([]),
      trialBalance: q({ rows: [], debitCents: 0, creditCents: 0 }),
      accountLedger: q([]),
      postManual: { useMutation: () => ({ mutateAsync: async () => {}, isPending: false }) },
      reverse: { useMutation: () => ({ mutateAsync: async () => {} }) },
    },
    accounts: { list: q([{ number: '6837', name: 'Lizenzen' }]) },
    suppliers: { list: q([{ _id: 's1', kreditorNumber: 70001, name: 'Acme GmbH' }]) },
    receipts: { list: q([]) },
    reports: { openItems: q({ items: [] }) },
    reconcile: {
      status: q({ finishedAt: '2026-03-04T06:10:00.000Z', fetched: 3, matched: 1, partial: 0, unmatched: 1, error: null }),
      runNow: mut('runNow', async () => ({})),
    },
    bank: {
      assign: mut('assign', async () => ({})),
      unassign: mut('unassign', async () => ({})),
      ignore: mut('ignore', async () => ({})),
      unignore: mut('unignore', async () => ({})),
      syncNow: { useMutation: () => ({ mutateAsync: async () => ({ ok: true, fetched: 0 }), isPending: false }) },
    },
    bookings: {
      stream: q(streamRows),
      stats: q({ open: 2, booked: 1, missingReceipts: 1 }),
      balanceCheck: q({ ledgerCents: 0, bankCents: 0, diffCents: null }),
      book: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            calls.book?.push(input);
            return { entryNumber: '2026-00011', entryId: 'e2' };
          },
          isPending: false,
        }),
      },
      bookBulk: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            calls.bulk?.push(input);
            return [{ bankTxId: 'tx1', ok: true, entryNumber: '2026-00011' }];
          },
          isPending: false,
        }),
      },
      unbook: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            calls.unbook?.push(input);
            return { reversalNumber: '2026-00012' };
          },
          isPending: false,
        }),
      },
    },
    admin: {
      ledgerBackfill: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            calls.backfill?.push(input);
            return { invoices: 0, creditNotes: 0, payments: 0, skipped: [] };
          },
          isPending: false,
        }),
      },
    },
  },
}));

function mut(name: string, impl: (i: unknown) => Promise<unknown>) {
  return {
    useMutation: () => ({
      mutateAsync: async (input: unknown) => {
        calls[name]?.push(input);
        return impl(input);
      },
      isPending: false,
    }),
  };
}

vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: (m: string) => { shown.push(m); }, error: () => {} }),
}));

import { FinancePage } from '../pages/FinancePage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  Object.keys(calls).forEach((k) => delete calls[k]);
  calls.book = [];
  calls.bulk = [];
  calls.unbook = [];
  calls.assign = [];
  calls.unassign = [];
  calls.ignore = [];
  calls.unignore = [];
  shown.length = 0;
});

function renderPage() {
  render(
    <MemoryRouter>
      <LanguageProvider>
        <FinancePage />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('FinancePage — stream', () => {
  it('shows the finance heading and the open stream with signed amounts', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Finanzen' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Miete März/ })).toBeInTheDocument();
    expect(screen.getByText('-119,00 €')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Miete Februar/ })).not.toBeInTheDocument();
  });

  it('direction filter hides incoming', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ausgänge' }));
    expect(screen.getByRole('row', { name: /Miete März/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /10009-20260809-01/ })).not.toBeInTheDocument();
  });

  it('open rows with parsed references show invoice suggestions and assign', async () => {
    renderPage();
    const row = screen.getByRole('row', { name: /10009-20260809-01/ });
    expect(within(row).getByText(/Kein Verwendungszweck im Format/)).toBeInTheDocument();
  });

  it('books via dialog with suggestion defaults', async () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Miete März/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Buchen' }));
    expect(screen.getByRole('heading', { name: 'Transaktion buchen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt buchen' }));
    await waitFor(() => expect(calls.book).toEqual([
      expect.objectContaining({ bankTxId: 'tx1', account: '6837', vatRate: 0.19, mode: 'normal', supplierId: 's1' }),
    ]));
    expect(shown).toEqual(['Gebucht 2026-00011']);
  });

  it('bulk books selected rows with suggestions', async () => {
    renderPage();
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /Ausgewählte mit Vorschlag buchen/ }));
    await waitFor(() => expect(calls.bulk).toEqual([{ bankTxIds: ['tx1'] }]));
    expect(shown).toEqual(['1 gebucht']);
  });
});

describe('FinancePage — done', () => {
  it('Erledigt lists invoice payments and bank bookings with reversals', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('falsch');
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Erledigt' }));
      const invRow = screen.getByRole('row', { name: /Verwendungszweck 10009-20260910-01/ });
      expect(within(invRow).getByRole('link', { name: '20260910-01' })).toBeInTheDocument();
      expect(within(invRow).getByText('bezahlt')).toBeInTheDocument();
      fireEvent.click(within(invRow).getByRole('button', { name: 'Aufheben' }));
      await waitFor(() => expect(calls.unassign).toEqual([{ bankTxId: 'tx4' }]));

      const bookedRow = screen.getByRole('row', { name: /Miete Februar/ });
      expect(within(bookedRow).getByText('2026-00010')).toBeInTheDocument();
      expect(within(bookedRow).getByText('S 6837 100,00 €')).toBeInTheDocument();
      fireEvent.click(within(bookedRow).getByRole('button', { name: 'Stornieren' }));
      await waitFor(() => expect(calls.unbook).toEqual([{ bankTxId: 'tx3', reason: 'falsch' }]));
    } finally {
      prompt.mockRestore();
    }
  });
});

describe('FinancePage — ignored', () => {
  it('Ignoriert lists only ignored open rows with restore', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ignoriert' }));
    expect(screen.getByRole('row', { name: /Steuererstattung/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Miete März/ })).not.toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Steuererstattung/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(calls.unignore).toEqual([{ bankTxId: 'tx5' }]));
  });
});

describe('FinancePage — journal', () => {
  it('journal toggle reveals backfill and ledger views', async () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Prüfen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Journal (SKR04)' }));
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Journal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saldenliste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Konto' })).toBeInTheDocument();
  });

  it('ledger entry form can be opened', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Journal (SKR04)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Buchung erfassen' }));
    expect(screen.getByRole('heading', { name: 'Buchung erfassen' })).toBeInTheDocument();
  });
});
