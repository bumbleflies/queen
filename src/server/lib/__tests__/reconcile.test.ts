import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import {
  parseReference,
  pickInvoiceForReference,
  classifyPayment,
  isAlreadyProcessed,
  isCliEntrypoint,
  type ClassifiableInvoice,
} from '../reconcile';

const sentInvoice: ClassifiableInvoice = {
  kind: 'invoice',
  status: 'sent',
  customerNumber: 10009,
  totals: { grossCents: 10000 },
};

const txDate = new Date('2026-08-30T00:00:00Z');

describe('parseReference', () => {
  it('parses a plain Verwendungszweck reference', () => {
    expect(parseReference('10009-20260829-01')).toEqual({
      customerNumber: 10009,
      invoiceNumber: '20260829-01',
    });
  });

  it('tolerates bank-inserted spaces and line breaks', () => {
    expect(parseReference('10009 - 20260829 - 01')).toEqual({
      customerNumber: 10009,
      invoiceNumber: '20260829-01',
    });
    expect(parseReference('Verwendungszweck:\n10009 / 20260829 / 01')).toEqual({
      customerNumber: 10009,
      invoiceNumber: '20260829-01',
    });
  });

  it('accepts a bare invoice number without a customer number', () => {
    expect(parseReference('Zahlung 20260829-01')).toEqual({ invoiceNumber: '20260829-01' });
  });

  it('returns null when no reference is present', () => {
    expect(parseReference('Gebühr Kontoführung')).toBeNull();
    expect(parseReference('')).toBeNull();
  });
});

describe('pickInvoiceForReference', () => {
  const invoices = [{ invoiceNumber: '20260829-01' }, { invoiceNumber: '20260101-01' }];

  it('picks the invoice matching the parsed invoice number', () => {
    expect(pickInvoiceForReference({ invoiceNumber: '20260829-01' }, invoices)).toBe(invoices[0]);
  });

  it('returns null when there is no matching invoice', () => {
    expect(pickInvoiceForReference({ invoiceNumber: '19990101-01' }, invoices)).toBeNull();
  });
});

describe('isAlreadyProcessed', () => {
  it('skips transactions that already have an invoice or are ignored', () => {
    expect(isAlreadyProcessed({ matchedInvoiceId: new mongoose.Types.ObjectId() })).toBe(true);
    expect(isAlreadyProcessed({ ignored: true })).toBe(true);
  });

  it('does not skip fresh, unignored transactions', () => {
    expect(isAlreadyProcessed({})).toBe(false);
    expect(isAlreadyProcessed({ ignored: false })).toBe(false);
  });
});

describe('classifyPayment', () => {
  it('exact amount marks the invoice paid with paidAt = tx date', () => {
    const decision = classifyPayment({
      txAmountCents: 10000,
      txDate,
      invoice: sentInvoice,
      existingPayments: [],
      referenceCustomerNumber: 10009,
    });
    expect(decision).toMatchObject({ action: 'paid', reconcileState: 'matched' });
    expect(decision.paidAt).toEqual(txDate);
  });

  it('two partial payments sum to paid on the second apply', () => {
    const first = classifyPayment({
      txAmountCents: 4000,
      txDate,
      invoice: sentInvoice,
      existingPayments: [],
      referenceCustomerNumber: 10009,
    });
    expect(first).toMatchObject({ action: 'partial', reconcileState: 'partial' });
    expect(first.paidAt).toBeUndefined();

    const second = classifyPayment({
      txAmountCents: 6000,
      txDate,
      invoice: sentInvoice,
      existingPayments: [{ amountCents: 4000 }],
      referenceCustomerNumber: 10009,
    });
    expect(second.action).toBe('paid');
    expect(second.paidAt).toEqual(txDate);
  });

  it('flags an overpayment and keeps the invoice paid', () => {
    const decision = classifyPayment({
      txAmountCents: 12000,
      txDate,
      invoice: sentInvoice,
      existingPayments: [],
      referenceCustomerNumber: 10009,
    });
    expect(decision).toMatchObject({ action: 'overpaid', reconcileState: 'overpaid' });
    expect(decision.paidAt).toEqual(txDate);
  });

  it('flags a further payment on an already paid invoice without moving paidAt', () => {
    const decision = classifyPayment({
      txAmountCents: 500,
      txDate,
      invoice: { ...sentInvoice, status: 'paid' },
      existingPayments: [{ amountCents: 10000 }],
      referenceCustomerNumber: 10009,
    });
    expect(decision).toMatchObject({ action: 'overpaid', reconcileState: 'overpaid' });
    expect(decision.paidAt).toBeUndefined();
  });

  it('leaves a wrong customer number unmatched', () => {
    const decision = classifyPayment({
      txAmountCents: 10000,
      txDate,
      invoice: sentInvoice,
      existingPayments: [],
      referenceCustomerNumber: 99999,
    });
    expect(decision.action).toBe('unmatched');
    expect(decision.reason).toMatch(/customer number/i);
  });

  it('never matches a credit note', () => {
    const decision = classifyPayment({
      txAmountCents: 10000,
      txDate,
      invoice: { ...sentInvoice, kind: 'credit_note' },
      existingPayments: [],
      referenceCustomerNumber: 10009,
    });
    expect(decision.action).toBe('unmatched');
  });

  it('leaves invoices that are still draft or canceled unmatched', () => {
    expect(
      classifyPayment({
        txAmountCents: 10000,
        txDate,
        invoice: { ...sentInvoice, status: 'draft' },
        existingPayments: [],
      }).action,
    ).toBe('unmatched');
    expect(
      classifyPayment({
        txAmountCents: 10000,
        txDate,
        invoice: { ...sentInvoice, status: 'canceled' },
        existingPayments: [],
      }).action,
    ).toBe('unmatched');
  });
});

describe('isCliEntrypoint', () => {
  it('is true only for the compiled/ts source cron entrypoint', () => {
    expect(isCliEntrypoint('/app/dist/server/cron/reconcile.js')).toBe(true);
    expect(isCliEntrypoint('/app/src/server/cron/reconcile.ts')).toBe(true);
    expect(isCliEntrypoint('/app/node_modules/vitest/vitest.mjs')).toBe(false);
    expect(isCliEntrypoint(undefined)).toBe(false);
  });
});
