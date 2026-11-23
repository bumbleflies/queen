import { ExpenseClaim } from '../../models/ExpenseClaim';
import { Founder } from '../../models/Founder';
import { JournalEntry, type JournalEntryDoc } from '../../models/JournalEntry';
import { claimFieldsOf } from '../expenses/claimFields';
import { postOnce, reverse } from './ledger';
import { expenseClaimPosting } from './postingRules';

export type ClaimErrorCode = 'NOT_FOUND' | 'STATE' | 'NO_FOUNDER' | 'INCOMPLETE';

export class ClaimError extends Error {
  readonly code: ClaimErrorCode;

  constructor(code: ClaimErrorCode, message: string) {
    super(message);
    this.name = 'ClaimError';
    this.code = code;
  }
}

/** Who booked it when the intake did it itself. */
export const AUTO_BOOK_ACTOR = 'auto:expense-intake';

/**
 * Book a received claim against the founder's liability account.
 *
 * Idempotent: a claim that is already booked with a live entry returns that
 * entry, so a retried intake (or a double click) never posts twice. The expense
 * never touches the bank — the founder paid, so the counterparty is the founder.
 */
export async function bookExpenseClaim(args: {
  claimId: string;
  actor: string;
}): Promise<JournalEntryDoc> {
  const claim = await ExpenseClaim.findById(args.claimId);
  if (!claim) throw new ClaimError('NOT_FOUND', 'Beleg nicht gefunden');

  if (claim.status === 'booked') {
    const existing = claim.journalEntryId
      ? await JournalEntry.findById(claim.journalEntryId)
      : null;
    if (existing?.active) return existing;
  }
  if (claim.status !== 'received') throw new ClaimError('STATE', 'Beleg ist bereits gebucht');

  const founder = claim.founderId ? await Founder.findById(claim.founderId) : null;
  if (!founder) throw new ClaimError('NO_FOUNDER', 'Kein Gesellschafter zugeordnet');

  const fields = claimFieldsOf(claim);
  if (!fields || fields.grossCents == null || !fields.account) {
    throw new ClaimError('INCOMPLETE', 'Betrag oder Konto fehlt');
  }

  const vatCents = fields.vatCents ?? 0;
  const vatDeductible = !!fields.addressedToCompany && vatCents > 0;
  const lines = expenseClaimPosting({
    grossCents: fields.grossCents,
    netCents: fields.netCents ?? fields.grossCents,
    vatCents,
    vatRate: fields.vatRate ?? 0,
    account: fields.account,
    liabilityAccount: founder.liabilityAccount || '3500',
    vatDeductible,
    reverseCharge: !!fields.reverseCharge,
  });

  const { entry } = await postOnce({
    date: fields.date ?? claim.receivedAt,
    text: `Spesen ${founder.shortName} ${fields.vendorName}`.trim(),
    lines,
    source: { kind: 'expense_claim', refId: String(claim._id) },
    createdBy: args.actor,
  });

  claim.status = 'booked';
  claim.journalEntryId = entry._id;
  await claim.save();
  return entry;
}

/**
 * GoBD correction: reverse the live entry and book the claim again from its
 * current fields (the correction wins over the read). The old entry stays as
 * history; the claim keeps the ids it retired in `reversedEntryIds`.
 */
export async function rebookExpenseClaim(args: {
  claimId: string;
  actor: string;
}): Promise<JournalEntryDoc> {
  const claim = await ExpenseClaim.findById(args.claimId);
  if (!claim) throw new ClaimError('NOT_FOUND', 'Beleg nicht gefunden');
  if (claim.status !== 'booked') throw new ClaimError('STATE', 'Beleg ist nicht gebucht');

  const old = claim.journalEntryId ? await JournalEntry.findById(claim.journalEntryId) : null;
  if (!old?.active) throw new ClaimError('STATE', 'Kein aktiver Journaleintrag');

  await reverse(String(old._id), { reason: 'Spesen-Korrektur', createdBy: args.actor });
  claim.reversedEntryIds.push(old._id);
  claim.status = 'received';
  await claim.save();
  return bookExpenseClaim(args);
}
