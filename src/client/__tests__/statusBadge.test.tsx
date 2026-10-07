import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBadge } from '../components/StatusBadge';
import { derivedStatus, startOfToday } from '../lib/format';

function daysAgo(days: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - days);
  return d;
}

describe('StatusBadge', () => {
  it('renders an overdue badge with the day count', () => {
    render(<StatusBadge invoice={{ status: 'sent', dueDate: daysAgo(8) }} />);
    const badge = screen.getByText('überfällig · 8 T');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('b-over');
  });

  it('renders a draft badge', () => {
    render(<StatusBadge invoice={{ status: 'draft' }} />);
    expect(screen.getByText('Entwurf')).toHaveClass('b-draft');
  });

  it('renders a paid badge', () => {
    render(<StatusBadge invoice={{ status: 'paid' }} />);
    expect(screen.getByText('bezahlt')).toHaveClass('b-paid');
  });

  it('renders a Stornorechnung badge for credit notes', () => {
    render(<StatusBadge invoice={{ status: 'sent', kind: 'credit_note' }} />);
    expect(screen.getByText('Stornorechnung')).toHaveClass('b-credit');
  });

  it('renders a teilbezahlt badge for partial payments', () => {
    render(
      <StatusBadge
        invoice={{ status: 'sent', dueDate: new Date(2030, 0, 1), payments: [{ amountCents: 1 }] }}
      />,
    );
    expect(screen.getByText('teilbezahlt')).toHaveClass('b-part');
  });

  it('derivedStatus returns the sent label when not due and unpaid', () => {
    const status = derivedStatus({ status: 'sent', dueDate: new Date(2030, 0, 1) });
    expect(status.key).toBe('sent');
    expect(status.label).toBe('ausgestellt');
  });
});
