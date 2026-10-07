import { describe, it, expect } from 'vitest';
import { previewBankPosting } from '../lib/bookingPreview';

describe('previewBankPosting', () => {
  it('returns lines for a valid booking', () => {
    expect(
      previewBankPosting({ direction: 'out', amountCents: 11900, account: '6837', vatRate: 0.19, mode: 'normal' }),
    ).toEqual({
      lines: [
        { account: '1406', debitCents: 1900, creditCents: 0 },
        { account: '1800', debitCents: 0, creditCents: 11900 },
        { account: '6837', debitCents: 10000, creditCents: 0 },
      ],
      error: null,
    });
  });

  it('returns the error instead of throwing', () => {
    const res = previewBankPosting({ direction: 'out', amountCents: 100, account: '', vatRate: 0.19, mode: 'normal' });
    expect(res.lines).toEqual([]);
    expect(res.error).toMatch(/account/i);
  });
});
