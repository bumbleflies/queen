import { describe, it, expect } from 'vitest';
import { suggestionConflict, type ReceiptReading } from '../receiptReading';
import { suggestForTx } from '../txSuggestion';
import type { Suggestion } from '../suggest';

const rule = (over: Partial<Suggestion> = {}): Suggestion => ({
  supplierName: 'Software Ltd',
  account: '6837',
  vatRate: 0.19,
  mode: 'normal',
  matchedBy: 'iban',
  ...over,
});

const fromReceipt = (over: Partial<Suggestion> = {}): Suggestion => ({
  supplierName: 'Software Ltd',
  account: '6837',
  vatRate: 0.19,
  mode: 'normal',
  matchedBy: 'receipt',
  reading: { vendor: 'Software Ltd', totalCents: 1190, lines: [{ vatRate: 0.19, grossCents: 1190, account: '6837' }] },
  ...over,
});

const splitReceipt = (): Suggestion => ({
  supplierName: 'Muster Café',
  mode: 'normal',
  matchedBy: 'receipt',
  reading: { vendor: 'Muster Café', totalCents: 5460, lines: [] },
  split: [
    { account: '6640', vatRate: 0.07, grossCents: 3210, mode: 'normal' },
    { account: '6837', vatRate: 0.19, grossCents: 2250, mode: 'normal' },
  ],
});

describe('suggestionConflict', () => {
  it('is null when account, rate and mode agree', () => {
    expect(suggestionConflict(rule(), fromReceipt())).toBeNull();
  });

  it('reports the receipt side when the account differs', () => {
    expect(suggestionConflict(rule(), fromReceipt({ account: '6640' }))).toEqual({ account: '6640', vatRate: 0.19, mode: 'normal', split: undefined });
  });

  it('reports the receipt side when only the VAT rate differs', () => {
    expect(suggestionConflict(rule(), fromReceipt({ account: '6837', vatRate: 0.07 }))).toMatchObject({ vatRate: 0.07 });
  });

  it('reports the receipt side when the mode differs', () => {
    expect(suggestionConflict(rule(), fromReceipt({ mode: 'reverseCharge', vatRate: 0.19 }))).toMatchObject({ mode: 'reverseCharge' });
  });

  it('treats a split receipt as a conflict with any single rule', () => {
    expect(suggestionConflict(rule({ account: '6640' }), splitReceipt())?.split).toHaveLength(2);
  });

  it('is null for matching split parts', () => {
    const parts = splitReceipt().split!;
    expect(suggestionConflict({ ...rule(), split: parts }, splitReceipt())).toBeNull();
  });

  it('ignores vatOnly rules without an account when the rate agrees', () => {
    expect(suggestionConflict(rule({ account: undefined, mode: 'vatOnly' }), fromReceipt({ account: undefined, mode: 'vatOnly' }))).toBeNull();
  });

  it('is null without a receipt suggestion', () => {
    expect(suggestionConflict(rule(), { ...fromReceipt(), matchedBy: 'history' })).toBeNull();
  });
});

describe('suggestForTx', () => {
  const reading: ReceiptReading = {
    vendor: 'Muster Café',
    country: 'DE',
    date: '2026-10-01',
    totalCents: 5460,
    reverseCharge: false,
    lines: [
      { vatRate: 0.07, grossCents: 3210, account: '6640' },
      { vatRate: 0.19, grossCents: 2250, account: '6837' },
    ],
  };

  it('keeps the rule and reports the receipt as a conflict', () => {
    const s = suggestForTx(
      { amountCents: 5460, direction: 'out', counterpartyName: 'Muster Café', description: 'x', receiptMatch: { driveFileIds: ['f1', 'f2'], reading } },
      [{ _id: 's1', kreditorNumber: 70001, name: 'Muster Café', ibans: [], namePatterns: ['Muster Café'], purposePatterns: [], defaultAccount: '6640', defaultVatRate: 0.07, defaultMode: 'normal' }],
      new Map(),
    );
    expect(s.supplierName).toBe('Muster Café');
    expect(s.conflict?.split).toHaveLength(2);
    expect(s.reading?.files).toBe(2);
  });

  it('returns the receipt suggestion when nothing else matches', () => {
    const s = suggestForTx({ amountCents: 5460, direction: 'out', counterpartyName: 'Muster Café', description: 'x', receiptMatch: { driveFileIds: ['f1'], reading } }, [], new Map());
    expect(s?.matchedBy).toBe('receipt');
    expect(s?.split).toHaveLength(2);
  });
});
