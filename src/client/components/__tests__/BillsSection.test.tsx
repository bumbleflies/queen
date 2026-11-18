import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BillsSection } from '../BillsSection';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../Toast';

/** What `bills.intakeNow` answers; the reply fields are what this section reports. */
const intakeResult = vi.hoisted(() => ({
  current: {
    ok: true as const,
    messages: 1,
    attachments: 1,
    created: 1,
    skipped: 0,
    noText: 0,
    failed: 0,
    errors: [] as string[],
    notified: 0,
    notifyErrors: [] as string[],
  },
}));

const intakeMutation = vi.fn(async () => intakeResult.current);
const correctMutation = vi.fn(async () => ({ id: 'bill-1', parse: {} }));

/** Rows `bills.list` answers with (empty unless a test asks for a bill). */
const rows = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock('../../lib/trpc', () => {
  const bills = {
    list: { useQuery: () => ({ data: rows.current, isLoading: false }) },
    intakeNow: { useMutation: () => ({ mutateAsync: intakeMutation, isPending: false }) },
    setIgnored: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    reread: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    correct: { useMutation: () => ({ mutateAsync: correctMutation, isPending: false }) },
  };
  return {
    trpc: {
      useUtils: () => ({ bills: { list: { invalidate: vi.fn() } } }),
      me: { useQuery: () => ({ data: { user: { role: 'admin' } } }) },
      bills,
    },
  };
});

function renderSection() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <BillsSection />
      </ToastProvider>
    </LanguageProvider>,
  );
}

async function fetchNow() {
  renderSection();
  await userEvent.click(screen.getByRole('button', { name: 'Jetzt abrufen' }));
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  intakeMutation.mockClear();
  correctMutation.mockClear();
  rows.current = [];
  intakeResult.current = {
    ok: true,
    messages: 1,
    attachments: 1,
    created: 1,
    skipped: 0,
    noText: 0,
    failed: 0,
    errors: [],
    notified: 0,
    notifyErrors: [],
  };
});

describe('BillsSection', () => {
  it('shows the fetch result and warns when the confirmation mail could not be sent', async () => {
    intakeResult.current = {
      ...intakeResult.current,
      notifyErrors: ['Nachricht m1: Gmail-Versand steht nicht zur Verfügung — es fehlt der Zugriff `gmail.send`'],
    };

    await fetchNow();

    // What was filed is one message; what could not be answered is a warning.
    expect(await screen.findByText('Abgerufen: 1 neu, 0 bereits vorhanden, 0 Fehler')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Beleg abgelegt, Bestätigungsmail fehlgeschlagen: Nachricht m1: Gmail-Versand steht nicht zur Verfügung — es fehlt der Zugriff `gmail.send`',
      ),
    ).toBeInTheDocument();
  });

  it('stays quiet when every reply went out', async () => {
    intakeResult.current = { ...intakeResult.current, created: 2, notified: 2 };

    await fetchNow();

    expect(await screen.findByText('Abgerufen: 2 neu, 0 bereits vorhanden, 0 Fehler')).toBeInTheDocument();
    expect(screen.queryByText(/Bestätigungsmail fehlgeschlagen/)).not.toBeInTheDocument();
  });

  it('does not crash on a server response from before the reply counter', async () => {
    // `notifyErrors` is optional in the client on purpose: an older server (or a
    // cached bundle) answers without it.
    const legacy = { ...intakeResult.current } as Record<string, unknown>;
    delete legacy.notifyErrors;
    intakeResult.current = legacy as unknown as typeof intakeResult.current;

    await fetchNow();

    expect(await screen.findByText('Abgerufen: 1 neu, 0 bereits vorhanden, 0 Fehler')).toBeInTheDocument();
    expect(screen.queryByText(/Bestätigungsmail fehlgeschlagen/)).not.toBeInTheDocument();
  });

  it('lets an admin correct an amount the PDF read wrong', async () => {
    // The Hetzner invoice that read as 2.026,00 € instead of 12,14 €.
    rows.current = [
      {
        id: 'bill-1',
        receivedAt: '2026-11-16T00:00:00.000Z',
        from: 'Hetzner Online GmbH <billing@hetzner.com>',
        subject: 'Hetzner Online GmbH - Invoice 087001370124',
        fileName: 'Hetzner_2026-11-16_087001370124.pdf',
        driveLink: 'https://drive.example/1',
        status: 'parsed',
        ignored: false,
        parse: {
          vendorName: 'Hetzner Online GmbH',
          invoiceNumber: '087001370124',
          grossCents: 202600,
          netCents: null,
          vatCents: null,
          vatRate: null,
          dueDate: null,
        },
        transaction: null,
      },
    ];
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Korrigieren' }));
    const gross = screen.getByLabelText('Bruttobetrag');
    expect(gross).toHaveValue('2026,00');
    await userEvent.clear(gross);
    await userEvent.type(gross, '12,14');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(correctMutation).toHaveBeenCalledTimes(1);
    expect(correctMutation.mock.calls[0][0]).toMatchObject({
      id: 'bill-1',
      invoiceNumber: '087001370124',
      grossCents: 1214,
      netCents: null,
      vatCents: null,
      vatRate: null,
      dueDate: null,
    });
  });

  it('refuses an amount it cannot read instead of writing a wrong one', async () => {
    rows.current = [
      {
        id: 'bill-1',
        receivedAt: '2026-11-16T00:00:00.000Z',
        from: 'Hetzner Online GmbH <billing@hetzner.com>',
        subject: 'Rechnung',
        fileName: 'rechnung.pdf',
        driveLink: '',
        status: 'parsed',
        ignored: false,
        parse: { grossCents: 202600 },
        transaction: null,
      },
    ];
    renderSection();

    await userEvent.click(await screen.findByRole('button', { name: 'Korrigieren' }));
    const gross = screen.getByLabelText('Bruttobetrag');
    await userEvent.clear(gross);
    await userEvent.type(gross, 'zwoelf');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Betrag „zwoelf“ ist keine Zahl')).toBeInTheDocument();
    expect(correctMutation).not.toHaveBeenCalled();
  });
});
