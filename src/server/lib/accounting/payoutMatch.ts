import { BankTransaction } from '../../models/BankTransaction';
import { Founder } from '../../models/Founder';
import { Payout } from '../../models/Payout';
import { findCoverage, settlePayout } from './bankBooking';

/** A distributed payout is never a dividend — that never settles a Spesen liability. */
const DIVIDEND = /gewinnausschüttung|gewinnausschuettung|ausschüttung/i;
const REFERENCE = /SP-\d{4}-\d{4}/i;
const SPESEN = /\bspesen\b/i;

export interface PayoutTx {
  description: string;
  amountCents: number;
  counterpartyIban?: string | null;
}

export interface PayoutCandidate {
  payout: {
    _id: unknown;
    number: string;
    amountCents: number;
    status?: string;
  };
  founder: {
    iban: string;
    shortName: string;
    name: string;
  };
}

export type PayoutMatchMethod = 'reference' | 'iban+amount' | 'legacy';

export interface PayoutMatch {
  payout: PayoutCandidate['payout'];
  method: PayoutMatchMethod;
}

function sameIban(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\s+/g, '').toUpperCase() === b.replace(/\s+/g, '').toUpperCase();
}

function hasName(purpose: string, founder: PayoutCandidate['founder']): boolean {
  const lower = purpose.toLowerCase();
  return [founder.shortName, founder.name]
    .filter(Boolean)
    .some((name) => lower.includes(String(name).toLowerCase()));
}

function isLegacy(purpose: string, founder: PayoutCandidate['founder']): boolean {
  return SPESEN.test(purpose) && hasName(purpose, founder);
}

/**
 * Match one bank row to at most one open payout. Exact amounts are required in
 * every branch — a partial payment or a dividend never settles the liability.
 * Ties are refused rather than guessed.
 */
export function matchPayout(tx: PayoutTx, candidates: PayoutCandidate[]): PayoutMatch | null {
  const purpose = tx.description ?? '';
  if (DIVIDEND.test(purpose)) return null;

  // 1. Structured reference in the Verwendungszweck (bank-inserted spaces are fine).
  const reference = purpose.replace(/\s+/g, '').match(REFERENCE)?.[0]?.toUpperCase();
  if (reference) {
    const byReference = candidates.filter(
      (candidate) => candidate.payout.number.toUpperCase() === reference,
    );
    if (byReference.length !== 1) return null;
    const found = byReference[0];
    return tx.amountCents === found.payout.amountCents
      ? { payout: found.payout, method: 'reference' }
      : null;
  }

  // 2/3. IBAN + exact amount; the purpose decides whether this is a legacy
  // "Spesen <name>" transfer or a plain reimbursement.
  const byIban = candidates.filter(
    (candidate) =>
      sameIban(tx.counterpartyIban, candidate.founder.iban) &&
      tx.amountCents === candidate.payout.amountCents,
  );
  if (byIban.length !== 1) return null; // exactly one candidate, never a tie
  const found = byIban[0];
  return {
    payout: found.payout,
    method: isLegacy(purpose, found.founder) ? 'legacy' : 'iban+amount',
  };
}

/**
 * A payout reference with the wrong amount: kept open, reported as a warning on
 * the reconcile run so an admin can look at the bank row.
 */
export function payoutReferenceMismatch(
  tx: PayoutTx,
  candidates: PayoutCandidate[],
): PayoutCandidate | null {
  const purpose = tx.description ?? '';
  if (DIVIDEND.test(purpose)) return null;
  const reference = purpose.replace(/\s+/g, '').match(REFERENCE)?.[0]?.toUpperCase();
  if (!reference) return null;
  return (
    candidates.find(
      (candidate) =>
        candidate.payout.number.toUpperCase() === reference &&
        tx.amountCents !== candidate.payout.amountCents,
    ) ?? null
  );
}

export interface MatchPayoutsResult {
  settled: number;
  warnings: string[];
}

/** Reconcile step: settle every open outgoing row that identifies one payout. */
export async function matchPayouts(): Promise<MatchPayoutsResult> {
  const result: MatchPayoutsResult = { settled: 0, warnings: [] };
  const [payouts, founders, txs] = await Promise.all([
    Payout.find({ status: { $in: ['released', 'executed'] } }),
    Founder.find({ active: true }),
    BankTransaction.find({
      payoutId: { $exists: false },
      direction: 'out',
      ignored: { $ne: true },
    }).sort({ date: 1 }),
  ]);
  if (payouts.length === 0) return result;

  const founderById = new Map(founders.map((founder) => [String(founder._id), founder]));
  const open: PayoutCandidate[] = payouts.flatMap((payout) => {
    const founder = founderById.get(String(payout.founderId));
    return founder?.iban ? [{ payout, founder }] : [];
  });
  if (open.length === 0) return result;

  for (const tx of txs) {
    if (tx.matchedInvoiceId || (await findCoverage(tx.fireflyJournalId))) continue;
    const mismatch = payoutReferenceMismatch(tx, open);
    if (mismatch) {
      result.warnings.push(
        `Auszahlung ${mismatch.payout.number}: Bankbetrag ${tx.amountCents} weicht vom Soll ${mismatch.payout.amountCents} ab`,
      );
      continue;
    }
    const match = matchPayout(tx, open);
    if (!match) continue;
    // One bank row settles one payout; a second row with the same reference is
    // left alone because the payout is no longer in `open`.
    open.splice(open.findIndex((candidate) => candidate.payout === match.payout), 1);
    try {
      const payout = await Payout.findById(match.payout._id);
      if (!payout) continue;
      await settlePayout({ payout, tx, actor: 'auto:reconcile' });
      result.settled += 1;
    } catch (err) {
      result.warnings.push(`Auszahlung ${match.payout.number}: ${(err as Error).message}`);
    }
  }
  return result;
}
