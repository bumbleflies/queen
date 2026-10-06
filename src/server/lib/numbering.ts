import { Counter } from '../models/Counter';
import type { CounterDoc } from '../models/Counter';

/** Narrow model surface used by numbering (lets tests inject a stub). */
export type CounterModelLike = {
  findOneAndUpdate(
    filter: { _id: string },
    update: { $inc: { seq: 1 } },
    options: { upsert: true; new: true },
  ): { lean(): Promise<CounterDoc | null> };
};

const defaultCounterModel = Counter as unknown as CounterModelLike;

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
export async function allocateInvoiceNumber(
  date: Date,
  counterModel: CounterModelLike = defaultCounterModel,
): Promise<string> {
  const stamp = yyyymmdd(date);
  const doc = await counterModel
    .findOneAndUpdate(
      { _id: `invoice:${stamp}` },
      { $inc: { seq: 1 } },
      { upsert: true, new: true },
    )
    .lean();
  const seq = doc?.seq ?? 1;
  return `${stamp}-${String(seq).padStart(2, '0')}`;
}

/**
 * Allocate the next customer number via a single atomic Counter $inc —
 * concurrency-safe, no read-then-write.
 */
export async function allocateCustomerNumber(
  counterModel: CounterModelLike = defaultCounterModel,
): Promise<number> {
  const doc = await counterModel
    .findOneAndUpdate({ _id: 'customer' }, { $inc: { seq: 1 } }, { upsert: true, new: true })
    .lean();
  return doc?.seq ?? 1;
}
