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

vi.mock('../../lib/trpc', () => {
  const bills = {
    list: { useQuery: () => ({ data: [], isLoading: false }) },
    intakeNow: { useMutation: () => ({ mutateAsync: intakeMutation, isPending: false }) },
    setIgnored: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    reread: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
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
});
