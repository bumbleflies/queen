import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { BankTransaction } from '../../models/BankTransaction';
import { appRouter } from '../../trpc';
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

  it('mutations and import need the admin role', async (ctx) => {
    skipIfNoDb(ctx);
    const user = appRouter.createCaller({ user: { sub: 'u1', email: 'u@example.de', role: 'user' }, serviceAuth: false });
    await expect(user.suppliers.create({ name: 'A' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(user.suppliers.importJson({ json: '[]' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await user.suppliers.list()).toEqual([]);
  });
});

let seq = 0;
async function bankTx(over: Record<string, unknown> = {}) {
  seq += 1;
  return BankTransaction.create({
    fireflyJournalId: `${500 + seq}:0`,
    date: new Date(2026, 2, 3),
    amountCents: 1213,
    description: 'Rechnung',
    counterpartyName: 'Hoster GmbH',
    direction: 'out',
    ...over,
  });
}

describe('suppliers.overview', () => {
  it('counts the open rows each rule wins, skipping ignored and booked rows', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const hoster = await caller.suppliers.create({ name: 'Hoster', namePatterns: ['Hoster'], defaultAccount: '6837', defaultVatRate: 0.19 });
    const bank = await caller.suppliers.create({ name: 'Bank', purposePatterns: ['ABSCHLUSS PER'], defaultAccount: '6855', defaultVatRate: 0 });
    const idle = await caller.suppliers.create({ name: 'Idle', namePatterns: ['nobody'] });
    await bankTx();
    await bankTx({ description: 'ABSCHLUSS PER 30.09.2026', counterpartyName: 'Hoster GmbH' });
    await bankTx({ ignored: true });
    await bankTx({ date: new Date(2025, 5, 1) });
    const booked = await bankTx();
    await caller.bookings.book({ bankTxId: String(booked._id), account: '6837', vatRate: 0.19, mode: 'normal' });

    const rows = await caller.suppliers.overview({ year: 2026 });
    const hits = Object.fromEntries(rows.map((r) => [r.id, r.openHits]));
    // purpose beats name, so the ABSCHLUSS row goes to Bank although Hoster's name pattern matches too
    expect(hits).toEqual({ [String(hoster._id)]: 1, [String(bank._id)]: 1, [String(idle._id)]: 0 });
    expect(rows[0]).toMatchObject({ kreditorNumber: 70000, name: 'Hoster', namePatterns: ['Hoster'], defaultAccount: '6837', archived: false });
  });

  it('hides archived rules unless asked', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const s = await caller.suppliers.create({ name: 'Alt' });
    await caller.suppliers.setArchived({ id: String(s._id), archived: true });
    expect(await caller.suppliers.overview({ year: 2026 })).toEqual([]);
    expect(await caller.suppliers.overview({ year: 2026, includeArchived: true })).toHaveLength(1);
  });
});

describe('suppliers.importJson', () => {
  const rules = [
    { name: 'Hoster GmbH', namePatterns: ['Hoster'], defaultAccount: '6837', defaultVatRate: 0.19 },
    { name: 'Kontoführung', purposePatterns: ['ABSCHLUSS PER'], defaultAccount: '6855', defaultVatRate: 0 },
  ];

  it('dry run reports creates and writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await adminCaller().suppliers.importJson({ json: JSON.stringify(rules) });
    expect(res).toMatchObject({ errors: [], created: 2, updated: 0, unchanged: 0 });
    expect(res.items.map((i) => i.action)).toEqual(['create', 'create']);
    expect(await Supplier.countDocuments()).toBe(0);
  });

  it('applies, then matches by name (case-insensitive) or Kreditor number and is idempotent', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'hoster gmbh', ibans: ['DE02120300000000202051'] });
    const first = await caller.suppliers.importJson({ json: JSON.stringify(rules), dryRun: false });
    expect(first).toMatchObject({ created: 1, updated: 1, unchanged: 0 });
    const hoster = await Supplier.findOne({ kreditorNumber: 70000 });
    // fields missing from the JSON stay as they were
    expect(hoster).toMatchObject({ name: 'Hoster GmbH', namePatterns: ['Hoster'], defaultAccount: '6837', ibans: ['DE02120300000000202051'] });

    const again = await caller.suppliers.importJson({ json: JSON.stringify(rules), dryRun: false });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });

    const byNumber = await caller.suppliers.importJson({
      json: JSON.stringify([{ kreditorNumber: 70001, name: 'Bankgebühren', archived: true }]),
      dryRun: false,
    });
    expect(byNumber).toMatchObject({ updated: 1 });
    expect(await Supplier.findOne({ kreditorNumber: 70001 })).toMatchObject({ name: 'Bankgebühren', archived: true });
  });

  it('creates a given free Kreditor number and raises the counter past it', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.importJson({ json: JSON.stringify([{ kreditorNumber: 70042, name: 'Amt' }]), dryRun: false });
    expect((await caller.suppliers.create({ name: 'Neu' })).kreditorNumber).toBe(70043);
  });

  it('round-trips the export shape', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.importJson({ json: JSON.stringify(rules), dryRun: false });
    const exported = await caller.suppliers.exportJson();
    expect(exported[0]).toEqual({
      kreditorNumber: 70000,
      name: 'Hoster GmbH',
      ibans: [],
      namePatterns: ['Hoster'],
      purposePatterns: [],
      defaultAccount: '6837',
      defaultVatRate: 0.19,
      defaultMode: 'normal',
      archived: false,
    });
    const res = await caller.suppliers.importJson({ json: JSON.stringify(exported), dryRun: false });
    expect(res).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  });

  it('importJson round-trips defaultMode reverseCharge', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const rev = [{ name: 'Ausland Ltd', defaultAccount: '6837', defaultVatRate: 0.19, defaultMode: 'reverseCharge' }];
    await caller.suppliers.importJson({ json: JSON.stringify(rev), dryRun: false });
    const exported = await caller.suppliers.exportJson();
    expect(exported[0]).toMatchObject({ defaultMode: 'reverseCharge', defaultAccount: '6837' });
    const res = await caller.suppliers.importJson({ json: JSON.stringify(exported), dryRun: false });
    expect(res).toMatchObject({ created: 0, updated: 0, unchanged: 1 });
  });

  it('any error writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    expect((await caller.suppliers.importJson({ json: '{not json', dryRun: false })).errors[0]).toMatch(/JSON/);
    expect((await caller.suppliers.importJson({ json: '{}', dryRun: false })).errors[0]).toMatch(/Liste/);
    const bad = await caller.suppliers.importJson({
      json: JSON.stringify([...rules, { name: 'X', defaultAccount: '9999' }, { name: '' }, { name: 'hoster gmbh' }]),
      dryRun: false,
    });
    expect(bad.errors).toEqual([
      expect.stringMatching(/^Eintrag 3: .*9999/),
      expect.stringMatching(/^Eintrag 4: /),
      expect.stringMatching(/^Eintrag 5: .*doppelt/),
    ]);
    expect(await Supplier.countDocuments()).toBe(0);
  });
});
