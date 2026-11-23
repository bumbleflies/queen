import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { nextPayoutNumber } from '../numbering';
import { Counter } from '../../../models/Counter';

/** DB tests skip when no mongod is available (CI runs them with one). */
function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Counter.deleteMany({ _id: { $in: ['payout:2026', 'payout:2027'] } });
});

describe('nextPayoutNumber', () => {
  it('allocates gapless numbers within a year', async (ctx) => {
    skipIfNoDb(ctx);
    expect(await nextPayoutNumber(2026)).toBe('SP-2026-0001');
    expect(await nextPayoutNumber(2026)).toBe('SP-2026-0002');
  });

  it('restarts at 0001 in a new year', async (ctx) => {
    skipIfNoDb(ctx);
    await nextPayoutNumber(2026);
    await nextPayoutNumber(2026);
    expect(await nextPayoutNumber(2027)).toBe('SP-2027-0001');
  });

  it('is atomic under concurrent calls', async (ctx) => {
    skipIfNoDb(ctx);
    const numbers = await Promise.all([
      nextPayoutNumber(2026),
      nextPayoutNumber(2026),
      nextPayoutNumber(2026),
    ]);
    expect(numbers.sort()).toEqual(['SP-2026-0001', 'SP-2026-0002', 'SP-2026-0003']);
  });
});
