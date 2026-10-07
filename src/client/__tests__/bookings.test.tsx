import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

const bookCalls: unknown[] = [];
const bulkCalls: unknown[] = [];
const unbookCalls: unknown[] = [];
const shown: string[] = [];

const inboxRows = [
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
    suggestion: null,
  },
];

const bookedRows = [
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
    entryId: 'e1',
    entryNumber: '2026-00010',
    lines: [
      { account: '1406', debitCents: 1900, creditCents: 0 },
      { account: '1800', debitCents: 0, creditCents: 11900 },
      { account: '6837', debitCents: 10000, creditCents: 0 },
    ],
    supplierName: 'Acme GmbH',
    receipt: null,
    receiptMissingReason: null,
  },
];

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      bookings: { invalidate: async () => {} },
      ledger: { invalidate: async () => {} },
    }),
    ledger: { fiscalYears: { useQuery: () => ({ data: [] }) } },
    accounts: { list: { useQuery: () => ({ data: [{ number: '6837', name: 'Lizenzen' }] }) } },
    suppliers: { list: { useQuery: () => ({ data: [{ _id: 's1', kreditorNumber: 70001, name: 'Acme GmbH' }] }) } },
    receipts: { list: { useQuery: () => ({ data: [] }) } },
    bookings: {
      inbox: { useQuery: () => ({ data: inboxRows }) },
      booked: { useQuery: () => ({ data: bookedRows }) },
      stats: { useQuery: () => ({ data: { open: 2, booked: 1, missingReceipts: 1 } }) },
      balanceCheck: { useQuery: () => ({ data: { ledgerCents: 0, bankCents: 0, diffCents: 0 } }) },
      book: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            bookCalls.push(input);
            return { entryNumber: '2026-00011', entryId: 'e2' };
          },
          isPending: false,
        }),
      },
      bookBulk: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            bulkCalls.push(input);
            return [{ bankTxId: 'tx1', ok: true, entryNumber: '2026-00011' }];
          },
          isPending: false,
        }),
      },
      unbook: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            unbookCalls.push(input);
            return { reversalNumber: '2026-00012' };
          },
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: (m: string) => { shown.push(m); }, error: () => {} }),
}));

import { BookingsPage } from '../pages/BookingsPage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  bookCalls.length = 0;
  bulkCalls.length = 0;
  unbookCalls.length = 0;
  shown.length = 0;
});

function renderPage() {
  render(
    <LanguageProvider>
      <BookingsPage />
    </LanguageProvider>,
  );
}

describe('BookingsPage', () => {
  it('lists incoming and outgoing in one inbox with signed amounts', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Buchen' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Miete März/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /10009-20260809-01/ })).toBeInTheDocument();
    expect(screen.getByText('-119,00 €')).toBeInTheDocument();
  });

  it('direction filter hides incoming', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ausgänge' }));
    expect(screen.getByRole('row', { name: /Miete März/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /10009-20260809-01/ })).not.toBeInTheDocument();
  });

  it('booking dialog books with suggestion defaults and preview', async () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Miete März/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Buchen' }));
    expect(screen.getByRole('heading', { name: 'Transaktion buchen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt buchen' }));
    await waitFor(() => expect(bookCalls).toEqual([
      expect.objectContaining({ bankTxId: 'tx1', account: '6837', vatRate: 0.19, mode: 'normal', supplierId: 's1' }),
    ]));
    expect(shown).toEqual(['Gebucht 2026-00011']);
  });

  it('bulk books selected rows with suggestions', async () => {
    renderPage();
    const boxes = screen.getAllByRole('checkbox');
    fireEvent.click(boxes[1]);
    fireEvent.click(screen.getByRole('button', { name: /Ausgewählte mit Vorschlag buchen/ }));
    await waitFor(() => expect(bulkCalls).toEqual([{ bankTxIds: ['tx1'] }]));
    expect(shown).toEqual(['1 gebucht']);
  });

  it('booked tab shows entries and reverses with reason', async () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('falsch');
    try {
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Gebucht' }));
      expect(screen.getByText('2026-00010')).toBeInTheDocument();
      const row = screen.getByRole('row', { name: /Miete Februar/ });
      fireEvent.click(within(row).getByRole('button', { name: 'Stornieren' }));
      await waitFor(() => expect(unbookCalls).toEqual([{ bankTxId: 'tx3', reason: 'falsch' }]));
      expect(shown).toEqual(['Gebucht']);
    } finally {
      prompt.mockRestore();
    }
  });
});
