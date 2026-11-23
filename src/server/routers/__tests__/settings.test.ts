import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { appRouter } from '../../trpc';
import { Setting } from '../../models/Setting';
import { adminCaller } from './helpers/ledgerFixtures';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

function userCaller() {
  return appRouter.createCaller({
    user: { sub: 'user-id-1', email: 'user@example.de', role: 'user' },
    serviceAuth: false,
  });
}

describe('settings router', () => {
  beforeEach(skipIfNoDb);
  afterEach(async () => {
    delete process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
    delete process.env.QUEEN_RECEIPTS_FOLDER_ID;
    if (mongoose.connection.readyState === 1) await Setting.deleteMany({ key: 'expenses' });
  });

  it('getDriveFolders reports env fallback and explicit settings', async () => {
    process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID = 'env-inv';
    const before = await adminCaller().settings.getDriveFolders();
    expect(before.invoices).toEqual({ id: 'env-inv', name: null });
    expect(before.receipts).toBeNull();
    delete process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;

    await adminCaller().settings.setDriveFolders({
      receipts: { id: 'ui-rec', name: 'Belege' },
    });
    const after = await adminCaller().settings.getDriveFolders();
    expect(after.invoices).toBeNull();
    expect(after.receipts).toEqual({ id: 'ui-rec', name: 'Belege' });
  });

  it('setDriveFolders requires admin', async () => {
    await expect(
      userCaller().settings.setDriveFolders({ receipts: { id: 'x', name: 'x' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('stores the auto-book limit in cents, default 100 €, admin-only', async () => {
    expect((await adminCaller().settings.getExpenseLimit()).cents).toBe(10000);
    await expect(
      userCaller().settings.setExpenseLimit({ cents: 20000 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const stored = await adminCaller().settings.setExpenseLimit({ cents: 25000 });
    expect(stored.cents).toBe(25000);
    expect((await adminCaller().settings.getExpenseLimit()).cents).toBe(25000);
  });
});
