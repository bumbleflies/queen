import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { allocateInvoiceNumber, allocateCustomerNumber } from '../numbering';
import { Counter } from '../../models/Counter';

/** In-memory Mongo is unavailable on some runtimes (e.g. Alpine, where
 *  mongodb-memory-server has no runnable mongod build); setupServer.ts then
 *  warns and continues with no connection. Skip DB tests in that case —
 *  they run fully wherever Mongo is available (CI). */
function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}

function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Counter.deleteMany({});
});

describe('allocateInvoiceNumber', () => {
  it('allocates distinct numbers concurrently for the same date', async (ctx) => {
    skipIfNoDb(ctx);
    const date = new Date(2023, 4, 11); // 2023-05-11 local
    const [a, b] = await Promise.all([
      allocateInvoiceNumber(date),
      allocateInvoiceNumber(date),
    ]);
    const sorted = [a, b].sort();
    expect(sorted).toEqual(['20230511-01', '20230511-02']);
  });

  it('continues after imported max (preset Counter seq)', async (ctx) => {
    skipIfNoDb(ctx);
    const date = new Date(2023, 4, 11);
    await Counter.create({ _id: 'invoice:20230511', seq: 5 });
    expect(await allocateInvoiceNumber(date)).toBe('20230511-06');
  });
});

describe('allocateCustomerNumber', () => {
  it('increments on each call', async (ctx) => {
    skipIfNoDb(ctx);
    const a = await allocateCustomerNumber();
    const b = await allocateCustomerNumber();
    expect(b).toBe(a + 1);
  });
});
