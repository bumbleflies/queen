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
