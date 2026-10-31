import { createHash } from 'crypto';
import { google } from 'googleapis';
import { Bill } from '../models/Bill';
import { BankTransaction } from '../models/BankTransaction';
import { parseBillText, type ParsedBill } from '../lib/bills/parseBill';
import { billFileName } from '../lib/bills/billFileName';
import { linkBillToTransaction } from '../lib/bills/matchBill';
import { billLikeOf, txLikeOf } from '../services/billMatch';
import {
  createGmailClient,
  displayNameFromHeader,
  fetchPdfAttachments,
  headerValue,
  listBillMessages,
  type GmailClientLike,
} from '../services/GmailService';
import { ensureYearFolder, type FolderDriveLike } from '../services/receiptsFolder';
import { createOAuth2Client, uploadInvoicePdf, type DriveClientLike } from '../services/DriveService';
import { extractPdfText } from '../services/receiptText';
import { getReceiptsFolder } from '../services/appSettings';
import { googleAccessForCron } from '../services/driveForUser';

/** Mailbox that receives vendor invoices (env override for tests/other installs). */
export const DEFAULT_BILLS_MAILBOX = 'bills@bumbleflies.de';
/** How far back each run looks. Ingestion is idempotent, so overlap is free. */
export const BILL_QUERY_DAYS = 14;

export function billsMailbox(env: NodeJS.ProcessEnv = process.env): string {
  return env.QUEEN_BILLS_MAILBOX?.trim() || DEFAULT_BILLS_MAILBOX;
}

export interface BillIntakeDeps {
  gmail: GmailClientLike;
  drive: FolderDriveLike & DriveClientLike;
  /** Files one PDF into the receipts year folder (production: `uploadInvoicePdf` with the cron credential). */
  upload: (file: { buffer: Buffer; fileName: string; folderId: string }) => Promise<{ fileId: string; link: string }>;
  receiptsFolderId: string;
  mailbox: string;
  parse?: typeof parseBillText;
  extractText?: (bytes: Uint8Array) => Promise<string>;
  now?: Date;
  maxMessages?: number;
}

export interface BillIntakeResult {
  messages: number;
  attachments: number;
  created: number;
  skipped: number;
  /** Created bills whose PDF had no readable text layer (a scan). */
  noText: number;
  /** Bills that could not be filed or read; a `failed` bill is retried next run. */
  failed: number;
  errors: string[];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/**
 * One intake pass: list bill mails, read every PDF attachment, file it into
 * `<receipts folder>/<year>/` and store what the PDF said.
 *
 * Writes `Bill` documents and Drive files only. It never touches
 * `BankTransaction`, `Supplier`, `JournalEntry` or a booking rule: a bill that
 * arrived is not a payment, and a vendor address in a PDF is not a rule an
 * admin confirmed. Idempotent per (messageId, attachmentId) and per content
 * hash, so re-running is safe and cheap.
 */
export async function runBillIntake(deps: BillIntakeDeps): Promise<BillIntakeResult> {
  const now = deps.now ?? new Date();
  const parse = deps.parse ?? parseBillText;
  const extractText = deps.extractText ?? extractPdfText;
  const result: BillIntakeResult = { messages: 0, attachments: 0, created: 0, skipped: 0, noText: 0, failed: 0, errors: [] };

  const messages = await listBillMessages(deps.gmail, {
    query: `has:attachment newer_than:${BILL_QUERY_DAYS}d`,
    maxResults: deps.maxMessages ?? 25,
  });
  result.messages = messages.length;

  for (const { id } of messages) {
    let msg;
    try {
      msg = (await deps.gmail.users.messages.get({ userId: 'me', id, format: 'full' })).data;
    } catch (err) {
      result.failed += 1;
      result.errors.push(`Nachricht ${id}: ${message(err)}`);
      continue;
    }

    const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : now;
    const from = headerValue(msg, 'From');
    const subject = headerValue(msg, 'Subject');

    let attachments;
    try {
      attachments = await fetchPdfAttachments(deps.gmail, id, msg.payload);
    } catch (err) {
      result.failed += 1;
      result.errors.push(`Anhänge ${id}: ${message(err)}`);
      continue;
    }

    for (const attachment of attachments) {
      result.attachments += 1;
      const existing = await Bill.findOne({ messageId: id, attachmentId: attachment.attachmentId });
      // A `failed` bill is retried: its parse never finished, so what it holds is
      // not an answer. (An extraction bug once made every bill look like a scan.)
      if (existing && existing.status !== 'failed') {
        result.skipped += 1;
        continue;
      }
      const sha256 = createHash('sha256').update(attachment.buffer).digest('hex');
      if (await Bill.exists({ sha256, status: { $ne: 'failed' } })) {
        result.skipped += 1;
        continue;
      }

      let parsed: ParsedBill | null = null;
      let status: 'parsed' | 'noText' | 'failed' = 'noText';
      let textError = '';
      try {
        const text = await extractText(attachment.buffer);
        if (text.trim().length >= 20) {
          parsed = parse(text, { fromName: displayNameFromHeader(from) });
          status = 'parsed';
        }
      } catch (err) {
        // The reader threw, so we do not know whether there is a text layer:
        // `failed` (retried next run), not `noText` (final).
        textError = message(err);
        status = 'failed';
      }

      let filed;
      try {
        const fileName = billFileName(parsed, receivedAt, attachment.fileName);
        const folderId = await ensureYearFolder(deps.drive, deps.receiptsFolderId, receivedAt.getFullYear());
        filed = await deps.upload({ buffer: attachment.buffer, fileName, folderId });
      } catch (err) {
        // Without the file in Drive nothing can match the payment later, so the
        // bill is not recorded and the next run tries again.
        result.failed += 1;
        result.errors.push(`${attachment.fileName}: ${message(err)}`);
        continue;
      }

      const doc = {
        messageId: id,
        attachmentId: attachment.attachmentId,
        sha256,
        mailbox: deps.mailbox,
        from,
        subject,
        receivedAt,
        fileName: attachment.fileName,
        driveFileId: filed.fileId,
        driveLink: filed.link,
        status,
        ...(parsed ? { parse: parsed } : {}),
        ...(textError ? { error: textError } : {}),
        ignored: false,
        createdBy: 'bill-intake',
      };

      try {
        if (existing) {
          // Retry of a `failed` bill: update in place (a bill is never deleted).
          await Bill.updateOne(
            { _id: existing._id },
            textError ? { $set: doc } : { $set: doc, $unset: { error: 1 } },
          );
        } else {
          await Bill.create(doc);
        }
        result.created += 1;
        if (status === 'noText') result.noText += 1;
        if (status === 'failed') {
          result.failed += 1;
          result.errors.push(`${attachment.fileName}: ${textError}`);
        }
      } catch (err) {
        if (isDuplicateKey(err)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
        result.errors.push(`${attachment.fileName}: ${message(err)}`);
      }
    }
  }

  return result;
}

/**
 * Re-link every bill without a stored link (or with a manual link, which is
 * kept) to its settling bank transaction. Two grades: exact amount, or IBAN +
 * invoice number in purpose. When a link is found and the transaction has no
 * receipt yet, the bill's filed PDF is attached as the receipt.
 */
export async function rematchBills(opts: { year?: number } = {}): Promise<{ linked: number; skipped: number; errors: string[] }> {
  const now = new Date();
  const start = opts.year ? new Date(opts.year, 0, 1) : new Date(now.getFullYear() - 1, 0, 1);
  const end = opts.year ? new Date(opts.year + 1, 0, 1) : new Date(now.getFullYear() + 1, 0, 1);

  const [bills, txs] = await Promise.all([
    Bill.find({
      receivedAt: { $gte: start, $lt: end },
      $or: [{ transactionId: { $exists: false } }, { matchMethod: 'manual' }],
    }).sort({ receivedAt: -1 }).lean(),
    BankTransaction.find({ direction: 'out', date: { $gte: start, $lt: end } }).sort({ date: 1 }).lean(),
  ]);
  const txLikes = txs.map((t) => ({ id: String(t._id), ...txLikeOf(t) }));
  const txById = new Map(txs.map((t) => [String(t._id), t]));

  let linked = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const bill of bills) {
    if (bill.matchMethod === 'manual') {
      skipped += 1;
      continue;
    }
    const link = linkBillToTransaction(billLikeOf(bill), txLikes);
    if (!link) {
      skipped += 1;
      continue;
    }
    const tx = txById.get(link.txId);
    if (!tx) {
      skipped += 1;
      continue;
    }

    const update: Record<string, unknown> = {
      transactionId: link.txId,
      matchMethod: link.matchMethod,
      matchedAt: new Date(),
    };
    if (link.amountMismatch !== null) {
      update.amountMismatch = link.amountMismatch;
    }

    try {
      await Bill.findByIdAndUpdate(bill._id, update);
      // Attach the bill's filed PDF as the receipt on the bank transaction so it
      // shows in the finance inbox. MongoDB has no multi-document transactions
      // without a replica set, so do the two writes sequentially: if the second
      // fails, the bill link remains and the receipt can be re-attached on the
      // next rematch run.
      if (!tx.receipt?.driveFileId && bill.driveFileId) {
        await BankTransaction.findByIdAndUpdate(link.txId, {
          $set: {
            receipt: { driveFileId: bill.driveFileId, fileName: bill.fileName, link: bill.driveLink },
          },
        });
      }
      linked += 1;
    } catch (err) {
      errors.push(`${bill.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { linked, skipped, errors };
}

/**
 * Production dependencies: the receipts folder from settings, the Gmail/Drive
 * credential of the admin who saved them. Throws with a human sentence when
 * something is not configured — the caller decides how to show it.
 */
export async function resolveBillIntakeDeps(): Promise<BillIntakeDeps> {
  const folder = await getReceiptsFolder();
  if (!folder) {
    throw new Error('Belege-Ordner ist nicht eingerichtet (Einstellungen → Laufwerk)');
  }
  const access = await googleAccessForCron();
  if (!access) {
    throw new Error('Kein Google-Zugang hinterlegt — bitte in den Einstellungen neu verbinden');
  }
  const auth = createOAuth2Client(access.refreshToken);
  auth.setCredentials({ refresh_token: access.refreshToken, access_token: access.accessToken });
  const drive = google.drive({ version: 'v3', auth }) as unknown as FolderDriveLike & DriveClientLike;
  return {
    gmail: createGmailClient(access.refreshToken, access.accessToken),
    drive,
    upload: (file) =>
      // `skip`: a vendor PDF already in the year folder is the same document.
      // The app's `drive.file` scope could not overwrite it anyway.
      uploadInvoicePdf({ auth, ifExists: 'skip', ...file }, { drive }),
    receiptsFolderId: folder.id,
    mailbox: billsMailbox(),
  };
}

/** Google says the token lacks a scope (e.g. it was minted before `gmail.readonly`). */
export function isMissingGmailScope(err: unknown): boolean {
  const text = message(err);
  return /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|Request had insufficient authentication/i.test(
    text,
  );
}

/**
 * A sentence an admin can act on. Every expected failure of the intake is
 * reported and none of them is a 5xx: this deployment's Traefik replaces 5xx
 * response bodies with its HTML error page, so a `BAD_GATEWAY` reached the
 * browser as `Unexpected token '<'` instead of the reason (2026-10-30).
 */
export function describeIntakeError(err: unknown): string {
  const text = message(err);
  if (/has not been used in project|accessNotConfigured|SERVICE_DISABLED|is disabled/i.test(text)) {
    const project = text.match(/project (\d{6,})/)?.[1];
    return (
      `Die Gmail-API ist im Google-Cloud-Projekt${project ? ` ${project}` : ''} nicht aktiviert. ` +
      'In der Google Cloud Console unter „APIs & Dienste → Bibliothek“ die Gmail API aktivieren ' +
      '(ein bis zwei Minuten warten) und dann erneut abrufen.'
    );
  }
  if (isMissingGmailScope(err)) {
    return 'Gmail-Zugriff fehlt — bitte einmal neu mit Google anmelden, damit der Zugriff auf das bills@-Postfach erteilt wird.';
  }
  return text;
}
