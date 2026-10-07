import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { Account } from '../../../models/Account';
import { Counter } from '../../../models/Counter';
import { FiscalYear } from '../../../models/FiscalYear';
import { JournalEntry } from '../../../models/JournalEntry';
import { seedAccounts } from '../seedAccounts';
import {
  LedgerError,
  validateLines,
  post,
  postOnce,
  reverse,
  type EntryDraft,
} from '../ledger';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

const draft = (over: Partial<EntryDraft> = {}): EntryDraft => ({
  date: new Date(2026, 2, 10),
  text: 'Test',
  lines: [
    { account: '1800', debitCents: 1000, creditCents: 0 },
    { account: '1200', debitCents: 0, creditCents: 1000 },
  ],
  source: { kind: 'manual' },
  createdBy: 'test',
  ...over,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([Account.init(), JournalEntry.init(), FiscalYear.init()]);
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.deleteMany({});
  await seedAccounts();
  await JournalEntry.collection.deleteMany({}); // bypasses the immutability guard
  await FiscalYear.deleteMany({});
  await Counter.deleteMany({ _id: /^journal:/ });
});

describe('validateLines (pure)', () => {
  const l = (account: string, debitCents: number, creditCents: number) => ({
    account,
    debitCents,
    creditCents,
  });
  it('accepts a balanced entry', () => {
    expect(() => validateLines([l('1800', 5, 0), l('1200', 0, 5)])).not.toThrow();
  });
  it.each([
    ['single line', [l('1800', 5, 0)], 'EMPTY'],
    ['unbalanced', [l('1800', 5, 0), l('1200', 0, 4)], 'UNBALANCED'],
    ['two-sided line', [l('1800', 5, 5), l('1200', 0, 0)], 'INVALID_AMOUNT'],
    ['negative', [l('1800', -5, 0), l('1200', 0, -5)], 'INVALID_AMOUNT'],
    ['fractional', [l('1800', 0.5, 0), l('1200', 0, 0.5)], 'INVALID_AMOUNT'],
  ])('rejects %s', (_name, lines, code) => {
    try {
      validateLines(lines);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError);
      expect((err as LedgerError).code).toBe(code);
    }
  });
});

describe('post', () => {
  it('allocates gapless numbers per fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    const a = await post(draft());
    const b = await post(draft());
    const c = await post(draft({ date: new Date(2027, 0, 2) }));
    expect([a.entryNumber, b.entryNumber, c.entryNumber]).toEqual([
      '2026-00001',
      '2026-00002',
      '2027-00001',
    ]);
    expect(a.fiscalYear).toBe(2026);
    expect(a.active).toBe(true);
    expect(await FiscalYear.findOne({ year: 2026 })).not.toBeNull();
  });

  it('rejects unknown and archived accounts', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(
      post(
        draft({
          lines: [
            { account: '9999', debitCents: 1, creditCents: 0 },
            { account: '1200', debitCents: 0, creditCents: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
    await Account.updateOne({ number: '1200' }, { archived: true });
    await expect(post(draft())).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
  });

  it('rejects postings into a closed fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'closed' });
    await expect(post(draft({ date: new Date(2025, 11, 31) }))).rejects.toMatchObject({
      code: 'YEAR_CLOSED',
    });
  });

  it('rejects a second active entry for the same source; postOnce returns the existing one', async (ctx) => {
    skipIfNoDb(ctx);
    const source = { kind: 'payment' as const, refId: 'bank:1:0' };
    const first = await post(draft({ source }));
    await expect(post(draft({ source }))).rejects.toMatchObject({ code: 'DUPLICATE' });
    const again = await postOnce(draft({ source }));
    expect(again.created).toBe(false);
    expect(String(again.entry._id)).toBe(String(first._id));
    expect(await JournalEntry.countDocuments()).toBe(1);
  });
});

describe('reverse', () => {
  it('posts a mirror entry, deactivates the original and frees the source', async (ctx) => {
    skipIfNoDb(ctx);
    const source = { kind: 'payment' as const, refId: 'bank:2:0' };
    const original = await post(draft({ source }));
    const { reversal } = await reverse(String(original._id), { reason: 'falsch', createdBy: 't' });
    expect(reversal.toObject().lines).toEqual([
      { account: '1800', debitCents: 0, creditCents: 1000 },
      { account: '1200', debitCents: 1000, creditCents: 0 },
    ]);
    expect(String(reversal.reverses)).toBe(String(original._id));
    const reloaded = await JournalEntry.findById(original._id);
    expect(reloaded?.active).toBe(false);
    expect(String(reloaded?.reversedBy)).toBe(String(reversal._id));
    const reposted = await postOnce(draft({ source }));
    expect(reposted.created).toBe(true);
  });

  it('refuses double reversal and reversing a reversal', async (ctx) => {
    skipIfNoDb(ctx);
    const original = await post(draft());
    const { reversal } = await reverse(String(original._id), { reason: 'x', createdBy: 't' });
    await expect(
      reverse(String(original._id), { reason: 'x', createdBy: 't' }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    await expect(
      reverse(String(reversal._id), { reason: 'x', createdBy: 't' }),
    ).rejects.toMatchObject({ code: 'NOT_REVERSIBLE' });
  });
});

describe('immutability', () => {
  it('rejects edits and deletes of posted entries', async (ctx) => {
    skipIfNoDb(ctx);
    const entry = await post(draft());
    entry.text = 'changed';
    await expect(entry.save()).rejects.toThrowError(/immutable/);
    await expect(JournalEntry.deleteMany({})).rejects.toThrowError(/immutable/);
    await expect(JournalEntry.updateOne({}, { text: 'x' })).rejects.toThrowError(/immutable/);
  });
});
