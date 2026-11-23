import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoundersSection } from '../FoundersSection';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../Toast';

interface FounderRow {
  id: string;
  name: string;
  shortName: string;
  emails: string[];
  loginEmail: string;
  iban: string;
  bic: string;
  liabilityAccount: string;
  legacyCreditorNumber: number | null;
  active: boolean;
}

const state = vi.hoisted(() => ({
  rows: [] as FounderRow[],
  create: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'f-new' })),
  update: vi.fn(async (_input: Record<string, unknown>) => ({ id: 'f1' })),
  setActive: vi.fn(async (_input: Record<string, unknown>) => ({})),
  addEmail: vi.fn(async (_input: Record<string, unknown>) => ({})),
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ founders: { list: { invalidate: vi.fn(async () => {}) } } }),
    founders: {
      list: { useQuery: () => ({ data: state.rows, isError: false, error: null }) },
      create: { useMutation: () => ({ mutateAsync: state.create, isPending: false }) },
      update: { useMutation: () => ({ mutateAsync: state.update, isPending: false }) },
      setActive: { useMutation: () => ({ mutateAsync: state.setActive, isPending: false }) },
      addEmail: { useMutation: () => ({ mutateAsync: state.addEmail, isPending: false }) },
    },
  },
}));

const FOUNDER: FounderRow = {
  id: 'f1',
  name: 'Chris Daehn',
  shortName: 'ChrisD',
  emails: ['chris@example.org'],
  loginEmail: 'chris@bumbleflies.de',
  iban: 'DE89370400440532013000',
  bic: '',
  liabilityAccount: '3500',
  legacyCreditorNumber: null,
  active: true,
};

function renderSection() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <FoundersSection />
      </ToastProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  state.rows = [{ ...FOUNDER, emails: [...FOUNDER.emails] }];
  state.create.mockClear();
  state.update.mockClear();
  state.setActive.mockClear();
  state.addEmail.mockClear();
});

describe('FoundersSection', () => {
  it('lists each founder with the login address and a formatted IBAN', () => {
    renderSection();
    expect(screen.getByText('Chris Daehn')).toBeInTheDocument();
    expect(screen.getByText('chris@bumbleflies.de')).toBeInTheDocument();
    expect(screen.getByText('DE89 3704 0044 0532 0130 00')).toBeInTheDocument();
    expect(screen.getByText('3500')).toBeInTheDocument();
    expect(screen.getAllByText('Aktiv').length).toBeGreaterThan(0);
  });

  it('creates a founder with normalized addresses, login address and IBAN', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Gesellschafter hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Gesellschafter hinzufügen' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Chris Daehn');
    await userEvent.type(within(dialog).getByLabelText('Kurzname'), 'ChrisD');
    await userEvent.type(
      within(dialog).getByLabelText('Eingangs-Adressen (mit Komma trennen)'),
      'Chris@Example.org, privat@example.org',
    );
    await userEvent.type(within(dialog).getByLabelText('Login-Adresse (@bumbleflies.de)'), 'Chris@Bumbleflies.de');
    await userEvent.type(within(dialog).getByLabelText('IBAN'), 'de89 3704 0044 0532 0130 00');
    await userEvent.type(within(dialog).getByLabelText('Alte Kreditorennummer (optional)'), '71234');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
    expect(state.create.mock.calls[0][0]).toEqual({
      name: 'Chris Daehn',
      shortName: 'ChrisD',
      emails: ['chris@example.org', 'privat@example.org'],
      loginEmail: 'chris@bumbleflies.de',
      iban: 'DE89370400440532013000',
      bic: undefined,
      liabilityAccount: '3500',
      legacyCreditorNumber: 71234,
    });
  });

  it('rejects a login address outside bumbleflies.de before the mutation', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Gesellschafter hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Gesellschafter hinzufügen' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Chris Daehn');
    await userEvent.type(within(dialog).getByLabelText('Kurzname'), 'ChrisD');
    await userEvent.type(within(dialog).getByLabelText('Eingangs-Adressen (mit Komma trennen)'), 'chris@example.org');
    await userEvent.type(within(dialog).getByLabelText('Login-Adresse (@bumbleflies.de)'), 'chris@example.org');
    await userEvent.type(within(dialog).getByLabelText('IBAN'), 'DE89370400440532013000');

    expect(within(dialog).getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(
      within(dialog).getByText(
        'Bitte Name, Kurzname, gültige E-Mails, eine @bumbleflies.de Login-Adresse und eine IBAN angeben.',
      ),
    ).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('archives an active founder through setActive', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Archivieren' }));
    await waitFor(() => expect(state.setActive).toHaveBeenCalledWith({ id: 'f1', active: false }));
  });

  it('edits the same fields through update', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Gesellschafter bearbeiten' });
    const name = within(dialog).getByLabelText('Name');
    expect(name).toHaveValue('Chris Daehn');
    await userEvent.clear(name);
    await userEvent.type(name, 'Chris D. Daehn');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
    expect(state.update.mock.calls[0][0]).toEqual({
      id: 'f1',
      name: 'Chris D. Daehn',
      shortName: 'ChrisD',
      emails: ['chris@example.org'],
      loginEmail: 'chris@bumbleflies.de',
      iban: 'DE89370400440532013000',
      bic: '',
      liabilityAccount: '3500',
    });
  });

  it('adds an intake address without touching the other fields', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Adresse hinzufügen' }));
    const dialog = screen.getByRole('dialog', { name: 'Eingangs-Adresse hinzufügen' });
    await userEvent.type(within(dialog).getByLabelText('Eingangs-Adressen (mit Komma trennen)'), 'Privat@Example.org');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(state.addEmail).toHaveBeenCalledWith({ id: 'f1', email: 'privat@example.org' }));
  });
});
