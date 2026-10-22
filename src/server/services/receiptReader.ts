import type { HydratedDocument } from 'mongoose';
import { Account } from '../models/Account';
import { BankTransaction, type BankTransactionDoc } from '../models/BankTransaction';
import { Supplier } from '../models/Supplier';
import {
  buildReceiptPrompt,
  matchReceiptSet,
  parseReceiptReply,
  receiptAccounts,
  type ReadingEntry,
  type ReceiptReading,
} from '../lib/accounting/receiptReading';
import { receiptCandidates, type ReceiptFile } from '../lib/accounting/receipts';
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

/** One receipt file that was read (cached on the transaction). */
export interface ReceiptFileReading {
  driveFileId: string;
  fileName?: string | null;
  status: ReadStatus;
  reading?: ReceiptReading | null;
  /** Drive web link, so the file can be attached to a posting later. */
  link?: string | null;
  model?: string | null;
  readAt: Date;
  error?: string | null;
}

/** The receipts whose totals add up to the transaction amount. */
export interface ReceiptMatch {
  driveFileIds: string[];
  reading: ReceiptReading;
  model?: string | null;
  readAt: Date;
}

export interface ReadTxResult {
  /** Row-level outcome: 'ok' once a set matches, else the worst file outcome. */
  status: ReadStatus;
  readings: ReceiptFileReading[];
  match: ReceiptMatch | null;
}

/** Fewer visible characters than this means a scan without a text layer. */
const MIN_TEXT_CHARS = 10;
/**
 * Transactions the daily reconcile reads per run at most. Every open outgoing
 * row with a clear candidate is read — rule or not — because the receipt is also
 * the document that has to end up on the posting.
 */
export const RECEIPTS_PER_RUN = 25;

/** `QUEEN_RECEIPTS_PER_RUN` overrides the per-run cap. */
export function receiptsPerRun(): number {
  const n = Number(process.env.QUEEN_RECEIPTS_PER_RUN);
  return Number.isInteger(n) && n > 0 ? n : RECEIPTS_PER_RUN;
}

/** Active, non-archived accounts a receipt line may be booked to (numbers and names only). */
export async function receiptPromptAccounts(): Promise<{ number: string; name: string }[]> {
  const accounts = await Account.find({ archived: false }).select('number name').sort({ number: 1 }).lean();
  return receiptAccounts(accounts.map((a) => ({ number: a.number, name: a.name })));
}

/** A file name with an extension other than .pdf (photo, image scan) has no text layer to read. */
function isNonPdfName(name: string | null | undefined): boolean {
  const ext = name?.match(/\.([a-z0-9]+)$/i)?.[1];
  return !!ext && ext.toLowerCase() !== 'pdf';
}

/** One file through the whole path: download → text → opencode → validation. Never throws. */
async function readOne(file: ReceiptFile, deps: ReadDeps): Promise<ReceiptFileReading> {
  const base = { driveFileId: file.id, fileName: file.name, link: file.link, readAt: new Date() };
  try {
    const text = isNonPdfName(file.name) ? '' : await receiptText(deps.drive, file.id);
    if (text.replace(/\s+/g, '').length < MIN_TEXT_CHARS) return { ...base, status: 'noText' };
    const { text: reply, model } = await deps.client.ask(buildReceiptPrompt(text, deps.accounts));
    const reading = parseReceiptReply(reply, new Set(deps.accounts.map((a) => a.number)));
    const modelKey = `${model.providerID}:${model.id}`;
    return reading
      ? { ...base, status: 'ok', reading, model: modelKey }
      : { ...base, status: 'failed', model: modelKey, error: 'Antwort nicht verwertbar' };
  } catch (err) {
    return { ...base, status: 'failed', error: (err as Error).message.slice(0, 500) };
  }
}

const isFinal = (r: ReceiptFileReading | undefined): boolean => r?.status === 'ok' || r?.status === 'noText';

/** Readings already stored for the transaction, keyed by Drive file (legacy single reading included). */
function cachedReadings(tx: HydratedDocument<BankTransactionDoc>): Map<string, ReceiptFileReading> {
  const map = new Map<string, ReceiptFileReading>();
  const legacy = tx.receiptReading as ReceiptFileReading | null | undefined;
  if ((tx.receiptReadings ?? []).length === 0 && legacy) map.set(legacy.driveFileId, legacy);
  for (const r of tx.receiptReadings ?? []) map.set(r.driveFileId, r as ReceiptFileReading);
  return map;
}

function entriesOf(readings: ReceiptFileReading[]): ReadingEntry[] {
  return readings
    .filter((r): r is ReceiptFileReading & { reading: ReceiptReading } => r.status === 'ok' && !!r.reading)
    .map((r) => ({ fileId: r.driveFileId, fileName: r.fileName ?? '', reading: r.reading }));
}

/**
 * Reads the candidate receipts of one transaction and stores the per-file
 * readings plus the set whose totals add up to the bank amount. A final
 * ('ok'/'noText') reading is reused unless `force`; 'failed' is re-read. Stops
 * as soon as a set matches. Never books and never throws for reading trouble.
 */
export async function readTxReceipts(
  tx: HydratedDocument<BankTransactionDoc>,
  files: ReceiptFile[],
  deps: ReadDeps,
  hints: (string | null | undefined)[] = [],
  force = false,
): Promise<ReadTxResult> {
  const cached = cachedReadings(tx);
  const readings: ReceiptFileReading[] = [];
  let match: ReceiptMatch | null = null;

  for (const file of files) {
    const previous = cached.get(file.id);
    // Rebuilt as a plain object: a Mongoose subdocument does not spread its fields.
    const reused: ReceiptFileReading | null =
      !force && isFinal(previous)
        ? {
            driveFileId: previous!.driveFileId,
            fileName: previous!.fileName || file.name,
            status: previous!.status,
            reading: previous!.reading,
            link: previous!.link ?? file.link,
            model: previous!.model,
            readAt: previous!.readAt,
            error: previous!.error,
          }
        : null;
    readings.push(reused ?? (await readOne(file, deps)));
    const found = matchReceiptSet(entriesOf(readings), tx.amountCents, hints);
    if (found) {
      const model = readings.find((r) => found.fileIds.includes(r.driveFileId) && r.model)?.model ?? null;
      match = { driveFileIds: found.fileIds, reading: found.reading, model, readAt: new Date() };
      break;
    }
  }

  const status: ReadStatus = match
    ? 'ok'
    : readings.some((r) => r.status === 'failed')
      ? 'failed'
      : readings.every((r) => r.status === 'noText') && readings.length > 0
        ? 'noText'
        : 'ok';

  await BankTransaction.updateOne(
    { _id: tx._id },
    { $set: { receiptReadings: readings, receiptMatch: match ?? null }, $unset: { receiptReading: 1 } },
  );
  tx.receiptReadings = readings as BankTransactionDoc['receiptReadings'];
  tx.receiptMatch = match as BankTransactionDoc['receiptMatch'];
  return { status, readings, match };
}

/**
 * Reads the receipts of open outgoing rows and stores their readings. Every row
 * with a clear candidate is eligible, whether a rule already classifies it or
 * not (the matched receipt is then attached when the row is booked). Order: no
 * suggestion first, then rows without any stored reading, then failed retries.
 * Only stores readings — never books. `opts.drive` lets the page use the
 * logged-in user's Drive; the cron falls back to the settings owner.
 */
export interface ReadQueueOptions {
  /** Restrict to these fiscal years (on-demand action); default: every open year. */
  years?: number[];
  /** Drive client of the caller; default: the cron's settings owner. */
  drive?: DriveFilesLike;
}

export async function readOpenReceipts(
  now: Date,
  limit = receiptsPerRun(),
  opts: ReadQueueOptions = {},
): Promise<{ read: number; available: boolean }> {
  const result = { read: 0, available: false };
  const client = opencodeFromEnv();
  if (!client) return result;
  const drive = opts.drive ?? (await driveForCron());
  if (!drive) return result;
  result.available = true;
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

  const due: { tx: HydratedDocument<BankTransactionDoc>; files: ReceiptFile[]; hints: (string | null | undefined)[]; priority: number; retryAt: number }[] = [];
  for (const year of opts.years ?? (await bookableYears(now))) {
    const open = (await openTransactions(year)).filter((t) => t.direction === 'out');
    for (const tx of open) {
      // Already backed by a matched set: nothing left to read.
      if (tx.receiptMatch) continue;
      const suggestion = suggestWithHistory(tx, suppliers, history);
      const files = receiptCandidates(tx, tx.receipt?.driveFileId ? [] : await receiptsFor(year));
      if (files.length === 0) continue;
      const cached = cachedReadings(tx);
      const pending = files.filter((f) => !isFinal(cached.get(f.id)));
      if (pending.length === 0) continue;
      // 0: nothing else classifies it, 1: no reading yet, 2: a re-read after a failure
      const priority = suggestion ? (cached.size === 0 ? 1 : 2) : 0;
      // never read: -1 sorts first; failed files: by the time of the last attempt
      const retryAt = Math.max(-1, ...pending.map((f) => (cached.get(f.id)?.readAt ? new Date(cached.get(f.id)!.readAt).getTime() : -1)));
      due.push({ tx, files, hints: [suggestion?.supplierName, tx.counterpartyName], priority, retryAt });
    }
  }
  due.sort((a, b) => a.priority - b.priority || a.retryAt - b.retryAt);
  for (const { tx, files, hints } of due.slice(0, limit)) {
    await readTxReceipts(tx, files, { drive, client, accounts }, hints);
    result.read += 1;
  }
  return result;
}
