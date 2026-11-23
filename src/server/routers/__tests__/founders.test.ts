import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Founder } from '../../models/Founder';
import { appRouter } from '../../trpc';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

beforeAll(async () => {
  await initLedgerModels();
  if (mongoose.connection.readyState === 1) await Founder.init();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Founder.deleteMany({});
});

describe('founders', () => {
  it('creates a founder with normalized emails and IBAN', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const created = await caller.founders.create({
      name: 'Test Person',
      shortName: 'TP',
      emails: [' TP@Example.org ', 'tp@work.example'],
      loginEmail: 'tp@bumbleflies.de',
      iban: 'de89 3704 0044 0532 0130 00',
      liabilityAccount: '3500',
    });
    expect(created.emails).toEqual(['tp@example.org', 'tp@work.example']);
    expect(created.loginEmail).toBe('tp@bumbleflies.de');
    expect(created.iban).toBe('DE89370400440532013000');
  });

  it('requires a bumbleflies login address for approvals', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await expect(
      caller.founders.create({ name: 'A', shortName: 'A', emails: ['a@example.org'], loginEmail: 'a@gmail.com', iban: 'DE89370400440532013000' }),
    ).rejects.toThrowError(/bumbleflies/i);
  });

  it('rejects a duplicate email across founders', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.founders.create({ name: 'A', shortName: 'A', emails: ['x@example.org'], loginEmail: 'a@bumbleflies.de', iban: 'DE89370400440532013000' });
    await expect(
      caller.founders.create({ name: 'B', shortName: 'B', emails: ['x@example.org'], loginEmail: 'b@bumbleflies.de', iban: 'DE12500105170648489890' }),
    ).rejects.toThrowError(/bereits/i);
  });

  it('archives instead of deleting', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const f = await caller.founders.create({ name: 'A', shortName: 'A', emails: ['a@example.org'], loginEmail: 'a@bumbleflies.de', iban: 'DE89370400440532013000' });
    await caller.founders.setActive({ id: f.id, active: false });
    expect(await Founder.countDocuments()).toBe(1);
    expect((await Founder.findById(f.id))?.active).toBe(false);
  });

  it('is admin-only', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = appRouter.createCaller({ user: { sub: 'u', email: 'u@example.org', role: 'user' }, serviceAuth: false });
    await expect(caller.founders.list()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('adds an address to an existing founder without duplicating it', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const f = await caller.founders.create({ name: 'A', shortName: 'A', emails: ['a@example.org'], loginEmail: 'a@bumbleflies.de', iban: 'DE89370400440532013000' });
    const first = await caller.founders.addEmail({ id: f.id, email: ' A2@Example.org ' });
    expect(first.emails).toEqual(['a@example.org', 'a2@example.org']);
    const again = await caller.founders.addEmail({ id: f.id, email: 'a2@example.org' });
    expect(again.emails).toEqual(['a@example.org', 'a2@example.org']);
  });
});
