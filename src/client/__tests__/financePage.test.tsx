import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

import { MemoryRouter } from 'react-router-dom';

const q = vi.hoisted(() => (data: unknown) => ({ useQuery: () => ({ data, isError: false }) }));
const receiptRows = vi.hoisted(() => ({ current: [] as { id: string; name: string; link: string; score: number }[] }));
const state = vi.hoisted(() => ({ role: 'admin', rows: null as unknown[] | null, matches: {} as Record<string, unknown> }));
const calls: Record<string, unknown[]> = {};
const shown: string[] = [];
const actions: { label: string; onClick: () => void }[] = [];

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
      suppliers: { invalidate: async () => {} },
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
    me: { useQuery: () => ({ data: { user: { sub: 'u', email: 'u@example.de', role: state.role } } }) },
    suppliers: {
      list: q([{ _id: 's1', kreditorNumber: 70001, name: 'Acme GmbH' }]),
      overview: q([]),
      create: mut('createRule', async () => ({})),
      update: mut('updateRule', async () => ({})),
      setArchived: mut('setArchived', async () => ({})),
      importJson: mut('importJson', async () => ({})),
    },
    receipts: { list: { useQuery: () => ({ data: receiptRows.current, isError: false }) } },
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
      syncNow: mut('syncNow', async () => ({ ok: true, fetched: 0 })),
    },
    bookings: {
      stream: { useQuery: () => ({ data: state.rows ?? streamRows, isError: false }) },
      receiptMatches: { useQuery: () => ({ data: { available: true, matches: state.matches } }) },
      setReceipt: mut('setReceipt', async () => ({})),
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
            return [{ bankTxId: 'tx1', ok: true, entryNumber: '2026-00011', receipt: true }];
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
  useToast: () => ({
    show: (m: string, a?: { label: string; onClick: () => void }) => {
      shown.push(m);
      if (a) actions.push(a);
    },
    error: (m: string) => { shown.push(`error: ${m}`); },
  }),
}));

import { FinancePage } from '../pages/FinancePage';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  Object.keys(calls).forEach((k) => delete calls[k]);
  calls.book = [];
  calls.createRule = [];
  calls.bulk = [];
  calls.unbook = [];
  calls.assign = [];
  calls.unassign = [];
  calls.ignore = [];
  calls.unignore = [];
  calls.syncNow = [];
  calls.setReceipt = [];
  shown.length = 0;
  actions.length = 0;
  receiptRows.current = [];
  state.role = 'admin';
  state.rows = null;
  state.matches = {};
});

function renderPage(url = '/finance') {
  render(
    <MemoryRouter initialEntries={[url]}>
      <LanguageProvider>
        <FinancePage />
      </LanguageProvider>
    </MemoryRouter>,
  );
}

describe('FinancePage — inbox', () => {
  it('summarises the year and lists open rows with their outcome', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Finanzen' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'offen' });
    expect(within(summary).getByText('2')).toBeInTheDocument();
    expect(within(summary).getByText('1 mit Vorschlag · 1 ohne Regel · 0 Rechnung zuordnen')).toBeInTheDocument();
    expect(within(summary).getByText('1 gebucht ohne Beleg')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Offen/ })).toHaveAttribute('aria-selected', 'true');

    const row = screen.getByRole('row', { name: /Miete März/ });
    expect(within(row).getByText('-119,00 €')).toBeInTheDocument();
    expect(within(row).getByText('✓ 6837 Lizenzen · 19 %')).toBeInTheDocument();
    expect(within(row).getByText('Regel Acme GmbH')).toBeInTheDocument();
    expect(within(row).getByText('kein Beleg gefunden')).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Miete Februar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Steuererstattung/ })).not.toBeInTheDocument();
  });

  it('direction switch filters rows and the tab comes from the URL', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Ausgänge' }));
    expect(screen.getByRole('row', { name: /Miete März/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /10009-20260809-01/ })).not.toBeInTheDocument();
  });

  it('opens the tab named in the URL', () => {
    renderPage('/finance?tab=ignored');
    expect(screen.getByRole('tab', { name: /Ignoriert/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('row', { name: /Steuererstattung/ })).toBeInTheDocument();
  });

  it('incoming rows explain the missing invoice reference', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /10009-20260809-01/ });
    expect(within(row).getByText(/Kein Verwendungszweck im Format/)).toBeInTheDocument();
    expect(within(row).getByText('⚠ Keine Regel')).toBeInTheDocument();
  });

  it('books a complete suggestion in one click with the matched receipt, and can undo it', async () => {
    state.matches = { tx1: { id: 'f1', name: 'Acme_2026-03-01_123456.pdf', link: 'https://drive/f1' } };
    renderPage();
    const row = screen.getByRole('row', { name: /Miete März/ });
    expect(within(row).getByRole('link', { name: 'Acme_2026-03-01_123456.pdf' })).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Buchen' }));
    await waitFor(() => expect(calls.book).toEqual([{
      bankTxId: 'tx1',
      account: '6837',
      vatRate: 0.19,
      mode: 'normal',
      supplierId: 's1',
      receipt: { driveFileId: 'f1', fileName: 'Acme_2026-03-01_123456.pdf', link: 'https://drive/f1' },
    }]));
    expect(shown).toEqual(['Gebucht 2026-00011.']);
    expect(actions.map((a) => a.label)).toEqual(['Rückgängig']);
    actions[0].onClick();
    await waitFor(() => expect(calls.unbook).toEqual([{ bankTxId: 'tx1', reason: 'Rückgängig direkt nach dem Buchen' }]));
  });

  it('books a §13b suggestion in one click and labels the outcome', async () => {
    state.rows = [{
      ...(streamRows[0] as Record<string, unknown>),
      suggestion: { supplierId: 's1', supplierName: 'Acme GmbH', account: '6837', vatRate: 0.19, mode: 'reverseCharge' },
    }];
    renderPage();
    const row = screen.getByRole('row', { name: /Miete März/ });
    expect(within(row).getByText(/✓ 6837 Lizenzen · §13b/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Buchen' }));
    await waitFor(() => expect(calls.book).toEqual([{
      bankTxId: 'tx1',
      account: '6837',
      vatRate: 0.19,
      mode: 'reverseCharge',
      supplierId: 's1',
    }]));
  });

  it('Anpassen opens the booking dialog with the suggestion and a preselected receipt', async () => {
    receiptRows.current = [
      { id: 'f1', name: 'Acme_2026-03-01_123456.pdf', link: 'https://drive/f1', score: 8 },
      { id: 'f2', name: 'Acme_2026-02-01_654321.pdf', link: 'https://drive/f2', score: 1 },
    ];
    renderPage();
    fireEvent.click(within(screen.getByRole('row', { name: /Miete März/ })).getByRole('button', { name: 'Anpassen' }));
    expect(screen.getByRole('heading', { name: 'Transaktion buchen' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Als Regel merken' })).not.toBeChecked();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Beleg wählen' })).toHaveValue('f1'));
    fireEvent.click(screen.getByRole('button', { name: 'Jetzt buchen' }));
    await waitFor(() => expect(calls.book).toEqual([
      expect.objectContaining({
        bankTxId: 'tx1', account: '6837', vatRate: 0.19, mode: 'normal', supplierId: 's1', rememberRule: false,
        receipt: { driveFileId: 'f1', fileName: 'Acme_2026-03-01_123456.pdf', link: 'https://drive/f1' },
      }),
    ]));
  });

  it('rows without a rule offer a prefilled rule with a live match count', async () => {
    renderPage();
    const row = screen.getByRole('row', { name: /10009-20260809-01/ });
    expect(within(screen.getByRole('row', { name: /Miete März/ })).queryByRole('button', { name: 'Regel anlegen' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Regel anlegen' }));
    const dialog = screen.getByRole('dialog', { name: 'Regel anlegen' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Kunde AG');
    expect(within(dialog).getByLabelText(/Name enthält/)).toHaveValue('Kunde AG');
    expect(within(dialog).getByText('Treffer in offenen Umsätzen: 1')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Name enthält/), { target: { value: 'niemand' } });
    expect(within(dialog).getByText('Passt auf keinen offenen Umsatz.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Name enthält/), { target: { value: 'Kunde AG' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.createRule).toEqual([expect.objectContaining({ name: 'Kunde AG', namePatterns: ['Kunde AG'] })]));
    expect(shown).toEqual(['Regel gespeichert. Offene Umsätze mit Vorschlag: 1']);
  });

  it('non-admins can still book manually but not create rules', () => {
    state.role = 'user';
    renderPage();
    const row = screen.getByRole('row', { name: /10009-20260809-01/ });
    expect(within(row).queryByRole('button', { name: 'Regel anlegen' })).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Manuell buchen' }));
    expect(screen.getByRole('heading', { name: 'Transaktion buchen' })).toBeInTheDocument();
  });

  it('bulk books all suggestions, or only the selected ones, with undo', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '1 Vorschlag buchen' }));
    await waitFor(() => expect(calls.bulk).toEqual([{ bankTxIds: ['tx1'] }]));
    expect(shown).toEqual(['1 gebucht, 1 mit Beleg.']);
    expect(actions).toHaveLength(1);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Miete März' }));
    fireEvent.click(screen.getByRole('button', { name: '1 ausgewählte buchen' }));
    await waitFor(() => expect(calls.bulk).toHaveLength(2));
  });

  it('shows a done state when nothing is open', () => {
    state.rows = streamRows.filter((r) => r.state !== 'open');
    renderPage();
    expect(screen.getByText('Alles gebucht ✓')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Erledigt ansehen' }));
    expect(screen.getByRole('tab', { name: /Erledigt/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('bank maintenance lives in the overflow menu; full reimport asks first', async () => {
    renderPage();
    expect(screen.queryByRole('menuitem', { name: 'Jetzt synchronisieren' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Bank und Abgleich' }));
    expect(screen.getByRole('menuitem', { name: 'Jetzt synchronisieren' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Bank vollständig neu einlesen/ }));
    const dialog = screen.getByRole('dialog', { name: 'Bank neu einlesen' });
    expect(calls.syncNow).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Bank vollständig neu einlesen' }));
    await waitFor(() => expect(calls.syncNow).toEqual([{ full: true }]));
  });
});

describe('FinancePage — done', () => {
  it('Erledigt lists invoice payments and bank bookings; Stornieren asks for a reason', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Erledigt/ }));
    const invRow = screen.getByRole('row', { name: /Verwendungszweck 10009-20260910-01/ });
    expect(within(invRow).getByRole('link', { name: '20260910-01' })).toBeInTheDocument();
    expect(within(invRow).getByText('bezahlt')).toBeInTheDocument();
    fireEvent.click(within(invRow).getByRole('button', { name: 'Aufheben' }));
    await waitFor(() => expect(calls.unassign).toEqual([{ bankTxId: 'tx4' }]));

    const bookedRow = screen.getByRole('row', { name: /Miete Februar/ });
    expect(within(bookedRow).getByText('2026-00010')).toBeInTheDocument();
    expect(within(bookedRow).getByText('S 6837 100,00 €')).toBeInTheDocument();
    fireEvent.click(within(bookedRow).getByRole('button', { name: 'Stornieren' }));
    const dialog = screen.getByRole('dialog', { name: 'Buchung 2026-00010 stornieren' });
    const confirm = within(dialog).getByRole('button', { name: 'Stornieren' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Grund'), { target: { value: 'falsch' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls.unbook).toEqual([{ bankTxId: 'tx3', reason: 'falsch' }]));
  });

  it('a booking without receipt can get one attached', async () => {
    receiptRows.current = [{ id: 'f9', name: 'Miete_2026-02.pdf', link: 'https://drive/f9', score: 3 }];
    renderPage('/finance?tab=done');
    const bookedRow = screen.getByRole('row', { name: /Miete Februar/ });
    fireEvent.click(within(bookedRow).getByRole('button', { name: 'Beleg wählen' }));
    const dialog = screen.getByRole('dialog', { name: 'Beleg zuordnen' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'f9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Beleg speichern' }));
    await waitFor(() => expect(calls.setReceipt).toEqual([
      { bankTxId: 'tx3', receipt: { driveFileId: 'f9', fileName: 'Miete_2026-02.pdf', link: 'https://drive/f9' } },
    ]));
  });

  it('Ignoriert lists only ignored open rows with restore', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /Ignoriert/ }));
    expect(screen.queryByRole('row', { name: /Miete März/ })).not.toBeInTheDocument();
    const row = screen.getByRole('row', { name: /Steuererstattung/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Wiederherstellen' }));
    await waitFor(() => expect(calls.unignore).toEqual([{ bankTxId: 'tx5' }]));
  });
});

describe('FinancePage — rules and journal tabs', () => {
  it('the Regeln tab shows the rules overview', () => {
    renderPage();
    expect(screen.queryByRole('region', { name: 'Buchungsregeln' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Regeln/ }));
    expect(screen.getByRole('region', { name: 'Buchungsregeln' })).toBeInTheDocument();
  });

  it('the Journal tab shows backfill and ledger views', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Prüfen' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Journal \(SKR04\)/ }));
    expect(screen.getByRole('button', { name: 'Prüfen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saldenliste' })).toBeInTheDocument();
  });

  it('ledger entry form can be opened from the header', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Buchung erfassen' }));
    expect(screen.getByRole('heading', { name: 'Buchung erfassen' })).toBeInTheDocument();
  });
});
