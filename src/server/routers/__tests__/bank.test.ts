import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { buildBankListFilter } from '../bank';
import { BankTransaction } from '../../models/BankTransaction';
import { ReconcileRun } from '../../models/ReconcileRun';

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
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await BankTransaction.deleteMany({});
  await ReconcileRun.deleteMany({});
});

describe('buildBankListFilter (pure)', () => {
  it('unmatchedOnly = not matched and not ignored', () => {
    expect(buildBankListFilter({ unmatchedOnly: true })).toEqual({
      matchedInvoiceId: null,
      ignored: { $ne: true },
    });
  });
  it('filters ignored true/false explicitly', () => {
    expect(buildBankListFilter({ ignored: true })).toEqual({ ignored: true });
    expect(buildBankListFilter({ ignored: false })).toEqual({ ignored: { $ne: true } });
  });
  it('defaults to no filter', () => {
    expect(buildBankListFilter()).toEqual({});
  });
});

describe('bank router', () => {
  it('assign records the manual link without touching invoice status', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const tx = await BankTransaction.create({
      fireflyJournalId: '42:0',
      date: new Date('2025-01-15T00:00:00Z'),
      amountCents: 107100,
      currency: 'EUR',
      description: 'Rechnung 10001-20250101-01',
    });
    const updated = await caller.bank.assign({
      bankTxId: tx._id.toString(),
      invoiceId: new mongoose.Types.ObjectId().toString(),
    });
    expect(updated.matchedInvoiceId).toBeTruthy();
    expect(updated.matchMethod).toBe('manual');
    const unassigned = await caller.bank.unassign({ bankTxId: tx._id.toString() });
    expect(unassigned.matchedInvoiceId ?? null).toBeNull();
    expect(unassigned.matchMethod ?? null).toBeNull();
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
