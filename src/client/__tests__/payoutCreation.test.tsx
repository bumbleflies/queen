import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PayoutSuggestions } from '../components/PayoutSuggestions';

interface FounderOption {
  id: string;
  name: string;
  shortName: string;
  active: boolean;
}

interface PreviewClaim {
  id: string;
  period: string;
  grossCents: number;
  vendorName: string;
  date: string | null;
}

interface PreviewData {
  number: string;
  amountCents: number;
  purpose: string;
  payload: string | null;
  periods: string[];
  founder: { id: string; name: string; shortName: string; iban: string; bic: string };
  claims: PreviewClaim[];
}

const state = vi.hoisted(() => ({
  founders: [] as FounderOption[],
  previews: {} as Record<string, PreviewData | null>,
  create: vi.fn(async (_input: { founderId: string }) => ({ number: 'SP-2026-0002' })),
  navigate: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      payouts: { list: { invalidate: vi.fn(async () => {}) } },
      expenses: { claims: { list: { invalidate: vi.fn(async () => {}) } } },
    }),
    founders: { list: { useQuery: () => ({ data: state.founders }) } },
    payouts: {
      preview: {
        useQuery: ({ founderId }: { founderId: string }) => ({
          data: state.previews[founderId] ?? null,
          isLoading: false,
        }),
      },
      create: { useMutation: () => ({ mutateAsync: state.create, isPending: false }) },
    },
  },
}));

vi.mock('../components/Toast', () => ({
  useToast: () => ({ show: vi.fn(), error: state.toastError }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => state.navigate };
});

const FOUNDER: FounderOption = { id: 'f1', name: 'Chris Daehn', shortName: 'ChrisD', active: true };

function claim(id: string, grossCents: number): PreviewClaim {
  return { id, period: '2026-01', grossCents, vendorName: 'Bahn', date: null };
}

function preview(claims: PreviewClaim[], amountCents: number, payload: string | null = 'BCD\n002\n…'): PreviewData {
  return {
    number: 'SP-2026-0002',
    amountCents,
    purpose: 'Spesen ChrisD 2026-01 SP-2026-0002',
    payload,
    periods: claims.length ? ['2026-01'] : [],
    founder: { id: 'f1', name: 'Chris Daehn', shortName: 'ChrisD', iban: 'DE89370400440532013000', bic: '' },
    claims,
  };
}

function renderSuggestions() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/expenses']}>
        <PayoutSuggestions />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  state.founders = [FOUNDER];
  state.previews = { f1: preview([claim('c1', 2000), claim('c2', 2120)], 4120) };
  state.create.mockReset();
  state.create.mockResolvedValue({ number: 'SP-2026-0002' });
  state.navigate.mockClear();
  state.toastError.mockClear();
});

describe('payout creation', () => {
  it('offers the aggregated booked claims with their total and period', () => {
    renderSuggestions();
    expect(screen.getByText('1 Auszahlung')).toBeInTheDocument();
    expect(screen.getByText('41,20 €')).toBeInTheDocument();
    expect(screen.getByText(/2 Belege/)).toBeInTheDocument();
    expect(screen.getByText(/Zeiträume: 2026-01/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auszahlung anlegen' })).toBeInTheDocument();
  });

  it('creates for that founder and opens the returned payout', async () => {
    renderSuggestions();
    await userEvent.click(screen.getByRole('button', { name: 'Auszahlung anlegen' }));
    await waitFor(() => expect(state.create).toHaveBeenCalledWith({ founderId: 'f1' }));
    expect(state.navigate).toHaveBeenCalledWith('/expenses/payouts/SP-2026-0002');
  });

  it('offers nothing when the preview has no eligible claims', () => {
    state.previews = { f1: preview([], 0, null) };
    renderSuggestions();
    expect(screen.queryByRole('button', { name: 'Auszahlung anlegen' })).not.toBeInTheDocument();
    expect(screen.queryByText('1 Auszahlung')).not.toBeInTheDocument();
  });

  it('skips inactive founders', () => {
    state.founders = [{ ...FOUNDER, active: false }];
    renderSuggestions();
    expect(screen.queryByRole('button', { name: 'Auszahlung anlegen' })).not.toBeInTheDocument();
  });

  it('shows the server error when the payout cannot be created', async () => {
    state.create.mockRejectedValueOnce(new Error('Für diesen Gesellschafter ist keine IBAN hinterlegt'));
    renderSuggestions();
    await userEvent.click(screen.getByRole('button', { name: 'Auszahlung anlegen' }));
    await waitFor(() =>
      expect(state.toastError).toHaveBeenCalledWith('Für diesen Gesellschafter ist keine IBAN hinterlegt'),
    );
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
