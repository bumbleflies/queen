import { Counter } from '../models/Counter';

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Allocate the next invoice number '<YYYYMMDD>-<NN>' for the given date via a
 * single atomic Counter findOneAndUpdate ($inc, upsert) — concurrency-safe,
 * no read-then-write. NN is the zero-padded 2-digit sequence.
 */
export async function allocateInvoiceNumber(date: Date): Promise<string> {
  const stamp = yyyymmdd(date);
  const doc = await Counter.findOneAndUpdate(
    { _id: `invoice:${stamp}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  const seq = doc?.seq ?? 1;
  return `${stamp}-${String(seq).padStart(2, '0')}`;
}

/**
 * Allocate the next customer number via a single atomic Counter $inc —
 * concurrency-safe, no read-then-write.
 */
export async function allocateCustomerNumber(): Promise<number> {
  const doc = await Counter.findOneAndUpdate(
    { _id: 'customer' },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return doc?.seq ?? 1;
}
