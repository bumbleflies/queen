import { describe, it, expect } from 'vitest';
import { periodOf, isAddressedToCompany, parseExpenseText, isConfidentClaim, claimFieldsOf } from '../claimFields';

describe('claim helpers', () => {
  it('derives the period from the receipt date', () => {
    expect(periodOf(new Date(2026, 0, 31))).toBe('2026-01');
  });

  it('recognises bumbleflies as the invoice recipient', () => {
    expect(isAddressedToCompany('Rechnung an bumbleflies UG (haftungsbeschränkt)')).toBe(true);
    expect(isAddressedToCompany('Rechnung an Test Person, privat')).toBe(false);
  });

  it('parses a claim and marks who it is addressed to', () => {
    const claim = parseExpenseText('bumbleflies UG\nBahn AG\nGesamt 41,20 EUR\n19 % USt 6,58 EUR', { fromName: 'Bahn' });
    expect(claim.grossCents).toBe(4120);
    expect(claim.addressedToCompany).toBe(true);
    expect(claim.currency).toBe('EUR');
  });

  it('queues a claim addressed to a private person when VAT is stated', () => {
    const claim = parseExpenseText('Test Person\nHotel 119,00 EUR\n19 % USt 19,00 EUR', { fromName: 'Hotel' });
    const result = isConfidentClaim({
      parse: claim,
      founderActive: true,
      account: '6640',
      accountExists: true,
      limitCents: 20000,
      yearClosed: false,
      duplicate: false,
      reverseChargeNeedsCompany: claim.reverseCharge,
    });
    // VAT not deductible, but gross-only booking is safe and still confident
    expect(result.ok).toBe(true);
    expect(result.vatDeductible).toBe(false);
  });

  it('rejects above the limit, closed years, unknown accounts and duplicates', () => {
    const parse = parseExpenseText('bumbleflies UG\nHetzner 250,00 EUR\n19 % USt 39,92 EUR', { fromName: 'Hetzner' });
    const base = { parse, founderActive: true, account: '6837', accountExists: true, limitCents: 30000, yearClosed: false, duplicate: false };
    expect(isConfidentClaim({ ...base, limitCents: 24999 }).ok).toBe(false);
    expect(isConfidentClaim({ ...base, yearClosed: true }).ok).toBe(false);
    expect(isConfidentClaim({ ...base, accountExists: false }).ok).toBe(false);
    expect(isConfidentClaim({ ...base, duplicate: true }).ok).toBe(false);
  });

  it('lets a correction win field by field, including clearing a value', () => {
    const parse = parseExpenseText('bumbleflies UG\nHetzner 119,00 EUR', { fromName: 'Hetzner' });
    const merged = claimFieldsOf({
      parse,
      corrected: { grossCents: 12100, vatCents: null as never },
    });
    expect(merged?.grossCents).toBe(12100);
    expect(merged?.vatCents).toBeNull();
    expect(merged?.vendorName).toBe(parse.vendorName);
  });

  it('unwraps Mongoose subdocuments (correct() passes documents, list() lean objects)', () => {
    const merged = claimFieldsOf({
      parse: { toObject: () => ({ vendorName: 'Bahn', invoiceNumber: 'R-1', grossCents: 4120 }) } as never,
      corrected: { toObject: () => ({ grossCents: 4500, vatCents: null }) } as never,
    });
    expect(merged?.vendorName).toBe('Bahn');
    expect(merged?.invoiceNumber).toBe('R-1');
    expect(merged?.grossCents).toBe(4500);
    expect(merged?.vatCents).toBeNull();
  });

  it('marks a foreign-currency receipt as not confident', () => {
    const parse = parseExpenseText('bumbleflies UG\nHetzner 12.00 USD', { fromName: 'Hetzner' });
    expect(parse.currency).toBe('other');
    const result = isConfidentClaim({
      parse,
      founderActive: true,
      account: '6837',
      accountExists: true,
      limitCents: 10000,
      yearClosed: false,
      duplicate: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('Fremdwährung');
  });
});
