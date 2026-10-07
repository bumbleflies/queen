import { describe, it, expect } from 'vitest';
import { parseReference } from '../lib/reference';

describe('parseReference', () => {
  it('parses customer-invoice references', () => {
    expect(parseReference('10009-20260829-01')).toEqual({
      customerNumber: 10009,
      invoiceNumber: '20260829-01',
    });
  });

  it('parses labeled RNR/KD references in either order', () => {
    expect(
      parseReference('RNR 20260901-01 KD 10015 Datum 01.09.2026 Kto. 80691 EREF: 4625376385-0000014'),
    ).toEqual({ customerNumber: 10015, invoiceNumber: '20260901-01' });
    expect(parseReference('10007-20260529-02 ABWA: American Football Verband B')).toEqual({
      customerNumber: 10007,
      invoiceNumber: '20260529-02',
    });
  });

  it('does not mistake Kto. for a customer number', () => {
    expect(parseReference('RNR 20260901-01 Kto. 80691')).toEqual({
      customerNumber: null,
      invoiceNumber: '20260901-01',
    });
  });

  it('returns null when no reference is present', () => {
    expect(parseReference('Gebühr Kontoführung')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});
