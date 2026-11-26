import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Founder } from '../../../models/Founder';
import { applyFounderImport, parseFounderJson } from '../founderImport';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../../routers/__tests__/helpers/ledgerFixtures';

const ROW = {
  name: 'Test Person',
  shortName: 'TP',
  emails: [' TP@Example.org ', 'work@example.org'],
  loginEmail: 'TP@bumbleflies.de',
  iban: 'de89 3704 0044 0532 0130 00',
};
const json = (...rows: unknown[]) => JSON.stringify(rows);

beforeAll(async () => {
  await initLedgerModels();
  if (mongoose.connection.readyState === 1) await Founder.init();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Founder.deleteMany({});
});

describe('parseFounderJson', () => {
  it('reports German errors for malformed JSON', () => {
    const bad = parseFounderJson('{');
    expect(bad.errors[0]).toMatch(/Kein gültiges JSON/);

    const notList = parseFounderJson('{}');
    expect(notList.errors).toEqual(['JSON muss eine Liste von Gesellschaftern sein']);

    const rows = parseFounderJson(json({ ...ROW, loginEmail: 'tp@gmail.com' }));
    expect(rows.errors[0]).toMatch(/Eintrag 1.*bumbleflies/i);
  });
});

describe('applyFounderImport', () => {
  it('dry run reports creates without writing', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await applyFounderImport(json(ROW), true, 'admin-id');
    expect(res.created).toBe(1);
    expect(res.errors).toEqual([]);
    expect(await Founder.countDocuments()).toBe(0);
  });

  it('creates normalized founders and a re-import is unchanged', async (ctx) => {
    skipIfNoDb(ctx);
    const first = await applyFounderImport(json(ROW), false, 'admin-id');
    expect(first.errors).toEqual([]);
    const stored = await Founder.findOne({ loginEmail: 'tp@bumbleflies.de' }).lean();
    expect(stored?.emails).toEqual(['tp@example.org', 'work@example.org']);
    expect(stored?.iban).toBe('DE89370400440532013000');
    expect(stored?.shortName).toBe('TP');
    expect(stored?.active).toBe(true);
    expect(stored?.liabilityAccount).toBe('3500');
    expect(stored?.createdBy).toBe('admin-id');

    const again = await applyFounderImport(json(ROW), false, 'admin-id');
    expect(again.unchanged).toBe(1);
    expect(again.created).toBe(0);
    expect(await Founder.countDocuments()).toBe(1);
  });

  it('updates only supplied fields on an existing founder', async (ctx) => {
    skipIfNoDb(ctx);
    await applyFounderImport(json(ROW), false, 'admin-id');
    const res = await applyFounderImport(
      json({ loginEmail: 'tp@bumbleflies.de', emails: ['new@example.org'], active: false }),
      false,
      'admin-id',
    );
    expect(res.updated).toBe(1);
    const stored = await Founder.findOne({ loginEmail: 'tp@bumbleflies.de' }).lean();
    expect(stored?.emails).toEqual(['new@example.org']);
    expect(stored?.active).toBe(false);
    expect(stored?.name).toBe('Test Person');
    expect(stored?.iban).toBe('DE89370400440532013000');
  });

  it('writes nothing when one row conflicts with another', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await applyFounderImport(
      json(ROW, { ...ROW, name: 'Other Person', shortName: 'OP', loginEmail: 'other@bumbleflies.de' }),
      false,
      'admin-id',
    );
    expect(res.errors.some((e) => /bereits/i.test(e))).toBe(true);
    expect(await Founder.countDocuments()).toBe(0);
  });

  it('writes nothing when a row points at two different existing founders', async (ctx) => {
    skipIfNoDb(ctx);
    await Founder.create({
      name: 'A', shortName: 'A', emails: ['a@example.org'], loginEmail: 'a@bumbleflies.de',
      iban: 'DE89370400440532013000', createdBy: 'seed',
    });
    await Founder.create({
      name: 'B', shortName: 'B', emails: ['b@example.org'], loginEmail: 'b@bumbleflies.de',
      iban: 'DE12500105170648489890', createdBy: 'seed',
    });
    const res = await applyFounderImport(
      json({ name: 'B', shortName: 'B', emails: ['a@example.org'], loginEmail: 'b@bumbleflies.de', iban: 'DE12500105170648489890' }),
      false,
      'admin-id',
    );
    expect(res.errors.some((e) => /Eintrag 1/.test(e))).toBe(true);
    expect((await Founder.findOne({ loginEmail: 'b@bumbleflies.de' }).lean())?.name).toBe('B');
  });

  it('rejects an unknown liability account', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await applyFounderImport(json({ ...ROW, liabilityAccount: '9999' }), false, 'admin-id');
    expect(res.errors.some((e) => /Konto/.test(e))).toBe(true);
    expect(await Founder.countDocuments()).toBe(0);
  });
});
