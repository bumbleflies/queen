import type { HydratedDocument } from 'mongoose';
import { Account } from '../models/Account';
import { BankTransaction, type BankTransactionDoc } from '../models/BankTransaction';
import { Supplier } from '../models/Supplier';
import {
  buildReceiptPrompt,
  cachedReading,
  parseReceiptReply,
  receiptAccounts,
  type ReceiptReading,
} from '../lib/accounting/receiptReading';
import { rankReceipts, strongReceipt, type ReceiptFile } from '../lib/accounting/receipts';
import { loadHistory, suggestWithHistory } from '../lib/accounting/history';
import { openTransactions } from '../lib/accounting/bankCoverage';
import { bookableYears } from '../lib/accounting/autoBook';
import { getReceiptsFolder } from './appSettings';
import { driveForCron } from './driveForUser';
import { opencodeFromEnv, type OpencodeClient } from './OpencodeClient';
import { listReceiptFiles, type DriveFilesLike } from './receiptsDrive';
import { receiptText } from './receiptText';

export type ReadStatus = 'ok' | 'failed' | 'noText';

export interface ReadDeps {
  drive: DriveFilesLike;
  client: Pick<OpencodeClient, 'ask'>;
  accounts: { number: string; name: string }[];
}

/** Fewer visible characters than this means a scan without a text layer. */
const MIN_TEXT_CHARS = 10;
/** Receipts the daily reconcile reads per run at most. */
export const RECEIPTS_PER_RUN = 10;

/** Active, non-archived accounts a receipt line may be booked to (numbers and names only). */
export async function receiptPromptAccounts(): Promise<{ number: string; name: string }[]> {
  const accounts = await Account.find({ archived: false }).select('number name').sort({ number: 1 }).lean();
  return receiptAccounts(accounts.map((a) => ({ number: a.number, name: a.name })));
}

/** The attached receipt, else the clearly matching one among `files`. */
export function receiptFileFor(
  tx: { receipt?: { driveFileId?: string | null } | null; date: Date; amountCents: number; counterpartyName?: string | null; description?: string | null },
  files: ReceiptFile[],
  supplierName?: string,
): string | null {
  if (tx.receipt?.driveFileId) return tx.receipt.driveFileId;
  return strongReceipt(rankReceipts(files, tx, supplierName))?.id ?? null;
}

/**
 * Reads one receipt (download → text → opencode → validation) and caches the
 * outcome on the transaction. A cached result for the same file is returned as
 * is unless `force`. Never throws for reading trouble: that is status 'failed'.
 */
export async function readTxReceipt(
  tx: HydratedDocument<BankTransactionDoc>,
  driveFileId: string,
  deps: ReadDeps,
  force = false,
): Promise<{ status: ReadStatus; reading: ReceiptReading | null }> {
  const cache = tx.receiptReading;
  if (!force && cache?.driveFileId === driveFileId) {
    return { status: cache.status as ReadStatus, reading: cachedReading(cache) };
  }
  let result: { status: ReadStatus; reading?: ReceiptReading; model?: string; error?: string };
  try {
    const text = await receiptText(deps.drive, driveFileId);
    if (text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) {
      result = { status: 'noText' };
    } else {
      const { text: reply, model } = await deps.client.ask(buildReceiptPrompt(text, deps.accounts));
      const reading = parseReceiptReply(reply, new Set(deps.accounts.map((a) => a.number)));
      const modelKey = `${model.providerID}:${model.id}`;
      result = reading
        ? { status: 'ok', reading, model: modelKey }
        : { status: 'failed', model: modelKey, error: 'Antwort nicht verwertbar' };
    }
  } catch (err) {
    result = { status: 'failed', error: (err as Error).message.slice(0, 500) };
  }
  const receiptReading = { driveFileId, readAt: new Date(), ...result };
  await BankTransaction.updateOne({ _id: tx._id }, { $set: { receiptReading } });
  return { status: result.status, reading: result.reading ?? null };
}

/**
 * Daily reconcile step: reads up to `limit` receipts of open outgoing rows that
 * have no rule or history suggestion but a receipt (attached or clearly
 * matching in Drive) not read yet. Only caches readings — never books.
 * Without an opencode key or a Drive connection nothing happens.
 */
export async function readOpenReceipts(now: Date, limit = RECEIPTS_PER_RUN): Promise<{ read: number }> {
  const result = { read: 0 };
  const client = opencodeFromEnv();
  if (!client) return result;
  const drive = await driveForCron();
  if (!drive) return result;
  const [folder, suppliers, history, accounts] = await Promise.all([
    getReceiptsFolder(),
    Supplier.find({ archived: false }),
    loadHistory(now),
    receiptPromptAccounts(),
  ]);
  const filesByYear = new Map<number, Promise<ReceiptFile[]>>();
  const receiptsFor = (year: number): Promise<ReceiptFile[]> => {
    if (!folder) return Promise.resolve([]);
    if (!filesByYear.has(year)) filesByYear.set(year, listReceiptFiles(drive, folder.id, year).catch(() => []));
    return filesByYear.get(year)!;
  };

  for (const year of await bookableYears(now)) {
    const candidates = (await openTransactions(year)).filter((t) => t.direction === 'out');
    for (const tx of candidates) {
      if (result.read >= limit) return result;
      if (suggestWithHistory(tx, suppliers, history)) continue;
      const fileId = receiptFileFor(tx, tx.receipt?.driveFileId ? [] : await receiptsFor(new Date(tx.date).getFullYear()));
      if (!fileId || tx.receiptReading?.driveFileId === fileId) continue;
      await readTxReceipt(tx, fileId, { drive, client, accounts });
      result.read += 1;
    }
  }
  return result;
}
