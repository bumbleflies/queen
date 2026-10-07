import { describe, expect, it } from 'vitest';
import {
  agingBuckets,
  daysUntil,
  dueWithin,
  expectedByMonth,
  groupByDue,
  overdueByClient,
  relativeDays,
  type OpenItem,
} from '../lib/dashboard';

const today = new Date(2026, 9, 7); // 07.10.2026

function item(over: Partial<OpenItem>): OpenItem {
  return {
    id: 'x',
    invoiceNumber: '20260101-01',
    kind: 'invoice',
    customerNumber: 10001,
    clientId: 'c1',
    clientName: 'Kunde A',
    title: 'Leistung',
    dueDate: null,
    paidCents: 0,
    openCents: 10000,
    overdue: false,
    daysOverdue: 0,
    ...over,
  };
}

const items: OpenItem[] = [
  item({ id: 'a', overdue: true, daysOverdue: 636, openCents: 38000, dueDate: new Date(2025, 0, 8) }),
  item({ id: 'b', overdue: true, daysOverdue: 86, openCents: 57000, dueDate: new Date(2026, 6, 12) }),
  item({ id: 'c', clientId: 'c2', clientName: 'Kunde B', openCents: 21420, dueDate: new Date(2026, 9, 31) }),
  item({ id: 'd', clientId: 'c3', clientName: 'Kunde C', openCents: 21420, dueDate: new Date(2026, 9, 31) }),
  item({ id: 'e', clientId: 'c3', clientName: 'Kunde C', openCents: 5000, dueDate: new Date(2026, 11, 20) }),
];

describe('dashboard helpers', () => {
  it('daysUntil counts whole calendar days', () => {
    expect(daysUntil(new Date(2026, 9, 31, 15), today)).toBe(24);
    expect(daysUntil(new Date(2026, 9, 7), today)).toBe(0);
    expect(daysUntil(null, today)).toBeNull();
  });

  it('agingBuckets splits open amounts by days past due', () => {
    const b = Object.fromEntries(agingBuckets(items).map((x) => [x.key, x.cents]));
    expect(b).toEqual({ due: 47840, '30': 0, '90': 57000, '365': 0, old: 38000 });
  });

  it('expectedByMonth sums not-overdue amounts by due month', () => {
    const m = expectedByMonth(items, 3, today).map((x) => x.cents);
    expect(m).toEqual([42840, 0, 5000]);
  });

  it('dueWithin returns only not-overdue items due inside the window', () => {
    expect(dueWithin(items, 30, today).map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('overdueByClient groups overdue items per client', () => {
    const g = overdueByClient(items);
    expect(g).toHaveLength(1);
    expect(g[0].cents).toBe(95000);
    expect(g[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('groupByDue puts overdue first, then one group per due date', () => {
    const g = groupByDue(items);
    expect(g.map((x) => [x.tone, x.items.length, x.cents])).toEqual([
      ['over', 2, 95000],
      ['due', 2, 42840],
      ['due', 1, 5000],
    ]);
  });

  it('relativeDays reads naturally', () => {
    expect(relativeDays(0)).toBe('heute');
    expect(relativeDays(1)).toBe('morgen');
    expect(relativeDays(24)).toBe('in 24 Tagen');
    expect(relativeDays(-3)).toBe('vor 3 Tagen');
  });
});
