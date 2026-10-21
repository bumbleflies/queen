import { describe, it, expect } from 'vitest';
import { isAutoBookable, isConcurrentBookingError } from '../autoBook';
import { BookingError } from '../bankBooking';
import { LedgerError } from '../ledger';
import type { Suggestion } from '../suggest';

const iban: Suggestion = { supplierName: 'Hoster', matchedBy: 'iban', account: '6837', vatRate: 0.19, mode: 'normal' };
const flagged = { autoBook: true };

describe('isAutoBookable', () => {
  it('is true for an IBAN match of a flagged rule with account and VAT rate', () => {
    expect(isAutoBookable(iban, flagged)).toBe(true);
  });

  it('is true for a Verwendungszweck match', () => {
    expect(isAutoBookable({ ...iban, matchedBy: 'purpose' }, flagged)).toBe(true);
  });

  it('is false for a name match', () => {
    expect(isAutoBookable({ ...iban, matchedBy: 'name' }, flagged)).toBe(false);
  });

  it('is false for a history suggestion', () => {
    expect(isAutoBookable({ ...iban, matchedBy: 'history' }, flagged)).toBe(false);
  });

  it('is false for a receipt reading, even with a flagged supplier', () => {
    expect(isAutoBookable({ ...iban, matchedBy: 'receipt' }, flagged)).toBe(false);
  });

  it('is false without the flag', () => {
    expect(isAutoBookable(iban, { autoBook: false })).toBe(false);
    expect(isAutoBookable(iban, {})).toBe(false);
    expect(isAutoBookable(iban, null)).toBe(false);
  });

  it('is false without a suggestion', () => {
    expect(isAutoBookable(null, flagged)).toBe(false);
  });

  it('is false for mode normal without an account', () => {
    expect(isAutoBookable({ ...iban, account: undefined }, flagged)).toBe(false);
  });

  it('is false without a VAT rate', () => {
    expect(isAutoBookable({ ...iban, vatRate: undefined }, flagged)).toBe(false);
  });

  it('is true for vatOnly without an account', () => {
    expect(isAutoBookable({ ...iban, account: undefined, mode: 'vatOnly' }, flagged)).toBe(true);
  });
});

describe('isConcurrentBookingError', () => {
  it('treats already booked, matched and duplicate postings as skips', () => {
    expect(isConcurrentBookingError(new BookingError('ALREADY_BOOKED', 'x'))).toBe(true);
    expect(isConcurrentBookingError(new BookingError('MATCHED', 'x'))).toBe(true);
    expect(isConcurrentBookingError(new LedgerError('DUPLICATE', 'x'))).toBe(true);
  });

  it('counts everything else as a failure', () => {
    expect(isConcurrentBookingError(new LedgerError('UNKNOWN_ACCOUNT', 'x'))).toBe(false);
    expect(isConcurrentBookingError(new LedgerError('YEAR_CLOSED', 'x'))).toBe(false);
    expect(isConcurrentBookingError(new BookingError('NOT_FOUND', 'x'))).toBe(false);
    expect(isConcurrentBookingError(new Error('boom'))).toBe(false);
  });
});
