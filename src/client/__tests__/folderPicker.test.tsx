import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';
import { MemoryRouter } from 'react-router-dom';

const q = vi.hoisted(() => (data: unknown) => ({ useQuery: () => ({ data, isError: false, isLoading: false }) }));
const calls: Record<string, unknown[]> = {};
const foldersState = vi.hoisted(() => ({ invoices: null, receipts: null }));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      settings: { getDriveFolders: { invalidate: async () => {} } },
      invalidate: async () => {},
    }),
    me: q({ user: { email: 'admin@example.de', role: 'admin' } }),
    settings: {
      getDriveFolders: q(foldersState),
      browseDriveFolders: q([{ id: 'f1', name: 'Abrechnungen' }]),
      setDriveFolders: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            (calls.set ??= []).push(input);
            const i = input as { invoices?: unknown; receipts?: unknown };
            if (i.invoices !== undefined) foldersState.invoices = i.invoices;
            if (i.receipts !== undefined) foldersState.receipts = i.receipts;
            return input;
          },
          isPending: false,
        }),
      },
    },
  },
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

import { SettingsPage } from '../pages/SettingsPage';

describe('SettingsPage drive folders', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('queen-lang', 'de');
    Object.keys(calls).forEach((k) => delete calls[k]);
  });

  it('shows folder section for admins and saves a picked folder', async () => {
    render(
      <MemoryRouter>
        <LanguageProvider>
          <SettingsPage />
        </LanguageProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Rechnungs-Ordner')).toBeInTheDocument();
    expect(screen.getByText('Belege-Ordner')).toBeInTheDocument();
    expect(screen.getAllByText('Kein Ordner gewählt').length).toBe(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Ändern' })[1]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Abrechnungen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ordner auswählen' }));
    await waitFor(() =>
      expect(calls.set).toEqual([{ receipts: { id: 'f1', name: 'Abrechnungen' } }]),
    );
    await waitFor(() =>
      expect(screen.getAllByText('Abrechnungen').length).toBeGreaterThan(0),
    );
  });

  it('remove clears the stored folder', async () => {
    foldersState.receipts = { id: 'f1', name: 'Abrechnungen' };
    try {
      render(
        <MemoryRouter>
          <LanguageProvider>
            <SettingsPage />
          </LanguageProvider>
        </MemoryRouter>,
      );
      const label = screen.getByText('Abrechnungen');
      expect(label).toBeInTheDocument();
      const labelRow = label.closest('div');
      fireEvent.click(withinRow(labelRow).getByRole('button', { name: 'Ändern' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Ordner entfernen' }));
      await waitFor(() => expect(calls.set).toEqual([{ receipts: null }]));
    } finally {
      foldersState.receipts = null;
    }
  });
});

function withinRow(el: HTMLElement | null) {
  return { getByRole: (role: string, opts: { name?: string | RegExp }) => {
    const buttons = (el as HTMLElement).querySelectorAll('button');
    const name = opts.name instanceof RegExp ? opts.name.source : String(opts.name);
    const found = Array.from(buttons).find((b) =>
      opts.name instanceof RegExp ? opts.name.test(b.textContent ?? '') : b.textContent === name,
    );
    if (!found) throw new Error(`button ${name} not found`);
    return found;
  } };
}
