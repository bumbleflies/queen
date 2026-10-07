export type FilingState = 'none' | 'pending' | 'filed' | 'failed';

export interface FilingStateInvoice {
  status: string;
  legacy?: boolean | null;
  driveMetadata?: { link?: string | null; failureReason?: string | null } | null;
}

/** Drive filing progress of an issued invoice (the PDF upload runs as a background job). */
export function filingState(invoice: FilingStateInvoice): FilingState {
  if (invoice.driveMetadata?.link) return 'filed';
  if (invoice.status === 'draft' || invoice.legacy) return 'none';
  if (invoice.driveMetadata?.failureReason) return 'failed';
  return 'pending';
}
