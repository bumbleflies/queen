import { Founder } from '../../models/Founder';
import { normalizeIban } from './normalize';

/**
 * Founder payout targets are never supplier rules. This module is
 * server-only: `ruleLearning.ts` must stay browser-safe because the client
 * imports `purposePrefix` from it.
 */

/** Active founder payout targets, normalized once per caller run. */
export async function activeFounderIbans(): Promise<string[]> {
  const founders = await Founder.find({ active: true }).select('iban').lean();
  return founders.flatMap((founder) => (founder.iban ? [normalizeIban(founder.iban)] : []));
}

/** Guard for the call sites of `learningKey`/`suggest`: founders are not suppliers. */
export function isFounderIban(
  founderIbans: Iterable<string>,
  counterpartyIban?: string | null,
): boolean {
  if (!counterpartyIban) return false;
  const iban = normalizeIban(counterpartyIban);
  for (const founderIban of founderIbans) {
    if (normalizeIban(founderIban) === iban) return true;
  }
  return false;
}
