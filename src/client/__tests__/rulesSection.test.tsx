import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

const calls: Record<string, unknown[]> = {};
const state = vi.hoisted(() => ({ role: 'admin' as 'admin' | 'user', overviewInputs: [] as unknown[] }));

const rules = vi.hoisted(() => [
  {
    id: 's1',
    kreditorNumber: 70000,
    name: 'Hoster GmbH',
    ibans: ['DE02120300000000202051'],
    namePatterns: ['Hoster'],
    purposePatterns: [],
    defaultAccount: '6837',
    defaultVatRate: 0.19,
    defaultMode: 'normal',
    archived: false,
    autoBook: false,
    openHits: 2,
  },
  {
    id: 's2',
    kreditorNumber: 70001,
    name: 'USt Kontoführung',
    ibans: [],
    namePatterns: [],
    purposePatterns: ['% Umsatzsteuer auf EUR'],
    defaultAccount: null,
    defaultVatRate: 0.19,
    defaultMode: 'vatOnly',
    archived: false,
    autoBook: false,
    openHits: 0,
  },
]);

function mut(name: string, result: (input: unknown) => unknown = () => ({})) {
  return {
    useMutation: () => ({
      mutateAsync: async (input: unknown) => {
        calls[name].push(input);
        return result(input);
      },
      isPending: false,
    }),
  };
}

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      suppliers: { invalidate: async () => {}, exportJson: { fetch: async () => [] } },
      bookings: { invalidate: async () => {} },
    }),
    me: { useQuery: () => ({ data: { user: { sub: 'u', email: 'u@example.de', role: state.role } } }) },
    accounts: { list: { useQuery: () => ({ data: [{ number: '6837', name: 'Lizenzen' }] }) } },
    suppliers: {
      overview: {
        useQuery: (input: { includeArchived?: boolean }) => {
          state.overviewInputs.push(input);
          return { data: rules, isLoading: false };
        },
      },
      create: mut('create'),
      update: mut('update'),
      setArchived: mut('setArchived'),
      importJson: mut('importJson', (input) =>
        (input as { dryRun: boolean }).dryRun
          ? { rows: 1, created: 1, updated: 0, unchanged: 0, items: [{ name: 'Amt', kreditorNumber: null, action: 'create' }], errors: [] }
          : { rows: 1, created: 1, updated: 0, unchanged: 0, items: [], errors: [] },
      ),
    },
  },
}));

vi.mock('../components/Toast', () => ({ useToast: () => ({ show: () => {}, error: () => {} }) }));

import { RulesSection } from '../components/RulesSection';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  for (const k of ['create', 'update', 'setArchived', 'importJson']) calls[k] = [];
  state.role = 'admin';
  state.overviewInputs = [];
});

function renderSection() {
  render(
    <LanguageProvider>
      <RulesSection year={2026} />
    </LanguageProvider>,
  );
}

describe('RulesSection', () => {
  it('lists rules with matching, account, VAT and open hits', () => {
    renderSection();
    const row = screen.getByRole('row', { name: /Hoster GmbH/ });
    expect(within(row).getByText('70000')).toBeInTheDocument();
    expect(within(row).getByText('DE02120300000000202051')).toBeInTheDocument();
    expect(within(row).getByText('Hoster')).toBeInTheDocument();
    expect(within(row).getByText('6837')).toBeInTheDocument();
    expect(within(row).getByText('19 %')).toBeInTheDocument();
    expect(within(row).getByText('2 offen')).toBeInTheDocument();
    const vat = screen.getByRole('row', { name: /USt Kontoführung/ });
    expect(within(vat).getByText('nur USt')).toBeInTheDocument();
    expect(within(vat).getByText('0 offen')).toBeInTheDocument();
  });

  it('show archived asks the server for archived rules', () => {
    renderSection();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Archivierte zeigen' }));
    expect(state.overviewInputs.at(-1)).toEqual({ year: 2026, includeArchived: true });
  });

  it('creates a rule with one pattern per line', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Regel anlegen' }));
    const dialog = screen.getByRole('dialog', { name: 'Regel anlegen' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Kontoführung' } });
    fireEvent.change(within(dialog).getByLabelText(/Verwendungszweck enthält/), { target: { value: 'ABSCHLUSS PER\n\n Entgelt ' } });
    fireEvent.change(within(dialog).getByLabelText('Konto'), { target: { value: '6855' } });
    fireEvent.change(within(dialog).getByLabelText('USt-Satz'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.create).toEqual([{
      name: 'Kontoführung',
      ibans: [],
      purposePatterns: ['ABSCHLUSS PER', 'Entgelt'],
      namePatterns: [],
      defaultAccount: '6855',
      defaultVatRate: 0,
      defaultMode: 'normal',
      autoBook: false,
    }]));
  });

  it('saving with "Automatisch buchen" checked sends autoBook: true', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'Regel anlegen' }));
    const dialog = screen.getByRole('dialog', { name: 'Regel anlegen' });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Hoster' } });
    fireEvent.change(within(dialog).getByLabelText('IBAN'), { target: { value: 'DE02120300000000202051' } });
    fireEvent.change(within(dialog).getByLabelText('Konto'), { target: { value: '6837' } });
    expect(within(dialog).getByText('nur bei Erkennung über IBAN oder Verwendungszweck')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Automatisch buchen \(täglich 07:30\)/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.create).toEqual([expect.objectContaining({ name: 'Hoster', autoBook: true })]));
  });

  it('shows an "auto" badge for flagged rules and keeps the flag when editing', async () => {
    rules[0].autoBook = true;
    try {
      renderSection();
      const row = screen.getByRole('row', { name: /Hoster GmbH/ });
      expect(within(row).getByText('auto')).toBeInTheDocument();
      expect(within(screen.getByRole('row', { name: /USt Kontoführung/ })).queryByText('auto')).not.toBeInTheDocument();
      fireEvent.click(within(row).getByRole('button', { name: 'Bearbeiten' }));
      const dialog = screen.getByRole('dialog', { name: 'Regel bearbeiten' });
      expect(within(dialog).getByRole('checkbox', { name: /Automatisch buchen/ })).toBeChecked();
    } finally {
      rules[0].autoBook = false;
    }
  });

  it('edits and archives an existing rule', async () => {
    renderSection();
    const row = screen.getByRole('row', { name: /Hoster GmbH/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Bearbeiten' }));
    const dialog = screen.getByRole('dialog', { name: 'Regel bearbeiten' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Hoster GmbH');
    fireEvent.change(within(dialog).getByLabelText(/Name enthält/), { target: { value: 'Hoster\nHoster Online' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.update).toEqual([expect.objectContaining({ id: 's1', namePatterns: ['Hoster', 'Hoster Online'], defaultAccount: '6837' })]));
    fireEvent.click(within(screen.getByRole('row', { name: /Hoster GmbH/ })).getByRole('button', { name: 'Archivieren' }));
    await waitFor(() => expect(calls.setArchived).toEqual([{ id: 's1', archived: true }]));
  });

  it('imports JSON after a successful check', async () => {
    renderSection();
    fireEvent.click(screen.getByRole('button', { name: 'JSON importieren' }));
    const dialog = screen.getByRole('dialog', { name: 'Regeln aus JSON importieren' });
    const apply = within(dialog).getByRole('button', { name: 'Importieren' });
    expect(apply).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: '[{"name":"Amt"}]' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prüfen' }));
    expect(await within(dialog).findByText('1 neu · 0 geändert · 0 unverändert')).toBeInTheDocument();
    expect(within(dialog).getByText('Amt')).toBeInTheDocument();
    fireEvent.click(apply);
    await waitFor(() => expect(calls.importJson).toEqual([
      { json: '[{"name":"Amt"}]', dryRun: true },
      { json: '[{"name":"Amt"}]', dryRun: false },
    ]));
  });

  it('is read-only for non-admins', () => {
    state.role = 'user';
    renderSection();
    expect(screen.getByText('Nur Admins können Regeln ändern.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regel anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
