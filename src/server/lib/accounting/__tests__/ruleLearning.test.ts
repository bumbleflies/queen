import { describe, it, expect } from 'vitest';
import { learningKey } from '../ruleLearning';

const base = { direction: 'out', description: 'Rechnung 01/2026' };

describe('learningKey', () => {
  it('uses the IBAN when the transaction has one', () => {
    expect(learningKey({ ...base, counterpartyName: 'Hoster GmbH', counterpartyIban: 'DE89 3704 0044 0532 0130 00' })).toEqual({
      kind: 'iban',
      value: 'DE89370400440532013000',
    });
  });

  it('uses the name when there is no IBAN', () => {
    expect(learningKey({ ...base, counterpartyName: ' Hoster  GmbH ' })).toEqual({ kind: 'name', value: 'Hoster GmbH' });
  });

  it('ignores Firefly placeholder names and falls back to the purpose prefix', () => {
    expect(learningKey({ ...base, counterpartyName: '(unknown destination)', description: 'Spesen-ChrisD-202601-Rn70 SecureGo' })).toEqual({
      kind: 'purpose',
      value: 'Spesen-ChrisD',
    });
  });

  it('cuts the purpose prefix before a drive link or a long number', () => {
    expect(
      learningKey({
        ...base,
        description: 'Spesen-ChrisD-202601-Rn70 https://drive.google.com/file/d/1wp6mlvWoaS26HPQWNHVstCHJ4f-XC9Tp/view',
      }),
    ).toEqual({ kind: 'purpose', value: 'Spesen-ChrisD' });
  });

  it('has no key without any usable hint', () => {
    expect(learningKey({ ...base, description: '   ' })).toBeNull();
  });

  it('does not learn from incoming payments', () => {
    expect(learningKey({ ...base, direction: 'in', counterpartyIban: 'DE89370400440532013000' })).toBeNull();
  });

  it('does not learn from a split booking', () => {
    expect(learningKey({ ...base, split: true, counterpartyIban: 'DE89370400440532013000' })).toBeNull();
  });

  it('does not learn when the receipt vendor contradicts the counterparty', () => {
    expect(
      learningKey({ ...base, counterpartyName: 'Christian Dähn', counterpartyIban: 'DE89370400440532013000', receiptVendor: 'Augustiner Keller' }),
    ).toBeNull();
  });

  it('learns when the receipt vendor agrees with the counterparty', () => {
    expect(
      learningKey({ ...base, counterpartyName: 'Software Ltd', counterpartyIban: 'DE89370400440532013000', receiptVendor: 'Software Ltd.' }),
    ).toEqual({ kind: 'iban', value: 'DE89370400440532013000' });
  });

  it('learns when the receipt has no vendor', () => {
    expect(learningKey({ ...base, counterpartyName: 'Software Ltd', receiptVendor: '' })).toEqual({ kind: 'name', value: 'Software Ltd' });
  });
});
