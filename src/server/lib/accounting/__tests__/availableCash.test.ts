import { describe, it, expect } from 'vitest';
import { computeAvailableCash } from '../availableCash';

const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe('computeAvailableCash', () => {
  it('subtracts VAT payable', () => {
    const b = m({ '3806': -1900, '1406': 300 });
    const r = computeAvailableCash({ bankCents: 10000, balances: b, currentYearBalances: m({}), taxRate: 0.33 });
    expect(r.vatCents).toBe(1600);
    expect(r.availableCents).toBe(8400);
  });

  it('does not add a VAT refund claim', () => {
    const r = computeAvailableCash({
      bankCents: 10000,
      balances: m({ '1406': 500 }),
      currentYearBalances: m({}),
      taxRate: 0.33,
    });
    expect(r.vatCents).toBe(0);
    expect(r.availableCents).toBe(10000);
  });

  it('estimates tax on profit and nets prepayments', () => {
    const cy = m({ '4400': -100000, '6837': 20000, '7610': 5000 });
    const r = computeAvailableCash({ bankCents: 100000, balances: cy, currentYearBalances: cy, taxRate: 0.33 });
    expect(r.profitCents).toBe(80000);
    expect(r.estimatedTaxCents).toBe(21400);
    expect(r.taxRate).toBe(0.33);
  });

  it('floors the estimate at 0', () => {
    const cy = m({ '4400': -10000, '6837': 20000 });
    const r = computeAvailableCash({ bankCents: 1000, balances: cy, currentYearBalances: cy, taxRate: 0.33 });
    expect(r.profitCents).toBe(-10000);
    expect(r.estimatedTaxCents).toBe(0);
  });

  it('liabilities and provisions', () => {
    const r = computeAvailableCash({
      bankCents: 50000,
      balances: m({ '3500': -21800, '3040': -2100 }),
      currentYearBalances: m({}),
      taxRate: 0.33,
    });
    expect(r.liabilitiesCents).toBe(21800);
    expect(r.provisionsCents).toBe(2100);
    expect(r.availableCents).toBe(26100);
  });
});
