import { Counter } from '../../models/Counter';

/**
 * Gapless per-year payout reference. The counter is incremented atomically so a
 * double click cannot hand out the same `SP-<year>-<NNNN>` twice.
 */
export async function nextPayoutNumber(year: number): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `payout:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  return `SP-${year}-${String(doc?.seq ?? 1).padStart(4, '0')}`;
}
