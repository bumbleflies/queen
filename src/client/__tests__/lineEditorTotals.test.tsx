import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { computeTotals, vatBreakdown, type EditorLine } from '../lib/lineTotals';
import { Money } from '../components/Money';

function line(partial: Partial<EditorLine>): EditorLine {
  return {
    position: '1',
    description: 'Position',
    quantity: 1,
    unitNetEuros: 0,
    vatRate: 0.19,
    ...partial,
  };
}

describe('line editor totals', () => {
  it('computes Netto, VAT and Brutto for the mock invoice', () => {
    const lines = [
      line({ position: '1', unitNetEuros: 2200 }),
      line({ position: '1.1', unitNetEuros: 300 }),
      line({ position: '1.2', unitNetEuros: -100 }),
    ];
    const totals = computeTotals(lines);
    expect(totals.netCents).toBe(240000);
    expect(totals.vatCents).toBe(45600);
    expect(totals.grossCents).toBe(285600);
  });

  it('handles decimal quantities', () => {
    const totals = computeTotals([line({ quantity: 2.5, unitNetEuros: 100 })]);
    expect(totals.netCents).toBe(25000);
    expect(totals.vatCents).toBe(4750);
    expect(totals.grossCents).toBe(29750);
  });

  it('keeps 0 % lines VAT-free and rounds VAT per line (half-up)', () => {
    const totals = computeTotals([
      line({ vatRate: 0, unitNetEuros: 1000 }),
      line({ vatRate: 0.07, unitNetEuros: 101 }),
    ]);
    expect(totals.netCents).toBe(110100);
    // 7 % of 10100 = 707 exactly
    expect(totals.vatCents).toBe(707);
    expect(totals.grossCents).toBe(110807);
  });

  it('sums negative discount lines into the totals', () => {
    const totals = computeTotals([line({ unitNetEuros: -100 })]);
    expect(totals.netCents).toBe(-10000);
    expect(totals.vatCents).toBe(-1900);
    expect(totals.grossCents).toBe(-11900);
  });

  it('breaks VAT down per rate, highest first', () => {
    const buckets = vatBreakdown([
      line({ unitNetEuros: 1000, vatRate: 0.19 }),
      line({ unitNetEuros: 500, vatRate: 0 }),
      line({ unitNetEuros: 200, vatRate: 0.19 }),
    ]);
    expect(buckets.map((b) => b.rate)).toEqual([0.19, 0]);
    expect(buckets[0].netCents).toBe(120000);
    expect(buckets[0].vatCents).toBe(22800);
    expect(buckets[1].netCents).toBe(50000);
    expect(buckets[1].vatCents).toBe(0);
  });

  it('renders the computed Brutto through the Money component', () => {
    const totals = computeTotals([
      line({ unitNetEuros: 2200 }),
      line({ unitNetEuros: 300 }),
      line({ unitNetEuros: -100 }),
    ]);
    render(<Money cents={totals.grossCents} />);
    expect(screen.getByText('2.856,00 €')).toBeInTheDocument();
  });
});
