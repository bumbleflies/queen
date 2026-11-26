import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ExpensesSection } from '../ExpensesSection';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../Toast';

/** Rows `expenses.claims.list` answers with. */
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));
const role = vi.hoisted(() => ({ current: 'admin' }));
const correctMutation = vi.fn(async () => ({ id: 'claim-1', parse: {}, needsRebook: false }));
const confirmMutation = vi.fn(async () => ({
  id: 'claim-1',
  status: 'booked' as const,
  entryId: 'entry-1',
  rebooked: false,
}));
const reimportMutation = vi.fn(async () => ({
  ok: true as const,
  id: 'claim-1',
  fileName: 'Spesen-TP-202601-Bahn.pdf',
  founderName: 'Test Person',
  status: 'received',
}));

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
    confirm: { useMutation: () => ({ mutateAsync: confirmMutation, isPending: false }) },
    reimport: { useMutation: () => ({ mutateAsync: reimportMutation, isPending: false }) },
    preview: {
      useQuery: () => ({ data: { fileName: 'Spesen-TP-202601-Bahn.pdf', pdfBase64: 'JVBERi0xLjQ=' }, isLoading: false, error: null }),
    },
  };
  return {
    trpc: {
      useUtils: () => ({ expenses: { claims: { list: { invalidate: vi.fn() } } } }),
      me: { useQuery: () => ({ data: { user: { role: role.current } } }) },
      founders: { list: { useQuery: () => ({ data: [FOUNDER] }) } },
      payouts: {
        list: { useQuery: () => ({ data: [] }) },
        preview: { useQuery: () => ({ data: null, isLoading: false }) },
        create: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      },
      expenses: { claims },
    },
  };
});

function renderPage() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={['/finance?tab=expenses']}>
          <ExpensesSection year={2026} />
        </MemoryRouter>
      </ToastProvider>
    </LanguageProvider>,
  );
}

/** Secondary actions live behind the compact Aktionen menu. */
async function openActions() {
  await userEvent.click(await screen.findByText(/Aktionen/));
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  rows.current = [];
  role.current = 'admin';
  correctMutation.mockClear();
  confirmMutation.mockClear();
  reimportMutation.mockClear();
});

describe('ExpensesSection', () => {
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

    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Korrigieren' }));
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

  it('books a received claim in one click', async () => {
    rows.current = [claimRow()];
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Buchen' }));
    expect(confirmMutation).toHaveBeenCalledTimes(1);
    expect(confirmMutation.mock.calls[0][0]).toEqual({ id: 'claim-1' });
  });

  it('re-imports a claim from the same mail without a new email', async () => {
    rows.current = [claimRow()];
    renderPage();

    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Neu importieren' }));
    expect(reimportMutation).toHaveBeenCalledTimes(1);
    expect(reimportMutation.mock.calls[0][0]).toEqual({ id: 'claim-1' });
  });

  it('shows why a queued claim was not booked itself on the booking button', async () => {
    rows.current = [
      claimRow({
        autoBookable: {
          ok: false,
          reasons: ['über Auto-Buchungsgrenze'],
          vatDeductible: false,
          grossOnly: true,
        },
      }),
    ];
    renderPage();

    expect(await screen.findByRole('button', { name: 'Buchen' })).toHaveAttribute(
      'title',
      'über Auto-Buchungsgrenze',
    );
  });

  it('offers an account suggestion that only applies after a click', async () => {
    rows.current = [
      claimRow({
        parse: { ...claimRow().parse, account: null },
        accountSuggestion: { account: '6837', source: 'keyword', lastDate: null },
      }),
    ];
    renderPage();

    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Korrigieren' }));
    const apply = screen.getByRole('button', { name: /Vorschlag: 6837/ });
    expect(screen.getByLabelText('Aufwandskonto')).toHaveValue('');
    await userEvent.click(apply);
    expect(screen.getByLabelText('Aufwandskonto')).toHaveValue('6837');
  });

  it('previews the receipt from the Drive file', async () => {
    rows.current = [claimRow()];
    renderPage();

    await openActions();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Vorschau' }));
    const dialog = await screen.findByRole('dialog', { name: 'Belegvorschau' });
    expect(dialog.querySelector('iframe')).toHaveAttribute('src', 'data:application/pdf;base64,JVBERi0xLjQ=');
    expect(screen.getByRole('link', { name: 'In Drive öffnen' })).toHaveAttribute('href', 'https://drive.example/1');
  });

  it('disables Book when the read lacks a hard booking field', async () => {
    rows.current = [claimRow({ parse: { ...claimRow().parse, account: null } })];
    renderPage();

    const book = await screen.findByRole('button', { name: 'Buchen' });
    expect(book).toBeDisabled();
    expect(book).toHaveAttribute('title', 'Aufwandskonto fehlt – bitte zuerst korrigieren');
  });

  it('never claims input VAT is deductible when the rate is unknown', async () => {
    rows.current = [
      claimRow({
        parse: { ...claimRow().parse, addressedToCompany: true, vatRate: null, vatCents: 8053800 },
        autoBookable: {
          ok: false, reasons: ['USt-Satz unklar'], vatDeductible: false, grossOnly: true,
        },
      }),
    ];
    renderPage();

    expect(await screen.findByText('brutto, ohne Vorsteuer')).toBeInTheDocument();
    expect(screen.queryByText('Vorsteuer abziehbar')).not.toBeInTheDocument();
  });

  it('corrects and rebooks a booked claim in one action', async () => {
    correctMutation.mockResolvedValueOnce({ id: 'claim-1', parse: {}, needsRebook: true });
    rows.current = [claimRow({ status: 'booked' })];
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Korrigieren & neu buchen' }));
    const account = screen.getByLabelText('Aufwandskonto');
    await userEvent.clear(account);
    await userEvent.type(account, '6640');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(correctMutation).toHaveBeenCalledWith(expect.objectContaining({ id: 'claim-1', account: '6640' }));
    expect(confirmMutation).toHaveBeenCalledWith({ id: 'claim-1' });
  });

  it('offers no admin actions to a founder', async () => {
    role.current = 'user';
    rows.current = [claimRow()];
    renderPage();

    expect(await screen.findByText('Bahn')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jetzt abrufen' })).not.toBeInTheDocument();
    expect(screen.queryByText('Aktionen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Buchen' })).not.toBeInTheDocument();
  });

  it('marks an unknown sender as unassigned instead of guessing', async () => {
    rows.current = [claimRow({ founder: null })];
    renderPage();

    expect(await screen.findByText('zuordnen …')).toBeInTheDocument();
    // The founder cell offers the registry instead of inventing an owner.
    expect(screen.getByRole('combobox', { name: 'Gesellschafter' })).toBeInTheDocument();
  });
});
