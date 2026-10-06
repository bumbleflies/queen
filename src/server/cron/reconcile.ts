import 'dotenv/config';
import { connectMongo, disconnectMongo } from '../db/mongo';
import { ReconcileRun, type ReconcileRunDoc } from '../models/ReconcileRun';
import { FireflyClient, type FireflyTransaction } from '../services/FireflyClient';
import { computeSyncWindow, syncBankTransactions } from '../lib/bankSync';
import { isCliEntrypoint, reconcilePendingTransactions } from '../lib/reconcile';
import { findLastSuccessfulRun, readFireflyEnv } from '../lib/fireflyEnv';

export interface DepositSource {
  fetchDeposits(start: Date, end: Date): Promise<FireflyTransaction[]>;
}

export interface RunReconcileOptions {
  now?: Date;
  /** Skip the Firefly sync and only (re)match what is already in Mongo. */
  skipSync?: boolean;
  /** Inject a Firefly client (tests); otherwise built from env. */
  client?: DepositSource;
  bankStart?: Date;
}

/**
 * One reconcile pass: sync GLS deposits into `BankTransaction` (idempotent),
 * then match every fresh transaction against invoices. Errors are recorded on
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
          `partial=${run.partial} unmatched=${run.unmatched}`,
      );
    }
  } finally {
    await disconnectMongo();
  }
}

if (isCliEntrypoint(process.argv[1])) {
  void main();
}
