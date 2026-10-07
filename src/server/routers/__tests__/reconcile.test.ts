import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Invoice } from '../../models/Invoice';
import { BankTransaction } from '../../models/BankTransaction';
import {
  reconcileBankTransaction,
  reconcilePendingTransactions,
  reversePayment,
} from '../../lib/reconcile';
import { initLedgerModels, resetLedgerDb } from './helpers/ledgerFixtures';

function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}

function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  if (!dbAvailable()) return;
  await Invoice.init();
  await BankTransaction.init();
  await initLedgerModels();
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Invoice.deleteMany({});
  await BankTransaction.deleteMany({});
  await resetLedgerDb(); // seeds accounts for the ledger hooks
});

const clientId = new mongoose.Types.ObjectId();

async function makeInvoice(overrides: Record<string, unknown> = {}) {
  return Invoice.create({
    invoiceNumber: '20260829-01',
    legacy: false,
    kind: 'invoice',
    clientId,
    customerNumber: 10009,
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    title: 'Beratung',
    servicePeriod: '08.2026',
    paymentTermDays: 30,
    status: 'sent',
    totals: { netCents: 8403, vatCents: 1597, grossCents: 10000 },
    payments: [],
    reconcileState: 'unmatched',
    footerNotes: [],
    ...overrides,
  });
}

async function makeTx(overrides: Record<string, unknown> = {}) {
  return BankTransaction.create({
    fireflyJournalId: '101:0',
    date: new Date('2026-08-30T00:00:00Z'),
    amountCents: 10000,
    currency: 'EUR',
    description: 'Verwendungszweck: 10009-20260829-01',
    ignored: false,
    ...overrides,
  });
}

describe('reconcile (DB)', () => {
  it('never matches a withdrawal even with a valid Verwendungszweck', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx({ direction: 'out' });

    await reconcilePendingTransactions();
    expect((await reconcileBankTransaction(tx)).outcome).toBe('unmatched');

    const after = await BankTransaction.findById(tx._id);
    expect(after!.matchedInvoiceId).toBeFalsy();
    expect((await Invoice.findById(invoice._id))!.status).toBe('sent');
  });

  it('exact payment marks the invoice paid and links the transaction', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('paid');

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('matched');
    expect(updated!.paidAt).toEqual(tx.date);
    expect(updated!.payments).toHaveLength(1);

    const linked = await BankTransaction.findById(tx._id);
    expect(linked!.matchedInvoiceId!.toString()).toBe(invoice._id.toString());
    expect(linked!.matchMethod).toBe('reference');
  });

  it('two partial payments reach paid on the second run', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    await makeTx({ fireflyJournalId: '101:0', amountCents: 4000 });

    await reconcilePendingTransactions();
    const afterFirst = await Invoice.findById(invoice._id);
    expect(afterFirst!.status).toBe('sent');
    expect(afterFirst!.reconcileState).toBe('partial');
    expect(afterFirst!.payments).toHaveLength(1);

    await makeTx({ fireflyJournalId: '102:0', amountCents: 6000 });
    await reconcilePendingTransactions();
    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('matched');
    expect(updated!.payments).toHaveLength(2);
  });

  it('an overpayment is flagged and the invoice stays paid', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx({ amountCents: 12000 });

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('overpaid');

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.status).toBe('paid');
    expect(updated!.reconcileState).toBe('overpaid');
  });

  it('a wrong customer number is left for the manual queue', async (ctx) => {
    skipIfNoDb(ctx);
    await makeInvoice();
    const tx = await makeTx({ description: 'Verwendungszweck: 99999-20260829-01' });

    const result = await reconcileBankTransaction(tx);
    expect(result.outcome).toBe('unmatched');
    expect((await BankTransaction.findById(tx._id))!.matchedInvoiceId ?? null).toBeNull();
  });

  it('re-running reconcile is a no-op for an already matched transaction', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();
    await reconcileBankTransaction(tx);

    const counts = await reconcilePendingTransactions();
    expect(counts).toEqual({ matched: 0, partial: 0, unmatched: 0 });
    expect((await Invoice.findById(invoice._id))!.payments).toHaveLength(1);
  });

  it('bank.unassign reverses the payment, status and reconcileState', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const tx = await makeTx();
    await reconcileBankTransaction(tx);

    const result = await adminCaller().bank.unassign({ bankTxId: tx._id.toString() });
    expect(result.matchedInvoiceId ?? null).toBeNull();

    const updated = await Invoice.findById(invoice._id);
    expect(updated!.payments).toHaveLength(0);
    expect(updated!.status).toBe('sent');
    expect(updated!.paidAt ?? null).toBeNull();
    expect(updated!.reconcileState).toBe('unmatched');
  });

  it('reversePayment keeps a partial state when other payments remain', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await makeInvoice();
    const a = await makeTx({ fireflyJournalId: '101:0', amountCents: 4000 });
    const b = await makeTx({ fireflyJournalId: '102:0', amountCents: 3000 });
    await reconcileBankTransaction(a);
    await reconcileBankTransaction(b);

    await reversePayment(invoice._id, '101:0');
    const updated = await Invoice.findById(invoice._id);
    expect(updated!.payments).toHaveLength(1);
    expect(updated!.reconcileState).toBe('partial');
    expect(updated!.status).toBe('sent');
  });
});
