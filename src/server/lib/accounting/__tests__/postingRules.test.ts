import { describe, it, expect } from 'vitest';
import {
  invoicePosting,
  paymentPosting,
  reversalLines,
  PostingError,
  type PostingLine,
} from '../postingRules';

function sums(lines: PostingLine[]) {
  return lines.reduce(
    (s, l) => ({ debit: s.debit + l.debitCents, credit: s.credit + l.creditCents }),
    { debit: 0, credit: 0 },
  );
}

describe('invoicePosting', () => {
  it('19 % single line → 1200 / 4400 + 3806', () => {
    expect(invoicePosting([{ quantity: 1, unitNetCents: 10000, vatRate: 0.19 }])).toEqual([
      { account: '1200', debitCents: 11900, creditCents: 0 },
      { account: '3806', debitCents: 0, creditCents: 1900 },
      { account: '4400', debitCents: 0, creditCents: 10000 },
    ]);
  });

  it('mixed rates split revenue and USt per rate; 0 % has no USt line', () => {
    const lines = invoicePosting([
      { quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
      { quantity: 2, unitNetCents: 2500, vatRate: 0 },
      { quantity: 1, unitNetCents: 1000, vatRate: 0.07 },
    ]);
    expect(lines).toEqual([
      { account: '1200', debitCents: 17970, creditCents: 0 },
      { account: '3801', debitCents: 0, creditCents: 70 },
      { account: '3806', debitCents: 0, creditCents: 1900 },
      { account: '4110', debitCents: 0, creditCents: 5000 },
      { account: '4300', debitCents: 0, creditCents: 1000 },
      { account: '4400', debitCents: 0, creditCents: 10000 },
    ]);
    const s = sums(lines);
    expect(s.debit).toBe(s.credit);
  });

  it('discount lines net per account with per-line VAT rounding', () => {
    expect(
      invoicePosting([
        { quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
        { quantity: 1, unitNetCents: -2500, vatRate: 0.19 },
      ]),
    ).toEqual([
      { account: '1200', debitCents: 8925, creditCents: 0 },
      { account: '3806', debitCents: 0, creditCents: 1425 },
      { account: '4400', debitCents: 0, creditCents: 7500 },
    ]);
  });

  it('negate mirrors the original exactly (credit note, no 1-cent drift)', () => {
    // 0.5 × 333 = 166.5 → 167 net; VAT 31.73 → 32. Negating the *lines* would round differently.
    const original = [{ quantity: 0.5, unitNetCents: 333, vatRate: 0.19 }];
    const posted = invoicePosting(original);
    const mirrored = invoicePosting(original, { negate: true });
    expect(mirrored).toEqual(reversalLines(posted));
  });

  it('rejects unknown VAT rates', () => {
    expect(() => invoicePosting([{ quantity: 1, unitNetCents: 100, vatRate: 0.16 }])).toThrowError(
      PostingError,
    );
  });
});

describe('paymentPosting', () => {
  it('Bank an Forderungen', () => {
    expect(paymentPosting(11900)).toEqual([
      { account: '1800', debitCents: 11900, creditCents: 0 },
      { account: '1200', debitCents: 0, creditCents: 11900 },
    ]);
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const bad of [0, -1, 1.5]) expect(() => paymentPosting(bad)).toThrowError(PostingError);
  });
});

describe('reversalLines', () => {
  it('swaps debit and credit', () => {
    expect(reversalLines([{ account: '1800', debitCents: 5, creditCents: 0 }])).toEqual([
      { account: '1800', debitCents: 0, creditCents: 5 },
    ]);
  });
});
