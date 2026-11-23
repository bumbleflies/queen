import { describe, it, expect } from 'vitest';
import { epcPayload, EpcError } from '../epcQr';

const base = {
  name: 'Test Person',
  iban: 'DE89 3704 0044 0532 0130 00',
  amountCents: 1,
  purpose: 'Test',
};

describe('epcPayload', () => {
  it('writes the exact EPC069-12 field order, with 9 and 10 empty', () => {
    expect(epcPayload(base)).toBe(
      'BCD\n002\n1\nSCT\n\nTest Person\nDE89370400440532013000\nEUR0.01\n\n\nTest\n',
    );
  });

  it('always terminates every field with LF, including the last', () => {
    expect(epcPayload(base).endsWith('Test\n')).toBe(true);
  });

  it('formats cents without grouping and with two decimals', () => {
    expect(epcPayload({ ...base, amountCents: 123456 }).split('\n')[7]).toBe('EUR1234.56');
  });

  it('keeps UTF-8 umlauts and strips line breaks', () => {
    const p = epcPayload({ ...base, name: 'Büro UG', purpose: 'Spesen März\nSP-2026-0001' });
    expect(p).toContain('Büro UG\n');
    expect(p).toContain('\nSpesen März SP-2026-0001\n');
    expect(p.split('\n').filter((l) => l.includes('Spesen')).length).toBe(1);
  });

  it('appends optional information as its own field', () => {
    expect(epcPayload({ ...base, info: 'Danke' }).endsWith('Test\nDanke\n')).toBe(true);
  });

  it.each([
    [{ ...base, name: '' }, /Empfänger/],
    [{ ...base, purpose: '' }, /Verwendungszweck/],
    [{ ...base, iban: 'DE12' }, /IBAN/],
    [{ ...base, amountCents: 0 }, /Betrag/],
    [{ ...base, name: 'x'.repeat(71) }, /70/],
    [{ ...base, purpose: 'x'.repeat(141) }, /140/],
  ])('rejects invalid input %#', (input, err) => {
    expect(() => epcPayload(input as never)).toThrow(EpcError);
    expect(() => epcPayload(input as never)).toThrow(err);
  });
});
