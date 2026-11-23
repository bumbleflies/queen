import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { PayoutPage } from '../pages/PayoutPage';

const state = vi.hoisted(() => ({
  role: 'admin' as string,
  payout: null as Record<string, unknown> | null,
  qr: null as Record<string, unknown> | null,
  release: vi.fn(async () => ({})),
  mark: vi.fn(async () => ({})),
  cancel: vi.fn(async () => ({})),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payouts: { get: { invalidate: async () => {} }, list: { invalidate: async () => {} } },
    }),
    me: { useQuery: () => ({ data: { user: { role: state.role } }, isLoading: false }) },
    payouts: {
      get: { useQuery: () => ({ data: state.payout, isLoading: false }) },
      qr: { useQuery: () => ({ data: state.qr, isLoading: false }) },
      release: { useMutation: () => ({ mutateAsync: state.release, isPending: false }) },
      markExecuted: { useMutation: () => ({ mutateAsync: state.mark, isPending: false }) },
      cancel: { useMutation: () => ({ mutateAsync: state.cancel, isPending: false }) },
    },
  },
}));

vi.mock('qrcode', () => ({
  toDataURL: vi.fn(async () => 'data:image/png;base64,QR'),
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: () => {}, error: () => {} }),
}));

function payout(status: string) {
  return {
    id: 'p1',
    number: 'SP-2026-0001',
    reference: 'SP-2026-0001',
    status,
    amountCents: 4120,
    purpose: 'Spesen ChrisD 2026-01 SP-2026-0001',
    qr: status === 'released' || status === 'executed' ? 'BCD\n002\n…' : null,
    settledAt: new Date(2026, 10, 23),
    founder: { id: 'f1', name: 'Chris Daehn', shortName: 'ChrisD', loginEmail: 'chris@bumbleflies.de' },
    claims: [
      {
        id: 'c1',
        period: '2026-01',
        status: 'booked',
        grossCents: 4120,
        vendorName: 'Bahn',
        fileName: 'beleg.pdf',
        driveLink: '',
      },
    ],
  };
}

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/expenses/payouts/SP-2026-0001']}>
        <Routes>
          <Route path="/expenses/payouts/:number" element={<PayoutPage />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

function LoginTarget() {
  const [params] = useSearchParams();
  return <div data-testid="login-target">next={params.get('next')}</div>;
}

function renderProtected() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/expenses/payouts/SP-2026-0001']}>
        <Routes>
          <Route
            path="/expenses/payouts/:number"
            element={<ProtectedRoute><PayoutPage /></ProtectedRoute>}
          />
          <Route path="/login" element={<LoginTarget />} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('PayoutPage', () => {
  beforeEach(() => {
    localStorage.setItem('queen-lang', 'de');
    state.role = 'admin';
    state.payout = payout('draft');
    state.qr = null;
    state.release.mockClear();
    state.mark.mockClear();
    state.cancel.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a logged-out visitor to login and keeps the payout path as return-to', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    renderProtected();
    expect(await screen.findByTestId('login-target')).toHaveTextContent(
      'next=/expenses/payouts/SP-2026-0001',
    );
  });

  it('shows Freigeben on a draft and no QR', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeInTheDocument();
    expect(screen.queryByAltText('Girocode')).not.toBeInTheDocument();
  });

  it('releases from the page', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));
    expect(state.release).toHaveBeenCalledWith({ id: 'p1' });
  });

  it('shows the QR and the copyable fields after release', async () => {
    state.payout = payout('released');
    state.qr = {
      payload: 'BCD\n002\n1\nSCT\n\nChris Daehn\nDE89370400440532013000\nEUR41.20\n\n\nSpesen ChrisD 2026-01 SP-2026-0001\n',
      name: 'Chris Daehn',
      iban: 'DE89370400440532013000',
      amountCents: 4120,
      purpose: 'Spesen ChrisD 2026-01 SP-2026-0001',
    };
    renderPage();
    expect(await screen.findByAltText('Girocode')).toHaveAttribute('src', 'data:image/png;base64,QR');
    expect(screen.getByText('In der GLS-App scannen und dort mit TAN bestätigen. Danach hier nichts weiter tun — die Bankzeile gleicht automatisch aus.')).toBeInTheDocument();
    expect(screen.getAllByText('SP-2026-0001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Spesen ChrisD 2026-01 SP-2026-0001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('41,20 €').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Als überwiesen' })).toBeInTheDocument();
  });

  it('shows settled without a QR', () => {
    state.payout = payout('settled');
    renderPage();
    expect(screen.getByText('Ausgeglichen am 23.11.2026')).toBeInTheDocument();
    expect(screen.queryByAltText('Girocode')).not.toBeInTheDocument();
  });

  it('shows canceled without a QR', () => {
    state.payout = payout('canceled');
    renderPage();
    expect(screen.getAllByText('Abgebrochen').length).toBeGreaterThan(0);
    expect(screen.queryByAltText('Girocode')).not.toBeInTheDocument();
  });

  it('hides the page from non-admins', () => {
    state.role = 'user';
    renderPage();
    expect(screen.getByText('Nur Administratoren können Auszahlungen öffnen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Freigeben' })).not.toBeInTheDocument();
  });
});
