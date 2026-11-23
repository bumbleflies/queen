import { ExpenseClaim } from '../../models/ExpenseClaim';
import { normalizeIban, normalizeVendor } from '../accounting/normalize';

export interface AccountSuggestion {
  account: string;
  /** Only history for now; a receipt reader can become a second source later. */
  source: 'history';
  /** Date of the newest matching receipt, for the review tooltip. */
  lastDate: Date | null;
}

/** How many earlier claims the suggestion is allowed to look at. */
export const HISTORY_SIZE = 3;
/** How far back to scan before filtering by IBAN/vendor (cheap, bounded). */
const SCAN_LIMIT = 50;

/**
 * The expense account an earlier claim with the same vendor booked to.
 *
 * Same normalized IBAN (as the PDF read it) or the same vendor name, over the
 * last `HISTORY_SIZE` booked or settled claims. If those disagree, there is no
 * suggestion: guessing an account is worse than asking an admin. No LLM here.
 */
export async function suggestAccount(input: {
  iban?: string;
  vendorName?: string;
}): Promise<AccountSuggestion | null> {
  const iban = normalizeIban(input.iban ?? '');
  const vendor = normalizeVendor(input.vendorName ?? '');
  if (!iban && !vendor) return null;

  const claims = await ExpenseClaim.find({ status: { $in: ['booked', 'settled'] } })
    .sort({ receivedAt: -1 })
    .limit(SCAN_LIMIT)
    .lean();

  const matches = claims
    .filter((claim) => {
      const parse = claim.parse;
      if (!parse?.account) return false;
      const sameIban = iban !== '' && normalizeIban(parse.iban ?? '') === iban;
      const sameVendor = vendor !== '' && normalizeVendor(parse.vendorName) === vendor;
      return sameIban || sameVendor;
    })
    .slice(0, HISTORY_SIZE);

  if (matches.length === 0) return null;
  const accounts = new Set(matches.map((claim) => claim.parse!.account!));
  if (accounts.size !== 1) return null;

  const dates = matches
    .map((claim) => claim.parse?.date ?? claim.receivedAt)
    .filter((date): date is Date => date instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime());

  return {
    account: [...accounts][0],
    source: 'history',
    lastDate: dates[0] ?? null,
  };
}
