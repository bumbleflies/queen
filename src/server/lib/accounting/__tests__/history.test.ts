import { describe, it, expect } from 'vitest';
import { deriveBooking, historyKey, historySuggestion, type BookingHistory } from '../history';

const l = (account: string, debitCents: number, creditCents = 0) => ({ account, debitCents, creditCents });

describe('deriveBooking', () => {
  it('normal 19 %', () => {
    expect(deriveBooking([l('6837', 10000), l('1406', 1900), l('1800', 0, 11900)])).toEqual({ account: '6837', vatRate: 0.19, mode: 'normal' });
  });
  it('vatOnly', () => {
    expect(deriveBooking([l('1406', 824), l('1800', 0, 824)])).toEqual({ account: '', vatRate: 0.19, mode: 'vatOnly' });
  });
  it('reverseCharge', () => {
    expect(deriveBooking([l('6837', 10000), l('1407', 1900), l('1800', 0, 10000), l('3837', 0, 1900)])).toEqual({
      account: '6837',
      vatRate: 0.19,
      mode: 'reverseCharge',
    });
  });
  it('0 %', () => {
    expect(deriveBooking([l('7610', 500), l('1800', 0, 500)])).toEqual({ account: '7610', vatRate: 0, mode: 'normal' });
  });
});

describe('deriveBooking split', () => {
  it('returns null for two expense lines', () => {
    expect(deriveBooking([l('6640', 3000), l('6805', 1891), l('1401', 210), l('1406', 359), l('1800', 0, 5460)])).toBeNull();
  });
  it('returns null for one account with two VAT rates', () => {
    expect(deriveBooking([l('6640', 4891), l('1401', 210), l('1406', 359), l('1800', 0, 5460)])).toBeNull();
  });
});

describe('deriveBooking merged splits', () => {
  it('0 % + 19 % on the same account is not a single booking', () => {
    expect(deriveBooking([l('6640', 5000), l('1406', 190), l('1800', 0, 5190)])).toBeNull();
  });
  it('normal + reverseCharge on the same account is not a single booking', () => {
    expect(deriveBooking([l('6640', 20000), l('1406', 1900), l('1407', 1900), l('1800', 0, 21900), l('3837', 0, 1900)])).toBeNull();
    expect(deriveBooking([l('6640', 20000), l('1407', 3800), l('1800', 0, 20000), l('3837', 0, 3800)])).toEqual({
      account: '6640',
      vatRate: 0.19,
      mode: 'reverseCharge',
    });
  });
});

describe('historyKey', () => {
  it('ignores placeholder names and normalises IBANs', () => {
    expect(historyKey({ counterpartyName: '(unknown destination)', direction: 'out' })).toBeNull();
    expect(historyKey({ counterpartyName: '  ', direction: 'out' })).toBeNull();
    expect(historyKey({ counterpartyIban: 'de02 1203 0000 0000 2020 51', direction: 'out' })).toBe('out:iban:DE02120300000000202051');
    expect(historyKey({ counterpartyName: ' Hoster  GmbH ', direction: 'in' })).toBe('in:name:hoster gmbh');
  });
  it('keeps directions apart (a missing direction is incoming, like the model default)', () => {
    expect(historyKey({ counterpartyName: 'Hoster', direction: 'out' })).not.toBe(historyKey({ counterpartyName: 'Hoster', direction: 'in' }));
    expect(historyKey({ counterpartyName: 'Hoster' })).toBe('in:name:hoster');
  });
});

describe('historySuggestion', () => {
  const tx = { counterpartyName: 'Hoster', counterpartyIban: null, description: 'x', direction: 'out' };
  const e = (account: string, day: number) => ({ account, vatRate: 0.19, mode: 'normal' as const, date: new Date(2026, 0, day) });

  it('requires agreement', () => {
    const disagree: BookingHistory = new Map([['out:name:hoster', [e('6837', 3), e('6837', 2), e('6640', 1)]]]);
    expect(historySuggestion(tx, disagree)).toBeNull();
    const agree: BookingHistory = new Map([['out:name:hoster', [e('6837', 3), e('6837', 2), e('6837', 1)]]]);
    expect(historySuggestion(tx, agree)).toMatchObject({
      matchedBy: 'history',
      account: '6837',
      supplierName: 'Hoster',
      lastBookedAt: new Date(2026, 0, 3),
    });
  });
  it('returns null without history', () => {
    expect(historySuggestion(tx, new Map())).toBeNull();
  });
  it('never applies an outgoing booking to an incoming transaction', () => {
    const iban = 'DE02120300000000202051';
    const booked: BookingHistory = new Map([[`out:iban:${iban}`, [e('6837', 3)]]]);
    expect(historySuggestion({ ...tx, counterpartyIban: iban, direction: 'in' }, booked)).toBeNull();
    expect(historySuggestion({ ...tx, counterpartyIban: iban, direction: 'out' }, booked)).toMatchObject({ account: '6837' });
  });
});
