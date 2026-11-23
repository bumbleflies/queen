import { describe, it, expect } from 'vitest';
import {
  expenseClaimPosting,
  payoutSettlementPosting,
  PostingError,
  type PostingLine,
  type ExpenseClaimPostingInput,
} from '../postingRules';

function input(over: Partial<ExpenseClaimPostingInput> = {}): ExpenseClaimPostingInput {
  return {
    grossCents: 11900,
    netCents: 10000,
    vatCents: 1900,
    vatRate: 0.19,
    account: '6837',
    liabilityAccount: '3500',
    vatDeductible: true,
    reverseCharge: false,
    ...over,
  };
}

function balanced(lines: PostingLine[]): boolean {
  return lines.reduce((s, l) => s + l.debitCents - l.creditCents, 0) === 0;
}

describe('expenseClaimPosting', () => {
  it('books net + Vorsteuer 19 % against the founder liability', () => {
    expect(expenseClaimPosting(input())).toEqual([
      { account: '1406', debitCents: 1900, creditCents: 0 },
      { account: '3500', debitCents: 0, creditCents: 11900 },
      { account: '6837', debitCents: 10000, creditCents: 0 },
    ]);
  });

  it('books gross only when VAT is not deductible', () => {
    expect(expenseClaimPosting(input({ vatDeductible: false }))).toEqual([
      { account: '3500', debitCents: 0, creditCents: 11900 },
      { account: '6837', debitCents: 11900, creditCents: 0 },
    ]);
  });

  it('books gross only at 0 %', () => {
    expect(
      expenseClaimPosting(input({ vatRate: 0, netCents: 11900, vatCents: 0, vatDeductible: true })),
    ).toEqual([
      { account: '3500', debitCents: 0, creditCents: 11900 },
      { account: '6837', debitCents: 11900, creditCents: 0 },
    ]);
  });

  it('books 7 % Vorsteuer on 1401', () => {
    expect(expenseClaimPosting(input({ vatRate: 0.07, netCents: 10000, vatCents: 700, grossCents: 10700 }))).toEqual([
      { account: '1401', debitCents: 700, creditCents: 0 },
      { account: '3500', debitCents: 0, creditCents: 10700 },
      { account: '6837', debitCents: 10000, creditCents: 0 },
    ]);
  });

  it('books §13b with 1407/3837 at 19 % of gross', () => {
    const lines = expenseClaimPosting(
      input({ vatCents: 0, netCents: 11900, vatDeductible: false, reverseCharge: true }),
    );
    expect(lines).toEqual([
      { account: '1407', debitCents: 2261, creditCents: 0 },
      { account: '3500', debitCents: 0, creditCents: 11900 },
      { account: '3837', debitCents: 0, creditCents: 2261 },
      { account: '6837', debitCents: 11900, creditCents: 0 },
    ]);
    expect(balanced(lines)).toBe(true);
  });

  it('uses the founder liability account it is given', () => {
    const lines = expenseClaimPosting(input({ liabilityAccount: '1700' }));
    expect(lines).toContainEqual({ account: '1700', debitCents: 0, creditCents: 11900 });
    expect(balanced(lines)).toBe(true);
  });

  it('rejects net + VAT ≠ gross', () => {
    expect(() => expenseClaimPosting(input({ netCents: 10000, vatCents: 1700 }))).toThrowError(PostingError);
  });

  it.each([
    ['zero amount', { grossCents: 0 }],
    ['fractional amount', { grossCents: 119.5 }],
    ['unknown rate', { vatRate: 0.16 }],
    ['missing account', { account: '' }],
    ['the bank account', { account: '1800' }],
    ['a liability account without four digits', { liabilityAccount: '350' }],
  ])('rejects %s', (_name, override) => {
    expect(() => expenseClaimPosting(input(override as Partial<ExpenseClaimPostingInput>))).toThrowError(PostingError);
  });

  it('forces 19 % for §13b', () => {
    expect(() =>
      expenseClaimPosting(input({ reverseCharge: true, vatRate: 0.07, netCents: 11900, vatCents: 0 })),
    ).toThrow(/19 %/);
  });
});

describe('payoutSettlementPosting', () => {
  it('settles the liability against the bank', () => {
    expect(payoutSettlementPosting(11900, '3500')).toEqual([
      { account: '1800', debitCents: 0, creditCents: 11900 },
      { account: '3500', debitCents: 11900, creditCents: 0 },
    ]);
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const bad of [0, -1, 1.5]) {
      expect(() => payoutSettlementPosting(bad, '3500')).toThrowError(PostingError);
    }
  });
});
