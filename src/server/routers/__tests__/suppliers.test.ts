import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

beforeAll(async () => {
  await initLedgerModels();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Supplier.deleteMany({});
  await Counter.deleteMany({ _id: 'supplier' });
});

describe('suppliers', () => {
  it('create allocates Kreditor numbers from 70000 and validates the default account', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const a = await caller.suppliers.create({ name: 'A', defaultAccount: '6855', defaultVatRate: 0 });
    const b = await caller.suppliers.create({ name: 'B' });
    expect([a.kreditorNumber, b.kreditorNumber]).toEqual([70000, 70001]);
    await expect(caller.suppliers.create({ name: 'C', defaultAccount: '9999' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('update normalises IBANs and archive hides from list', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const s = await caller.suppliers.create({ name: 'A' });
    const updated = await caller.suppliers.update({ id: String(s._id), ibans: ['de02 1203 0000 0000 2020 51'] });
    expect(updated.ibans).toEqual(['DE02120300000000202051']);
    await caller.suppliers.setArchived({ id: String(s._id), archived: true });
    expect(await caller.suppliers.list()).toHaveLength(0);
    expect(await caller.suppliers.list({ includeArchived: true })).toHaveLength(1);
  });

  it('importCreditors: dry run writes nothing; apply creates missing and raises the counter', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const csv = 'creditorName,creditorId\nBank A,70001\nAmt B,70009\n';
    const dry = await caller.admin.importCreditors({ csv });
    expect(dry).toEqual({ rows: 2, created: 2, existing: 0, errors: [] });
    expect(await Supplier.countDocuments()).toBe(0);
    await caller.admin.importCreditors({ csv, dryRun: false });
    const again = await caller.admin.importCreditors({ csv, dryRun: false });
    expect(again).toMatchObject({ created: 0, existing: 2 });
    const next = await caller.suppliers.create({ name: 'Neu' });
    expect(next.kreditorNumber).toBe(70010);
  });

  it('importCreditors with errors writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await adminCaller().admin.importCreditors({ csv: 'creditorName,creditorId\n,70001', dryRun: false });
    expect(res.errors).toHaveLength(1);
    expect(await Supplier.countDocuments()).toBe(0);
  });
});
