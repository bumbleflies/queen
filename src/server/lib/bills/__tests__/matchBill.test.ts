import { describe, expect, it } from 'vitest';
import { bestBillForTransaction, bestTransactionForBill, billMatchScore, type BillLike, type TxLike } from '../matchBill';

function bill(over: Partial<BillLike> = {}): BillLike {
  return {
    grossCents: 11900,
    iban: 'DE44500921000000059512',
    vendorName: 'Hetzner Online GmbH',
    invoiceNumber: 'R-1234567',
    receivedAt: new Date(2026, 9, 1),
    dueDate: new Date(2026, 9, 15),
    ...over,
  };
}

function tx(over: Partial<TxLike> = {}): TxLike {
  return {
    date: new Date(2026, 9, 10),
    amountCents: 11900,
    direction: 'out',
    counterpartyName: 'Hetzner Online GmbH',
    counterpartyIban: 'DE44500921000000059512',
    description: 'Hetzner Online GmbH R-1234567',
    ...over,
  };
}

describe('billMatchScore', () => {
  it('scores a full match high', () => {
    expect(billMatchScore(bill(), tx())).toBeGreaterThanOrEqual(8);
  });

  it('never matches a different amount or an incoming payment', () => {
    expect(billMatchScore(bill(), tx({ amountCents: 11899 }))).toBe(0);
    expect(billMatchScore(bill(), tx({ direction: 'in' }))).toBe(0);
    expect(billMatchScore(bill({ grossCents: null }), tx())).toBe(0);
  });

  it('still matches on amount alone, and on amount + IBAN', () => {
    const bare = tx({ counterpartyName: null, counterpartyIban: null, description: 'SEPA Lastschrift' });
    expect(billMatchScore(bill(), bare)).toBeGreaterThan(0);
    expect(billMatchScore(bill(), bare)).toBeLessThan(billMatchScore(bill(), tx()));
  });

  it('accepts the payment up to a while after the due date, but not before the bill', () => {
    const late = tx({ date: new Date(2026, 11, 1) });
    expect(billMatchScore(bill(), late)).toBeGreaterThan(0);
    const before = tx({ date: new Date(2026, 7, 1) });
    expect(billMatchScore(bill(), before)).toBe(0);
  });

  it('ignores spaces and case when looking for the invoice number in the purpose', () => {
    const spaced = tx({ description: 'RECHNUNG r 1234567 hetzner' });
    expect(billMatchScore(bill({ iban: '' }), spaced)).toBeGreaterThan(0);
  });
});

describe('bestBillForTransaction', () => {
  it('picks the single best bill', () => {
    const a = bill({ invoiceNumber: 'A-1', receivedAt: new Date(2026, 9, 1) });
    const b = bill({ invoiceNumber: 'R-1234567' });
    expect(bestBillForTransaction([a, b], tx())?.invoiceNumber).toBe('R-1234567');
  });

  it('refuses to choose between two equally good bills', () => {
    const a = bill({ invoiceNumber: 'R-1234567' });
    const b = bill({ invoiceNumber: 'R-1234567' });
    expect(bestBillForTransaction([a, b], tx())).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(bestBillForTransaction([bill()], tx({ amountCents: 500 }))).toBeNull();
    expect(bestBillForTransaction([], tx())).toBeNull();
  });
});

describe('bestTransactionForBill', () => {
  it('finds the payment for a bill', () => {
    const other = tx({ amountCents: 999, date: new Date(2026, 9, 12) });
    expect(bestTransactionForBill(bill(), [other, tx()])?.amountCents).toBe(11900);
  });

  it('returns null for an unpaid bill and for an ambiguous pair', () => {
    expect(bestTransactionForBill(bill(), [tx({ amountCents: 500 })])).toBeNull();
    expect(bestTransactionForBill(bill(), [tx(), tx()])).toBeNull();
  });
});
