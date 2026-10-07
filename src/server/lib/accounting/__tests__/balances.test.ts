import { describe, it, expect } from 'vitest';
import { trialBalance, accountLedger } from '../balances';

const e = (
  id: string,
  entryNumber: string,
  date: Date,
  lines: [string, number, number][],
) => ({
  _id: id,
  entryNumber,
  date,
  text: entryNumber,
  lines: lines.map(([account, debitCents, creditCents]) => ({ account, debitCents, creditCents })),
});

const entries = [
  e('b', '2026-00002', new Date(2026, 1, 1), [
    ['1800', 500, 0],
    ['1200', 0, 500],
  ]),
  e('a', '2026-00001', new Date(2026, 0, 15), [
    ['1200', 1190, 0],
    ['4400', 0, 1000],
    ['3806', 0, 190],
  ]),
];

describe('trialBalance', () => {
  it('sums per account, sorted, totals balance', () => {
    const tb = trialBalance(entries);
    expect(tb.rows).toEqual([
      { account: '1200', debitCents: 1190, creditCents: 500, balanceCents: 690 },
      { account: '1800', debitCents: 500, creditCents: 0, balanceCents: 500 },
      { account: '3806', debitCents: 0, creditCents: 190, balanceCents: -190 },
      { account: '4400', debitCents: 0, creditCents: 1000, balanceCents: -1000 },
    ]);
    expect(tb.debitCents).toBe(1690);
    expect(tb.creditCents).toBe(1690);
  });

  it('empty journal → no rows, zero totals', () => {
    expect(trialBalance([])).toEqual({ rows: [], debitCents: 0, creditCents: 0 });
  });
});

describe('accountLedger', () => {
  it('orders by date then number with a running balance', () => {
    expect(accountLedger('1200', entries)).toEqual([
      {
        entryId: 'a',
        entryNumber: '2026-00001',
        date: new Date(2026, 0, 15),
        text: '2026-00001',
        debitCents: 1190,
        creditCents: 0,
        runningCents: 1190,
      },
      {
        entryId: 'b',
        entryNumber: '2026-00002',
        date: new Date(2026, 1, 1),
        text: '2026-00002',
        debitCents: 0,
        creditCents: 500,
        runningCents: 690,
      },
    ]);
  });

  it('sums several lines of one entry on the same account', () => {
    const rows = accountLedger('1800', [
      e('c', '2026-00003', new Date(2026, 2, 1), [
        ['1800', 100, 0],
        ['1800', 50, 0],
        ['1200', 0, 150],
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ debitCents: 150, creditCents: 0, runningCents: 150 });
  });
});
