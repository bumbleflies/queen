import { describe, it, expect } from 'vitest';
import { isAutoBookable } from '../autoBook';
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
