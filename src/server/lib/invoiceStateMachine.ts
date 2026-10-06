import { TRPCError } from '@trpc/server';

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'canceled';
export type InvoiceAction = 'update' | 'setLines' | 'delete' | 'markSent' | 'markPaid' | 'cancel';

const matrix: Record<InvoiceStatus, Record<InvoiceAction, boolean>> = {
  draft: { update: true, setLines: true, delete: true, markSent: true, markPaid: false, cancel: false },
  sent: { update: false, setLines: false, delete: false, markSent: false, markPaid: true, cancel: true },
  paid: { update: false, setLines: false, delete: false, markSent: false, markPaid: false, cancel: false },
  canceled: { update: false, setLines: false, delete: false, markSent: false, markPaid: false, cancel: false },
};

/** Pure function, no DB: whether an action is allowed from a status. */
export function canTransition(status: InvoiceStatus, action: InvoiceAction): boolean {
  return matrix[status][action] ?? false;
}

/** Throw a BAD_REQUEST TRPCError naming the action when the transition is disallowed. */
export function assertTransition(status: InvoiceStatus, action: InvoiceAction): void {
  if (canTransition(status, action)) return;
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: `Action '${action}' not allowed on invoice with status '${status}'. Only draft invoices can be updated, have lines set, be deleted or marked sent.`,
  });
}
