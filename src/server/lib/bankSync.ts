import type { FireflyTransaction } from '../services/FireflyClient';
import { BankTransaction } from '../models/BankTransaction';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 7;

/** Narrow model surface used by the sync (lets tests inject a stub). */
export interface BankTransactionModelLike {
  updateOne(
    filter: { fireflyJournalId: string },
    update: {
      $set: Record<string, unknown>;
      $setOnInsert: Record<string, unknown>;
    },
    options: { upsert: true },
  ): Promise<unknown>;
}

const defaultModel = BankTransaction as unknown as BankTransactionModelLike;

export interface SyncWindowArgs {
  lastRunFinishedAt?: Date | null;
  bankStart: Date;
  now: Date;
  /** Ignore earlier runs and re-sync everything from `bankStart`. */
  full?: boolean;
}

/**
 * Inclusive sync window: first run covers `[bankStart, now]`; later runs look
 * back 7 days from the last successful finish to catch late bank bookings.
 */
export function computeSyncWindow({ lastRunFinishedAt, bankStart, now, full }: SyncWindowArgs): {
  from: Date;
  to: Date;
} {
  const from =
    full || !lastRunFinishedAt
      ? bankStart
      : new Date(lastRunFinishedAt.getTime() - LOOKBACK_DAYS * MS_PER_DAY);
  return { from, to: now };
}

export interface SyncBankTransactionsArgs {
  client: { fetchTransactions(start: Date, end: Date): Promise<FireflyTransaction[]> };
  from: Date;
  to: Date;
  now?: Date;
  model?: BankTransactionModelLike;
}

/**
 * Fetch transactions for the window and upsert them by `fireflyJournalId`.
 * Idempotent: the unique-key upsert means re-syncing never duplicates rows.
 * Returns the counts; matching invoices is Task 7's concern.
 */
export async function syncBankTransactions({
  client,
  from,
  to,
  now = new Date(),
  model = defaultModel,
}: SyncBankTransactionsArgs): Promise<{ fetched: number; upserted: number }> {
  const transactions = await client.fetchTransactions(from, to);

  let upserted = 0;
  for (const tx of transactions) {
    await model.updateOne(
      { fireflyJournalId: tx.fireflyJournalId },
      {
        $set: {
          date: tx.date,
          amountCents: tx.amountCents,
          currency: tx.currency,
          description: tx.description,
          direction: tx.direction,
          counterpartyName: tx.counterpartyName,
          counterpartyIban: tx.counterpartyIban,
        },
        $setOnInsert: {
          fireflyJournalId: tx.fireflyJournalId,
          importedAt: now,
          ignored: false,
        },
      },
      { upsert: true },
    );
    upserted += 1;
  }

  return { fetched: transactions.length, upserted };
}
