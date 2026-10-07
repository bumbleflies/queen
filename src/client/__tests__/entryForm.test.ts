import { describe, it, expect } from 'vitest';
import { toEntryLines } from '../lib/entryForm';

describe('toEntryLines', () => {
  it('parses German amounts and totals both sides', () => {
    const r = toEntryLines([
      { account: '1800', debit: '1.234,50', credit: '' },
      { account: '2900', debit: '', credit: '1234,5' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { account: '1800', debitCents: 123450, creditCents: 0 },
      { account: '2900', debitCents: 0, creditCents: 123450 },
    ]);
    expect(r.debitCents).toBe(123450);
    expect(r.creditCents).toBe(123450);
  });

  it('skips blank rows', () => {
    const r = toEntryLines([{ account: '', debit: '', credit: '' }]);
    expect(r).toEqual({ lines: [], debitCents: 0, creditCents: 0, errors: [] });
  });

  it('reports rows with both sides, no side, bad amounts or no account', () => {
    const r = toEntryLines([
      { account: '1800', debit: '1', credit: '1' },
      { account: '1800', debit: '', credit: '' },
      { account: '1800', debit: 'abc', credit: '' },
      { account: '', debit: '5', credit: '' },
    ]);
    expect(r.errors).toEqual([
      'Zeile 1: entweder Soll oder Haben',
      'Zeile 2: Betrag fehlt',
      'Zeile 3: Betrag „abc“ ungültig',
      'Zeile 4: Konto fehlt',
    ]);
  });

  it('rejects a zero amount', () => {
    const r = toEntryLines([{ account: '1800', debit: '0', credit: '' }]);
    expect(r.errors).toEqual(['Zeile 1: Betrag muss positiv sein']);
  });
});
