import { describe, it, expect } from 'vitest';
import {
  matchPayout,
  payoutReferenceMismatch,
  type PayoutCandidate,
  type PayoutTx,
} from '../payoutMatch';

const CHRIS = {
  iban: 'DE89 3704 0044 0532 0130 00',
  shortName: 'ChrisD',
  name: 'Chris Daehn',
};
const OTHER = {
  iban: 'DE02120300000000202051',
  shortName: 'AnnaM',
  name: 'Anna Meyer',
};

function candidate(number: string, amountCents: number, founder = CHRIS): PayoutCandidate {
  return { payout: { _id: number, number, amountCents, status: 'released' }, founder };
}

function tx(overrides: Partial<PayoutTx> = {}): PayoutTx {
  return {
    description: 'Spesen ChrisD 2026-01 SP-2026-0001',
    amountCents: 5000,
    counterpartyIban: CHRIS.iban,
    ...overrides,
  };
}

describe('matchPayout — reference', () => {
  it('matches the reference with exact amount, tolerating inserted spaces', () => {
    expect(matchPayout(tx({ description: 'Spesen SP - 2026 - 0001' }), [candidate('SP-2026-0001', 5000)])).toEqual({
      payout: candidate('SP-2026-0001', 5000).payout,
      method: 'reference',
    });
  });

  it('returns null when the reference amount differs — never falls through', () => {
    expect(matchPayout(tx(), [candidate('SP-2026-0001', 4999)])).toBeNull();
  });

  it('reports a reference/amount mismatch as a warning candidate', () => {
    const found = payoutReferenceMismatch(tx(), [candidate('SP-2026-0001', 4999)]);
    expect(found?.payout.number).toBe('SP-2026-0001');
    expect(payoutReferenceMismatch(tx({ description: 'Miete' }), [candidate('SP-2026-0001', 4999)])).toBeNull();
  });
});

describe('matchPayout — iban + amount', () => {
  it('matches a plain transfer by IBAN and exact amount', () => {
    expect(matchPayout(tx({ description: 'Erstattung' }), [candidate('SP-2026-0001', 5000)])).toEqual({
      payout: candidate('SP-2026-0001', 5000).payout,
      method: 'iban+amount',
    });
  });

  it('refuses two payouts of the same amount to the same founder', () => {
    expect(
      matchPayout(tx({ description: 'Erstattung' }), [
        candidate('SP-2026-0001', 5000),
        candidate('SP-2026-0002', 5000),
      ]),
    ).toBeNull();
  });

  it('refuses an amount mismatch even with the right IBAN', () => {
    expect(matchPayout(tx({ description: 'Erstattung' }), [candidate('SP-2026-0001', 5001)])).toBeNull();
  });

  it('refuses a different IBAN', () => {
    expect(matchPayout(tx({ counterpartyIban: OTHER.iban, description: 'Erstattung' }), [candidate('SP-2026-0001', 5000)])).toBeNull();
  });
});

describe('matchPayout — legacy and dividends', () => {
  it('matches a legacy "Spesen ChrisD" transfer only to ChrisD', () => {
    const found = matchPayout(tx({ description: 'Spesen ChrisD Januar' }), [
      candidate('SP-2026-0001', 5000, CHRIS),
      candidate('SP-2026-0002', 5000, OTHER),
    ]);
    expect(found?.payout.number).toBe('SP-2026-0001');
    expect(found?.method).toBe('legacy');
  });

  it('recognises the full name too', () => {
    const found = matchPayout(tx({ description: 'Spesen Chris Daehn' }), [candidate('SP-2026-0001', 5000)]);
    expect(found?.method).toBe('legacy');
  });

  it.each([
    'Gewinnausschüttung 2025',
    'Gewinnausschuettung 2025',
    'Ausschüttung an Gesellschafter',
    'Spesen ChrisD Gewinnausschüttung',
  ])('never matches a dividend: %s', (description) => {
    expect(matchPayout(tx({ description }), [candidate('SP-2026-0001', 5000)])).toBeNull();
  });
});
