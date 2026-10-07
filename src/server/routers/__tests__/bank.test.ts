import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { buildBankListFilter } from '../bank';
import { BankTransaction } from '../../models/BankTransaction';
import { ReconcileRun } from '../../models/ReconcileRun';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
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
  await BankTransaction.init();
  await ReconcileRun.init();
  await initLedgerModels();
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await BankTransaction.deleteMany({});
  await ReconcileRun.deleteMany({});
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await InvoiceLine.deleteMany({});
  await resetLedgerDb(); // seeds accounts for the ledger hooks
});

const assignLine = {
  position: '1',
  description: 'Beratung',
  quantity: 1,
  unitNetCents: 10000,
  vatRate: 0.19 as const,
};

async function createSentInvoice(caller: ReturnType<typeof adminCaller>): Promise<string> {
  const client = (await caller.clients.create({
    name: 'Acme GmbH',
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
  })) as any;
  const draft = (await caller.invoices.createDraft({
    clientId: client._id.toString(),
    title: 'Beratung',
    servicePeriod: '05.2025',
  })) as any;
  const invoiceId = draft._id.toString();
  await caller.invoices.setLines({ id: invoiceId, lines: [assignLine] });
  await caller.invoices.markSent({ id: invoiceId });
  return invoiceId;
}

describe('buildBankListFilter (pure)', () => {
  it('unmatchedOnly = not matched and not ignored', () => {
    expect(buildBankListFilter({ unmatchedOnly: true })).toEqual({
      direction: { $ne: 'out' },
      matchedInvoiceId: null,
      ignored: { $ne: true },
    });
  });
  it('filters ignored true/false explicitly', () => {
    expect(buildBankListFilter({ ignored: true })).toEqual({ direction: { $ne: 'out' }, ignored: true });
    expect(buildBankListFilter({ ignored: false })).toEqual({ direction: { $ne: 'out' }, ignored: { $ne: true } });
  });
  it('always filters direction != out (legacy rows without direction count as incoming)', () => {
    expect(buildBankListFilter()).toEqual({ direction: { $ne: 'out' } });
  });
});

describe('bank router', () => {
  it('assign applies the manual payment and updates the invoice', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoiceId = await createSentInvoice(caller);
    const tx = await BankTransaction.create({
      fireflyJournalId: '42:0',
      date: new Date('2025-01-15T00:00:00Z'),
      amountCents: 11900,
      currency: 'EUR',
      description: 'ohne Verwendungszweck',
    });

    const result = await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId });
    expect(result.outcome).toBe('paid');

    const invoice = await Invoice.findById(invoiceId);
    expect(invoice!.payments).toHaveLength(1);
    expect(invoice!.payments[0].amountCents).toBe(11900);
    expect(invoice!.status).toBe('paid');
    expect(invoice!.reconcileState).toBe('matched');

    const linked = await BankTransaction.findById(tx._id);
    expect(linked!.matchedInvoiceId!.toString()).toBe(invoiceId);
    expect(linked!.matchMethod).toBe('manual');
  });

  it('assign with unknown bank transaction or invoice → NOT_FOUND', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const unknown = new mongoose.Types.ObjectId().toString();
    const tx = await BankTransaction.create({
      fireflyJournalId: '44:0',
      date: new Date('2025-01-17T00:00:00Z'),
      amountCents: 1000,
      currency: 'EUR',
      description: 'x',
    });
    await expect(caller.bank.assign({ bankTxId: unknown, invoiceId: unknown })).rejects.toMatchObject(
      { code: 'NOT_FOUND' },
    );
    await expect(
      caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: unknown }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('assign to a canceled invoice → BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoiceId = await createSentInvoice(caller);
    await caller.invoices.cancel({ id: invoiceId });
    const tx = await BankTransaction.create({
      fireflyJournalId: '45:0',
      date: new Date('2025-01-18T00:00:00Z'),
      amountCents: 1000,
      currency: 'EUR',
      description: 'x',
    });
    await expect(
      caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('ignore marks a transaction ignored and unignore reverses it', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const tx = await BankTransaction.create({
      fireflyJournalId: '43:0',
      date: new Date('2025-01-16T00:00:00Z'),
      amountCents: 5000,
      currency: 'EUR',
      description: 'Gebühr',
    });
    expect((await caller.bank.ignore({ bankTxId: tx._id.toString() })).ignored).toBe(true);
    expect((await caller.bank.unignore({ bankTxId: tx._id.toString() })).ignored).toBe(false);
  });

  it('syncNow stores an error on ReconcileRun and returns ok:false instead of throwing', async (ctx) => {
    skipIfNoDb(ctx);
    const prev = { ...process.env };
    delete process.env.FIREFLY_URL;
    delete process.env.FIREFLY_PAT;
    delete process.env.FIREFLY_GLS_ACCOUNT_ID;
    delete process.env.QUEEN_BANK_START;
    try {
      const res = await adminCaller().bank.syncNow();
      expect(res.ok).toBe(false);
      const runs = await ReconcileRun.find({});
      expect(runs).toHaveLength(1);
      expect(runs[0].error).toBeTruthy();
    } finally {
      process.env = prev;
    }
  });
});
