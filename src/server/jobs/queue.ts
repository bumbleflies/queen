/**
 * Filing queue stub (Task 4). The real Bull/valkey wiring lands in Task 5.
 *
 * `enqueueFileInvoice` is a replaceable `let` binding (no-op by default) so
 * tests can `vi.mock` this module (named export on the module object) and
 * production code in Task 5 can swap in the Bull implementation.
 */
export let enqueueFileInvoice: (invoiceId: string) => Promise<void> = async (
  _invoiceId: string,
): Promise<void> => {
  // no-op until Task 5 wires Bull/valkey.
};

/** Replace the default no-op implementation (used by Task 5; tests use vi.mock). */
export function setEnqueueFileInvoice(fn: (invoiceId: string) => Promise<void>): void {
  enqueueFileInvoice = fn;
}
