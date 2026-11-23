import type { DictKey } from '../i18n/de';

/** The five states a claim can be in (see `models/ExpenseClaim`). */
export type ClaimStatus = 'received' | 'booked' | 'payoutPending' | 'settled' | 'ignored';

const STATUS_KEY: Record<ClaimStatus, DictKey> = {
  received: 'expenses.status.received',
  booked: 'expenses.status.booked',
  payoutPending: 'expenses.status.payoutPending',
  settled: 'expenses.status.settled',
  ignored: 'expenses.status.ignored',
};

/** Badge classes that already exist in the theme (`index.css`). */
const STATUS_CLASS: Record<ClaimStatus, string> = {
  received: 'b-draft',
  booked: 'b-sent',
  payoutPending: 'b-part',
  settled: 'b-paid',
  ignored: 'b-cancel',
};

export function claimStatusKey(status: string): DictKey {
  return STATUS_KEY[status as ClaimStatus] ?? 'expenses.status.received';
}

export function claimStatusClass(status: string): string {
  return STATUS_CLASS[status as ClaimStatus] ?? 'b-draft';
}

/** Payout states use the same badge vocabulary as claims. */
export type PayoutStatus = 'draft' | 'released' | 'executed' | 'settled' | 'canceled';

const PAYOUT_STATUS_KEY: Record<PayoutStatus, DictKey> = {
  draft: 'payout.status.draft',
  released: 'payout.status.released',
  executed: 'payout.status.executed',
  settled: 'payout.status.settled',
  canceled: 'payout.status.canceled',
};

const PAYOUT_STATUS_CLASS: Record<PayoutStatus, string> = {
  draft: 'b-draft',
  released: 'b-sent',
  executed: 'b-part',
  settled: 'b-paid',
  canceled: 'b-cancel',
};

export function payoutStatusKey(status: string): DictKey {
  return PAYOUT_STATUS_KEY[status as PayoutStatus] ?? 'payout.status.draft';
}

export function payoutStatusClass(status: string): string {
  return PAYOUT_STATUS_CLASS[status as PayoutStatus] ?? 'b-draft';
}
