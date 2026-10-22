import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersSection } from '../UsersSection';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../Toast';

const inviteMutation = vi.fn(async () => ({
  id: 'u1',
  url: 'https://queen.example.de/invite#abc',
  expiresAt: '2026-10-29T10:00:00.000Z',
  ttlHours: 168,
}));

vi.mock('../../lib/trpc', () => {
  const users = {
    list: {
      useQuery: () => ({
        data: [
          {
            id: 'u1',
            email: 'steuer@example.de',
            role: 'user',
            disabled: false,
            lastLoginAt: null,
            inviteExpiresAt: null,
            hasGoogle: false,
            hasDrive: false,
          },
        ],
        isLoading: false,
        isError: false,
        error: null,
      }),
    },
    invite: { useMutation: () => ({ mutateAsync: inviteMutation, isPending: false }) },
    revokeInvite: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    setRole: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    setDisabled: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
  };
  return {
    trpc: {
      useUtils: () => ({ users: { list: { invalidate: vi.fn() } } }),
      users,
    },
  };
});

function renderSection() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <UsersSection />
      </ToastProvider>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  inviteMutation.mockClear();
});

describe('UsersSection', () => {
  it('lists users with their state', () => {
    renderSection();
    expect(screen.getByText('steuer@example.de')).toBeInTheDocument();
    expect(screen.getByText('Nie')).toBeInTheDocument();
  });

  it('shows the generated link once after inviting', async () => {
    renderSection();
    await userEvent.type(screen.getByLabelText('E-Mail'), 'neu@example.de');
    await userEvent.click(screen.getByRole('button', { name: 'Einladen' }));
    expect(inviteMutation).toHaveBeenCalledWith({ email: 'neu@example.de', role: 'user' });
    expect(await screen.findByDisplayValue('https://queen.example.de/invite#abc')).toBeInTheDocument();
    expect(screen.getByText(/29\.10\.2026|29\/10\/2026|10\/29\/2026/)).toBeInTheDocument();
  });

  it('keeps the invite button disabled for an invalid address', async () => {
    renderSection();
    await userEvent.type(screen.getByLabelText('E-Mail'), 'nope');
    expect(screen.getByRole('button', { name: 'Einladen' })).toBeDisabled();
  });
});
