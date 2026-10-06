import { describe, it, expect } from 'vitest';
import {
  parseGermanAmount,
  fireflyAmountToCents,
  lineNetCents,
  lineVatCents,
  invoiceTotals,
  formatGermanEUR,
} from '../money';

describe('parseGermanAmount', () => {
  it('parses thousands + euro symbol', () => {
    expect(parseGermanAmount('1.600,00 €')).toBe(160000);
  });
  it('parses negative amount', () => {
    expect(parseGermanAmount('-100,00 €')).toBe(-10000);
  });
  it('parses one-decimal without currency', () => {
    expect(parseGermanAmount('9329,6')).toBe(932960);
  });
  it('parses plain ints as euros', () => {
    expect(parseGermanAmount('900')).toBe(90000);
  });
  it('parses without thousands separator', () => {
    expect(parseGermanAmount('18,00')).toBe(1800);
  });
  it('throws on unparseable input', () => {
    expect(() => parseGermanAmount('abc')).toThrow();
    expect(() => parseGermanAmount('')).toThrow();
  });
});

describe('fireflyAmountToCents', () => {
  it('parses Firefly decimal strings ("." decimal, no thousands separators)', () => {
    expect(fireflyAmountToCents('1071.00')).toBe(107100);
    expect(fireflyAmountToCents('-12.34')).toBe(-1234);
    expect(fireflyAmountToCents('0')).toBe(0);
    expect(fireflyAmountToCents('9329.6')).toBe(932960);
  });
  it('throws on unparseable input (incl. German thousands separators)', () => {
    expect(() => fireflyAmountToCents('1.600,00')).toThrow();
    expect(() => fireflyAmountToCents('abc')).toThrow();
    expect(() => fireflyAmountToCents('')).toThrow();
  });
});

describe('lineNetCents', () => {
  it('multiplies quantity by unit net (decimal qty allowed)', () => {
    expect(lineNetCents(2, 100)).toBe(200);
    expect(lineNetCents(1.5, 100)).toBe(150);
  });
});

describe('lineVatCents', () => {
  it('rounds per-line VAT half-up', () => {
    expect(lineVatCents(100, 0.19)).toBe(19);
    // 10 cents * 19% = 1.9 → half-up → 2
    expect(lineVatCents(10, 0.19)).toBe(2);
  });
  it('0% rate yields 0 VAT', () => {
    expect(lineVatCents(12345, 0)).toBe(0);
  });
});

describe('invoiceTotals (invoice 20230511-01 fixture)', () => {
  const lines = [
    { quantity: 1, unitNetCents: 280000, vatRate: 0.19 },
    { quantity: 1, unitNetCents: 40000, vatRate: 0.19 },
    { quantity: 1, unitNetCents: -10000, vatRate: 0.19 },
    { quantity: 1, unitNetCents: 90000, vatRate: 0.19 },
    { quantity: 1, unitNetCents: 90000, vatRate: 0.19 },
    { quantity: 1, unitNetCents: -18000, vatRate: 0.19 },
  ];
  it('sums net/VAT/gross with per-line rounded VAT', () => {
    expect(invoiceTotals(lines)).toEqual({ netCents: 472000, vatCents: 89680, grossCents: 561680 });
  });
  it('rate-0 line contributes 0 VAT', () => {
    const totals = invoiceTotals([{ quantity: 1, unitNetCents: 5000, vatRate: 0 }]);
    expect(totals).toEqual({ netCents: 5000, vatCents: 0, grossCents: 5000 });
  });
  it('0% line keeps vatNote and contributes 0 VAT', () => {
    const vatNote = '§ 4 Nr. 21 a) bb) UStG steuerbefreit';
    const lines = [{ quantity: 1, unitNetCents: 5000, vatRate: 0, vatNote }];
    const totals = invoiceTotals(lines);
    expect(totals).toEqual({ netCents: 5000, vatCents: 0, grossCents: 5000 });
    // passthrough: totals() reads only quantity/unitNetCents/vatRate —
    // the note survives untouched on the caller's object.
    expect(lines[0].vatNote).toBe(vatNote);
  });
});

describe('formatGermanEUR', () => {
  it('formats de-DE with euro sign', () => {
    expect(formatGermanEUR(485520)).toBe('4.855,20 €');
  });
});
