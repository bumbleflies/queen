import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { ReconcileRun, type ReconcileRunDoc } from '../models/ReconcileRun';
import { FireflyClient, type FireflyTransaction } from '../services/FireflyClient';
import { computeSyncWindow, syncBankTransactions } from '../lib/bankSync';
import { isCliEntrypoint, reconcilePendingTransactions } from '../lib/reconcile';
import { findLastSuccessfulRun, readFireflyEnv } from '../lib/fireflyEnv';
import { autoBookOpen, type AutoBookResult } from '../lib/accounting/autoBook';
import { readOpenReceipts } from '../services/receiptReader';

export interface TransactionSource {
  fetchTransactions(start: Date, end: Date): Promise<FireflyTransaction[]>;
}

export interface RunReconcileOptions {
  now?: Date;
  /** Skip the Firefly sync and only (re)match what is already in Mongo. */
  skipSync?: boolean;
  /** Inject a Firefly client (tests); otherwise built from env. */
  client?: TransactionSource;
  bankStart?: Date;
  /** Read open receipts with opencode (slow); the cron entrypoint does, `reconcile.runNow` does not. Default true. */
  readReceipts?: boolean;
}

/**
 * One reconcile pass: sync GLS transactions into `BankTransaction` (idempotent),
 * then match every fresh transaction against invoices, then book what rules
 * flagged `autoBook` recognise (failures there only warn), then read up to 10
 * receipts of open rows without a suggestion (never booked; trouble is ignored;
 * skipped with `readReceipts: false`). Errors are recorded on
 * the `ReconcileRun` and returned; the CLI inspects `run.error` to exit non-zero.
 * Shared by the Ofelia cron entrypoint and `reconcile.runNow`.
 */
export async function runReconcile(
  options: RunReconcileOptions = {},
): Promise<ReconcileRunDoc> {
  const now = options.now ?? new Date();
  const run = await ReconcileRun.create({ startedAt: now });

  try {
    let fetched = 0;

    if (!options.skipSync) {
      const source = options.client
        ? { client: options.client, bankStart: options.bankStart ?? new Date(0) }
        : (() => {
            const { baseUrl, pat, glsAccountId, bankStart } = readFireflyEnv();
            return {
              client: new FireflyClient({ baseUrl, pat, glsAccountId }),
              bankStart,
            };
          })();

      const lastRun = await findLastSuccessfulRun();
      const { from, to } = computeSyncWindow({
        lastRunFinishedAt: lastRun?.finishedAt,
        bankStart: source.bankStart,
        now,
      });
      ({ fetched } = await syncBankTransactions({ client: source.client, from, to, now }));
    }

    const counts = await reconcilePendingTransactions();
    run.fetched = fetched;
    run.matched = counts.matched;
    run.partial = counts.partial;
    run.unmatched = counts.unmatched;

    // Auto-booking never fails the run: its trouble ends up in autoBookWarning.
    const auto: AutoBookResult = await autoBookOpen(now).catch((err: unknown) => ({
      booked: 0,
      failed: 0,
      warning: `Automatisch buchen abgebrochen: ${(err as Error).message}`,
    }));
    run.autoBooked = auto.booked;
    run.autoBookFailed = auto.failed;
    if (auto.warning) run.autoBookWarning = auto.warning;

    // Receipt reading only caches suggestions; it never books and never fails the run.
    const receipts = options.readReceipts === false
      ? { read: 0 }
      : await readOpenReceipts(now).catch((err: unknown) => ({
        read: 0,
        warning: `Belege lesen abgebrochen: ${(err as Error).message}`,
      }));
    run.receiptsRead = receipts.read;
    if ('warning' in receipts) run.receiptReadWarning = receipts.warning;
    run.finishedAt = new Date();
    await run.save();
    return run;
  } catch (err) {
    run.error = (err as Error).message;
    run.finishedAt = new Date();
    await run.save();
    return run;
  }
}

async function main(): Promise<void> {
  await connectMongo();
  try {
    const run = await runReconcile();
    if (run.error) {
      console.error(`Reconcile failed: ${run.error}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Reconcile done: fetched=${run.fetched} matched=${run.matched} ` +
          `partial=${run.partial} unmatched=${run.unmatched} ` +
          `autoBooked=${run.autoBooked} autoBookFailed=${run.autoBookFailed} receiptsRead=${run.receiptsRead}`,
      );
      if (run.autoBookWarning) console.warn(`Auto-booking: ${run.autoBookWarning}`);
      if (run.receiptReadWarning) console.warn(`Receipt reading: ${run.receiptReadWarning}`);
    }
  } finally {
    await disconnectMongo();
  }
}

if (isCliEntrypoint(process.argv[1])) {
  void main();
}
