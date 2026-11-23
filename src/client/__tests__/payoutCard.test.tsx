import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PayoutCard } from '../components/PayoutCard';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('../lib/trpc', () => ({
  trpc: {
    payouts: {
      list: { useQuery: () => ({ data: state.rows }) },
    },
  },
}));

function renderCard() {
  return render(
    <LanguageProvider>
      <MemoryRouter>
        <PayoutCard />
      </MemoryRouter>
    </LanguageProvider>,
  );
}

describe('PayoutCard', () => {
  beforeEach(() => {
    localStorage.setItem('queen-lang', 'de');
    state.rows = [];
  });

  it('shows the empty state without payouts', () => {
    renderCard();
    expect(screen.getByText('Noch keine Auszahlungen')).toBeInTheDocument();
  });

  it('links each payout to its authenticated page', () => {
    state.rows = [
      {
        id: 'p1',
        number: 'SP-2026-0001',
        status: 'released',
        amountCents: 4120,
        createdAt: new Date(2026, 0, 9),
        founder: { name: 'Chris Daehn', shortName: 'ChrisD' },
      },
    ];
    renderCard();
    const link = screen.getByRole('link', { name: 'SP-2026-0001' });
    expect(link).toHaveAttribute('href', '/expenses/payouts/SP-2026-0001');
    expect(screen.getByText('Chris Daehn')).toBeInTheDocument();
    expect(screen.getByText('41,20 €')).toBeInTheDocument();
    expect(screen.getByText('Freigegeben')).toBeInTheDocument();
  });
});
