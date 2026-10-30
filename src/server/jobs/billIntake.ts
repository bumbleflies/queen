import { createHash } from 'crypto';
import { google } from 'googleapis';
import { Bill } from '../models/Bill';
import { parseBillText, type ParsedBill } from '../lib/bills/parseBill';
import { billFileName } from '../lib/bills/billFileName';
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
      if (await Bill.exists({ messageId: id, attachmentId: attachment.attachmentId })) {
        result.skipped += 1;
        continue;
      }
      const sha256 = createHash('sha256').update(attachment.buffer).digest('hex');
      if (await Bill.exists({ sha256 })) {
        result.skipped += 1;
        continue;
      }

      let parsed: ParsedBill | null = null;
      let status: 'parsed' | 'noText' = 'noText';
      let textError = '';
      try {
        const text = await extractText(attachment.buffer);
        if (text.trim().length >= 20) {
          parsed = parse(text, { fromName: displayNameFromHeader(from) });
          status = 'parsed';
        }
      } catch (err) {
        textError = message(err);
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

      try {
        await Bill.create({
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
        });
        result.created += 1;
        if (status === 'noText') result.noText += 1;
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
    upload: (file) => uploadInvoicePdf({ auth, ...file }, { drive }),
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
