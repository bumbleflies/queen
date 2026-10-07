import { describe, expect, it } from 'vitest';
import {
  derivedStatus,
  formatDate,
  formatEUR,
  matchesChip,
  overdueDays,
  type InvoiceLike,
} from '../lib/format';

describe('formatEUR', () => {
  it('formats integer cents in de-DE with thousands grouping', () => {
    expect(formatEUR(160000)).toBe('1.600,00\u00A0€');
    expect(formatEUR(0)).toBe('0,00\u00A0€');
    expect(formatEUR(932960)).toBe('9.329,60\u00A0€');
  });

  it('formats negative amounts (discount lines / credit notes)', () => {
    expect(formatEUR(-107100)).toBe('-1.071,00\u00A0€');
  });
});

describe('formatDate', () => {
  it('renders DD.MM.YYYY and an em dash when absent', () => {
    expect(formatDate('2026-09-15T00:00:00.000Z')).toMatch(/\d{2}\.\d{2}\.2026/);
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});

const TODAY = new Date(2026, 9, 6); // 06.10.2026

describe('derivedStatus', () => {
  it('maps the stored statuses', () => {
    expect(derivedStatus({ status: 'draft' }, TODAY).key).toBe('draft');
    expect(derivedStatus({ status: 'paid' }, TODAY).key).toBe('paid');
    expect(derivedStatus({ status: 'canceled' }, TODAY).key).toBe('canceled');
    expect(derivedStatus({ status: 'sent' }, TODAY).key).toBe('sent');
  });

  it('computes überfällig from dueDate < today', () => {
    const inv: InvoiceLike = { status: 'sent', dueDate: new Date(2026, 8, 28) };
    const status = derivedStatus(inv, TODAY);
    expect(status.key).toBe('overdue');
    expect(status.cls).toBe('b-over');
    expect(status.label).toBe('überfällig · 8 T');
    expect(overdueDays(inv, TODAY)).toBe(8);
  });

  it('marks sent invoices with payments as teilbezahlt', () => {
    const inv: InvoiceLike = {
      status: 'sent',
      dueDate: new Date(2026, 10, 1),
      payments: [{ amountCents: 19000 }],
    };
    expect(derivedStatus(inv, TODAY).key).toBe('partial');
  });

  it('prefers überfällig over teilbezahlt', () => {
    const inv: InvoiceLike = {
      status: 'sent',
      dueDate: new Date(2026, 8, 1),
      payments: [{ amountCents: 19000 }],
    };
    expect(derivedStatus(inv, TODAY).key).toBe('overdue');
  });

  it('treats credit notes as Stornorechnung regardless of stored status', () => {
    const inv: InvoiceLike = { status: 'sent', kind: 'credit_note' };
    const status = derivedStatus(inv, TODAY);
    expect(status.key).toBe('credit_note');
    expect(status.label).toBe('Stornorechnung');
    expect(status.cls).toBe('b-credit');
  });
});

describe('matchesChip', () => {
  const overdue: InvoiceLike = { status: 'sent', dueDate: new Date(2026, 8, 1) };
  const sent: InvoiceLike = { status: 'sent', dueDate: new Date(2026, 10, 1) };
  const credit: InvoiceLike = { status: 'sent', kind: 'credit_note' };
  const canceled: InvoiceLike = { status: 'canceled' };

  it('Ausgestellt includes overdue invoices', () => {
    expect(matchesChip(overdue, 'sent', TODAY)).toBe(true);
    expect(matchesChip(sent, 'sent', TODAY)).toBe(true);
  });

  it('Storniert matches canceled invoices and credit notes', () => {
    expect(matchesChip(credit, 'cancel', TODAY)).toBe(true);
    expect(matchesChip(canceled, 'cancel', TODAY)).toBe(true);
    expect(matchesChip(sent, 'cancel', TODAY)).toBe(false);
  });
});
