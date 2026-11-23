import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExpensesPage } from '../ExpensesPage';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../../components/Toast';

/** Rows `expenses.claims.list` answers with. */
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
const role = vi.hoisted(() => ({ current: 'admin' }));
const correctMutation = vi.fn(async () => ({ id: 'claim-1', parse: {}, needsRebook: false }));

const FOUNDER = { id: 'f1', name: 'Test Person', shortName: 'TP', active: true };

function claimRow(over: Record<string, unknown> = {}) {
  return {
    id: 'claim-1',
    receivedAt: '2026-01-20T00:00:00.000Z',
    period: '2026-01',
    from: 'Test Person <tp@example.org>',
    subject: 'Spesen Januar',
    fileName: 'Spesen-TP-202601-Bahn.pdf',
    driveFileId: 'drive-1',
    driveLink: 'https://drive.example/1',
    status: 'received',
    error: null,
    founder: FOUNDER,
    parse: {
      date: '2026-01-20T00:00:00.000Z',
      vendorName: 'Bahn',
      invoiceNumber: 'R-1',
      grossCents: 4120,
      netCents: 3462,
      vatCents: 658,
      vatRate: 0.19,
      account: '6837',
      reverseCharge: false,
      addressedToCompany: true,
      currency: 'EUR',
    },
    corrected: null,
    payoutId: null,
    autoBookable: { ok: true, reasons: [], vatDeductible: true, grossOnly: false },
    ...over,
  };
}

vi.mock('../../lib/trpc', () => {
  const claims = {
    list: { useQuery: () => ({ data: rows.current, isLoading: false }) },
    intakeNow: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    setIgnored: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    assignFounder: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    createManual: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    correct: { useMutation: () => ({ mutateAsync: correctMutation, isPending: false }) },
  };
  return {
    trpc: {
      useUtils: () => ({ expenses: { claims: { list: { invalidate: vi.fn() } } } }),
      me: { useQuery: () => ({ data: { user: { role: role.current } } }) },
      founders: { list: { useQuery: () => ({ data: [FOUNDER] }) } },
      expenses: { claims },
    },
  };
});

function renderPage() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/expenses']}>
          <ExpensesPage />
        </MemoryRouter>
      </ToastProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  rows.current = [];
  role.current = 'admin';
  correctMutation.mockClear();
});

describe('ExpensesPage', () => {
  it('shows what a claim says, who paid it and whether it is complete', async () => {
    rows.current = [claimRow()];
    renderPage();

    expect(await screen.findByText('Bahn')).toBeInTheDocument();
    expect(screen.getByText('Test Person')).toBeInTheDocument();
    expect(screen.getByText('41,20 €')).toBeInTheDocument();
    expect(screen.getByText('automatisch buchbar')).toBeInTheDocument();
    expect(screen.getByText('Vorsteuer abziehbar')).toBeInTheDocument();
  });

  it('says why a claim has to be checked by hand', async () => {
    rows.current = [
      claimRow({
        parse: { ...claimRow().parse, addressedToCompany: false },
        autoBookable: {
          ok: false,
          reasons: ['über Auto-Buchungsgrenze', 'Geschäftsjahr abgeschlossen'],
          vatDeductible: false,
          grossOnly: true,
        },
      }),
    ];
    renderPage();

    expect(await screen.findByText('manuell prüfen')).toBeInTheDocument();
    expect(screen.getByText('über Auto-Buchungsgrenze · Geschäftsjahr abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText('brutto, ohne Vorsteuer')).toBeInTheDocument();
  });

  it('lets an admin correct an amount the read got wrong', async () => {
    rows.current = [claimRow()];
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Korrigieren' }));
    const gross = screen.getByLabelText('Bruttobetrag');
    expect(gross).toHaveValue('41,20');
    await userEvent.clear(gross);
    await userEvent.type(gross, '45,00');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(correctMutation).toHaveBeenCalledTimes(1);
    expect(correctMutation.mock.calls[0][0]).toMatchObject({
      id: 'claim-1',
      vendorName: 'Bahn',
      invoiceNumber: 'R-1',
      grossCents: 4500,
      netCents: 3462,
      vatCents: 658,
      vatRate: 0.19,
      account: '6837',
    });
  });

  it('offers no admin actions to a founder', async () => {
    role.current = 'user';
    rows.current = [claimRow()];
    renderPage();

    expect(await screen.findByText('Bahn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jetzt abrufen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Korrigieren' })).not.toBeInTheDocument();
  });

  it('marks an unknown sender as unassigned instead of guessing', async () => {
    rows.current = [claimRow({ founder: null })];
    renderPage();

    expect(await screen.findByText('zuordnen …')).toBeInTheDocument();
    // The founder cell offers the registry instead of inventing an owner.
    expect(screen.getByRole('combobox', { name: 'Gesellschafter' })).toBeInTheDocument();
  });
});
