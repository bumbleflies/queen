import { describe, it, expect } from 'vitest';
import {
  buildReceiptPrompt,
  maskBankData,
  parseReceiptReply,
  readingToSuggestion,
  type ReceiptReading,
} from '../receiptReading';

const ACCOUNTS = new Set(['6640', '6837', '6820']);
const outTx = { amountCents: 5460, direction: 'out', counterpartyName: 'Muster Café' };

function reading(over: Partial<ReceiptReading> = {}): ReceiptReading {
  return {
    vendor: 'Muster Café',
    country: 'DE',
    date: '2026-10-01',
    totalCents: 5460,
    reverseCharge: false,
    lines: [
      { vatRate: 0.07, grossCents: 3210, account: '6640' },
      { vatRate: 0.19, grossCents: 2250, account: '6837' },
    ],
    ...over,
  };
}

describe('maskBankData', () => {
  it('masks IBANs and BICs', () => {
    const text = 'Bitte überweisen an DE89 3704 0044 0532 0130 00, BIC: TESTDEFFXXX. Alt: DE89370400440532013000 danke';
    const masked = maskBankData(text);
    expect(masked).toBe('Bitte überweisen an [IBAN], BIC: [BIC]. Alt: [IBAN] danke');
    expect(masked).not.toMatch(/3704|TESTDEFF|013000/);
  });

  it.each([
    ['double spaces after a label', 'IBAN: DE89  3704 0044 0532 0130 00 Danke', 'IBAN: [IBAN] Danke'],
    ['hyphens and lowercase', 'Konto de89-3704-0044-0532-0130-00 bitte', 'Konto [IBAN] bitte'],
    ['odd grouping after a label', 'IBAN DE 89 37040044 0532013000\nSumme', 'IBAN [IBAN]\nSumme'],
    ['letter groups after a label, stops at BIC', 'IBAN: GB29 NWBK 6016 1331 9268 19 BIC TESTGB2L', 'IBAN: [IBAN] BIC [BIC]'],
    ['lowercase label', 'iban de89370400440532013000.', 'iban [IBAN].'],
  ])('masks IBANs: %s', (_case, text, expected) => {
    expect(maskBankData(text)).toBe(expected);
  });

  it.each([
    ['BIC', 'BIC TESTDEFFXXX', 'BIC [BIC]'],
    ['BIC:', 'BIC: TESTDEFF', 'BIC: [BIC]'],
    ['BIC/SWIFT', 'BIC/SWIFT: TESTDEFFXXX', 'BIC/SWIFT: [BIC]'],
    ['SWIFT', 'SWIFT TESTDEFFXXX', 'SWIFT [BIC]'],
    ['SWIFT-Code', 'SWIFT-Code: testdeffxxx', 'SWIFT-Code: [BIC]'],
  ])('masks BICs after %s', (_label, text, expected) => {
    expect(maskBankData(text)).toBe(expected);
  });

  it('leaves amounts, dates and invoice numbers alone', () => {
    const text = 'Rechnung 2026-10-01 Nr. 100000123456 Summe 54,60 EUR';
    expect(maskBankData(text)).toBe(text);
  });
});

describe('buildReceiptPrompt', () => {
  it('lists only the given accounts, asks for strict JSON and masks the text', () => {
    const prompt = buildReceiptPrompt('Summe 54,60 EUR IBAN DE89 3704 0044 0532 0130 00', [
      { number: '6640', name: 'Bewirtungskosten' },
      { number: '6837', name: 'Lizenzen' },
    ]);
    expect(prompt).toContain('6640 Bewirtungskosten');
    expect(prompt).toContain('6837 Lizenzen');
    expect(prompt).toContain('totalCents');
    expect(prompt).toContain('[IBAN]');
    expect(prompt).not.toContain('3704');
  });
});

describe('parseReceiptReply', () => {
  it('parses JSON inside prose', () => {
    const reply = `Gern, hier das Ergebnis:\n\`\`\`json\n${JSON.stringify(reading())}\n\`\`\`\nSonst noch etwas?`;
    expect(parseReceiptReply(reply, ACCOUNTS)).toEqual(reading());
  });

  it('defaults missing optional fields', () => {
    const r = parseReceiptReply(JSON.stringify({ vendor: 'X', totalCents: 1190, lines: [{ vatRate: 0.19, grossCents: 1190, account: '6837' }] }), ACCOUNTS);
    expect(r).toEqual({ vendor: 'X', country: null, date: null, totalCents: 1190, reverseCharge: false, lines: [{ vatRate: 0.19, grossCents: 1190, account: '6837' }] });
  });

  it('rejects unknown account', () => {
    const r = reading({ lines: [{ vatRate: 0.07, grossCents: 3210, account: '6640' }, { vatRate: 0.19, grossCents: 2250, account: '9999' }] });
    expect(parseReceiptReply(JSON.stringify(r), ACCOUNTS)).toBeNull();
  });

  it('rejects rates outside 0 / 7 / 19 %', () => {
    const r = reading({ totalCents: 1160, lines: [{ vatRate: 0.16, grossCents: 1160, account: '6837' }] });
    expect(parseReceiptReply(JSON.stringify(r), ACCOUNTS)).toBeNull();
  });

  it('rejects lines not summing to total', () => {
    expect(parseReceiptReply(JSON.stringify(reading({ totalCents: 5461 })), ACCOUNTS)).toBeNull();
  });

  it('rejects non-integer cents, empty lines and garbage', () => {
    expect(parseReceiptReply(JSON.stringify(reading({ totalCents: 54.6 })), ACCOUNTS)).toBeNull();
    expect(parseReceiptReply(JSON.stringify(reading({ totalCents: 0, lines: [] })), ACCOUNTS)).toBeNull();
    expect(parseReceiptReply('Ich kann das nicht lesen.', ACCOUNTS)).toBeNull();
    expect(parseReceiptReply('{ kaputt', ACCOUNTS)).toBeNull();
  });
});

describe('readingToSuggestion', () => {
  it('maps one 19 % line to a normal suggestion', () => {
    const r = reading({ totalCents: 1190, lines: [{ vatRate: 0.19, grossCents: 1190, account: '6837' }] });
    expect(readingToSuggestion(r, { ...outTx, amountCents: 1190 })).toEqual({
      supplierName: 'Muster Café',
      account: '6837',
      vatRate: 0.19,
      mode: 'normal',
      matchedBy: 'receipt',
      reading: { vendor: 'Muster Café', totalCents: 1190, lines: r.lines },
    });
  });

  it('merges lines with the same account and rate into one booking', () => {
    const r = reading({ totalCents: 1190, lines: [{ vatRate: 0.19, grossCents: 1000, account: '6837' }, { vatRate: 0.19, grossCents: 190, account: '6837' }] });
    const s = readingToSuggestion(r, { ...outTx, amountCents: 1190 });
    expect(s?.split).toBeUndefined();
    expect(s).toMatchObject({ account: '6837', vatRate: 0.19, mode: 'normal' });
  });

  it('maps 7 % + 19 % to a split suggestion', () => {
    const s = readingToSuggestion(reading(), outTx);
    expect(s?.matchedBy).toBe('receipt');
    expect(s?.account).toBeUndefined();
    expect(s?.split).toEqual([
      { account: '6640', vatRate: 0.07, grossCents: 3210, mode: 'normal' },
      { account: '6837', vatRate: 0.19, grossCents: 2250, mode: 'normal' },
    ]);
  });

  it('maps reverseCharge', () => {
    const r = reading({ vendor: 'Cloud Ltd', country: 'IE', totalCents: 2000, reverseCharge: true, lines: [{ vatRate: 0, grossCents: 2000, account: '6837' }] });
    expect(readingToSuggestion(r, { ...outTx, amountCents: 2000 })).toMatchObject({ account: '6837', vatRate: 0.19, mode: 'reverseCharge', matchedBy: 'receipt' });
    const split = readingToSuggestion({ ...r, lines: [{ vatRate: 0, grossCents: 1500, account: '6837' }, { vatRate: 0, grossCents: 500, account: '6820' }] }, { ...outTx, amountCents: 2000 });
    expect(split?.split).toEqual([
      { account: '6837', vatRate: 0.19, grossCents: 1500, mode: 'reverseCharge' },
      { account: '6820', vatRate: 0.19, grossCents: 500, mode: 'reverseCharge' },
    ]);
    expect(readingToSuggestion(r, { ...outTx, amountCents: 2000, direction: 'in' })).toBeNull();
  });

  it('returns null when the total differs from the bank amount', () => {
    expect(readingToSuggestion(reading(), { ...outTx, amountCents: 5400 })).toBeNull();
  });
});
