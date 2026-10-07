import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Account } from '../../models/Account';
import { seedAccounts } from '../../lib/accounting/seedAccounts';
import { SKR04_ACCOUNTS } from '../../lib/accounting/skr04';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.init();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.deleteMany({});
});

describe('accounts', () => {
  it('seedAccounts is idempotent', async (ctx) => {
    skipIfNoDb(ctx);
    expect(await seedAccounts()).toBe(SKR04_ACCOUNTS.length);
    expect(await seedAccounts()).toBe(0);
    expect(await Account.countDocuments()).toBe(SKR04_ACCOUNTS.length);
  });

  it('seed does not overwrite a renamed account', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    await Account.updateOne({ number: '1800' }, { name: 'GLS Bank' });
    await seedAccounts();
    expect((await Account.findOne({ number: '1800' }))?.name).toBe('GLS Bank');
  });

  it('list is sorted by number and hides archived by default', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    const caller = adminCaller();
    await caller.accounts.setArchived({ number: '6600', archived: true });
    const list = await caller.accounts.list();
    const numbers = list.map((a) => a.number);
    expect(numbers).toEqual([...numbers].sort());
    expect(numbers).not.toContain('6600');
    const all = await caller.accounts.list({ includeArchived: true });
    expect(all.map((a) => a.number)).toContain('6600');
  });

  it('create rejects duplicates and bad numbers', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    const caller = adminCaller();
    const created = await caller.accounts.create({ number: '6815', name: 'Bürobedarf', type: 'expense' });
    expect(created.number).toBe('6815');
    await expect(
      caller.accounts.create({ number: '6815', name: 'x', type: 'expense' }),
    ).rejects.toThrowError(/exists/);
    await expect(
      caller.accounts.create({ number: '68A', name: 'x', type: 'expense' }),
    ).rejects.toThrow();
  });
});
