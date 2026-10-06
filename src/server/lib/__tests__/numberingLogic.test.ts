import { describe, it, expect } from 'vitest';
import {
  allocateInvoiceNumber,
  allocateCustomerNumber,
  type CounterModelLike,
} from '../numbering';

/**
 * No-DB numbering logic tests: stub Counter.findOneAndUpdate to emulate the
 * atomic $inc (in-memory seq per _id, incremented synchronously so concurrent
 * callers get distinct seqs). No mongoose import/connection here.
 */
function createStubCounter(initial: Record<string, number> = {}): CounterModelLike {
  const seqs = new Map<string, number>(Object.entries(initial));
  return {
    findOneAndUpdate(filter, update) {
      const next = (seqs.get(filter._id) ?? 0) + update.$inc.seq;
      seqs.set(filter._id, next);
      return { lean: () => Promise.resolve({ _id: filter._id, seq: next }) };
    },
  };
}

describe('allocateInvoiceNumber (stubbed Counter, no DB)', () => {
  it('allocates distinct numbers concurrently for the same date', async () => {
    const stub = createStubCounter();
    const date = new Date(2023, 4, 11); // 2023-05-11 local = draft-creation date
    const [a, b] = await Promise.all([
      allocateInvoiceNumber(date, stub),
      allocateInvoiceNumber(date, stub),
    ]);
    expect([a, b].sort()).toEqual(['20230511-01', '20230511-02']);
  });

  it('continues after imported max (preset seq 5 → -06)', async () => {
    const stub = createStubCounter({ 'invoice:20230511': 5 });
    await expect(allocateInvoiceNumber(new Date(2023, 4, 11), stub)).resolves.toBe(
      '20230511-06',
    );
  });

  it('uses the draft-creation date passed in, NN zero-padded 2-digit', async () => {
    const stub = createStubCounter();
    await expect(allocateInvoiceNumber(new Date(2026, 9, 6), stub)).resolves.toBe(
      '20261006-01',
    );
    await expect(allocateInvoiceNumber(new Date(2026, 9, 6), stub)).resolves.toBe(
      '20261006-02',
    );
  });
});

describe('allocateCustomerNumber (stubbed Counter, no DB)', () => {
  it('increments on each call', async () => {
    const stub = createStubCounter();
    const a = await allocateCustomerNumber(stub);
    const b = await allocateCustomerNumber(stub);
    expect(b).toBe(a + 1);
  });
});
