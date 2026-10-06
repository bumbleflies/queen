/**
 * Filing queue. `enqueueFileInvoice` is a replaceable `let` binding (no-op by
 * default) so tests can `vi.mock` this module and `initFileInvoiceQueue` can
 * swap in the Bull implementation at startup.
 *
 * Importing this module performs no I/O: the Redis connection is only opened
 * when `createBullQueue()` / `initFileInvoiceQueue()` is called.
 */
import Bull, { type Queue } from 'bull';
import { processFileInvoice } from './FileInvoiceJob';

const QUEUE_NAME = 'file-invoice';

export let enqueueFileInvoice: (invoiceId: string) => Promise<void> = async (
  _invoiceId: string,
): Promise<void> => {
  // no-op until initFileInvoiceQueue wires Bull/valkey.
};

/** Replace the default no-op implementation. */
export function setEnqueueFileInvoice(fn: (invoiceId: string) => Promise<void>): void {
  enqueueFileInvoice = fn;
}

/** Build (but do not start) the Bull queue backed by valkey/redis. */
export function createBullQueue(): Queue {
  const url = process.env.REDIS_URL ?? process.env.VALKEY_URL;
  if (!url) {
    throw new Error('REDIS_URL or VALKEY_URL must be set to start the file-invoice queue');
  }
  return new Bull(QUEUE_NAME, { redis: url });
}

/**
 * Start processing filing jobs and route `enqueueFileInvoice` through Bull.
 * Call once at server startup (not at import time).
 */
export function initFileInvoiceQueue(): Queue {
  const queue = createBullQueue();
  queue.process(async (job) => {
    await processFileInvoice(job.data.invoiceId as string);
  });
  setEnqueueFileInvoice(async (invoiceId: string) => {
    await queue.add({ invoiceId });
  });
  return queue;
}
