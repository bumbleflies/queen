import { createHash } from 'crypto';
import type { HydratedDocument } from 'mongoose';
import { google } from 'googleapis';
import { Founder, type FounderDoc } from '../models/Founder';
import { ExpenseClaim, type ExpenseClaimDoc } from '../models/ExpenseClaim';
import { Account } from '../models/Account';
import { FiscalYear } from '../models/FiscalYear';
import {
  createGmailClient,
  displayNameFromHeader,
  addressFromHeader,
  fetchPdfAttachments,
  headerValue,
  listBillMessages,
  sendMail,
  type GmailClientLike,
  type OutgoingMail,
} from '../services/GmailService';
import { ensureSubfolder, type FolderDriveLike } from '../services/receiptsFolder';
import { createOAuth2Client, uploadInvoicePdf, type DriveClientLike } from '../services/DriveService';
import { extractPdfText } from '../services/receiptText';
import { getExpenseAutoBookLimitCents, getReceiptsFolder } from '../services/appSettings';
import { googleAccessForCron } from '../services/driveForUser';
import { parseExpenseText, periodOf, isConfidentClaim, type ParsedClaim } from '../lib/expenses/claimFields';
import { suggestAccount, type AccountSuggestion } from '../lib/expenses/suggestAccount';
import { AUTO_BOOK_ACTOR, bookExpenseClaim } from '../lib/accounting/claimBooking';
import { claimFileName } from '../lib/expenses/claimFileName';
import { claimIntakeReply, type ClaimReplyLine } from '../lib/expenses/intakeMail';

/** Mailbox that receives privately paid receipts (env override for tests/other installs). */
export const DEFAULT_EXPENSE_MAILBOX = 'expenses@bumbleflies.de';
/** How far back each run looks. Ingestion is idempotent, so overlap is free. */
export const EXPENSE_QUERY_DAYS = 14;

export function expenseMailbox(env: NodeJS.ProcessEnv = process.env): string {
  return env.QUEEN_EXPENSE_MAILBOX?.trim() || DEFAULT_EXPENSE_MAILBOX;
}

export interface ExpenseIntakeDeps {
  gmail: GmailClientLike;
  drive: FolderDriveLike & DriveClientLike;
  /** Files one PDF into `<receipts>/Spesen/<year>/` (production: `uploadInvoicePdf` with the cron credential). */
  upload: (file: { buffer: Buffer; fileName: string; folderId: string }) => Promise<{ fileId: string; link: string }>;
  receiptsFolderId: string;
  mailbox: string;
  /** One confirmation reply per mail that produced a claim, in that mail's thread. */
  sendReply?: (mail: OutgoingMail) => Promise<string>;
  extractText?: (bytes: Uint8Array) => Promise<string>;
  parse?: (text: string, opts: { fromName?: string }) => ParsedClaim;
  now?: Date;
  maxMessages?: number;
  /** Gross limit for auto-booking; production reads the setting. */
  autoBookLimitCents?: number;
  /** Suggested expense account; a test can pin it, production uses the history. */
  suggestAccount?: (input: { iban?: string; vendorName?: string }) => Promise<AccountSuggestion | null>;
  /** The booking itself; overridable so a failure can be proven not to fail the run. */
  bookClaim?: (args: { claimId: string; actor: string }) => Promise<unknown>;
}

export interface ExpenseIntakeResult {
  messages: number;
  attachments: number;
  created: number;
  skipped: number;
  /** Claims whose PDF had no readable text layer (a scan); corrected by hand. */
  noText: number;
  /** Attachments that could not be read or filed; retried next run. */
  failed: number;
  errors: string[];
  /** Confirmation replies posted, one per mail that produced a claim. */
  notified: number;
  /** Replies that could not be sent: a warning, never a failed claim. */
  notifyErrors: string[];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** Cached `Spesen/<year>` folder resolution shared by intake and re-import. */
function folderResolver(deps: ExpenseIntakeDeps) {
  let spesenFolder: Promise<string> | null = null;
  const yearFolders = new Map<number, Promise<string>>();
  const spesen = () => (spesenFolder ??= ensureSubfolder(deps.drive, deps.receiptsFolderId, 'Spesen'));
  return (year: number): Promise<string> => {
    const cached = yearFolders.get(year);
    if (cached) return cached;
    const pending = spesen().then((folderId) => ensureSubfolder(deps.drive, folderId, String(year)));
    yearFolders.set(year, pending);
    return pending;
  };
}

/**
 * Book a freshly recorded claim when the read is complete and the amount is
 * under the limit. A failure here is a note on the claim and a warning in the
 * run: a receipt that arrived must never make the intake fail.
 */
async function autoBookClaim(args: {
  claim: HydratedDocument<ExpenseClaimDoc>;
  parsed: ParsedClaim;
  founder: FounderDoc;
  limitCents: number;
  suggest: (input: { iban?: string; vendorName?: string }) => Promise<AccountSuggestion | null>;
  book: (input: { claimId: string; actor: string }) => Promise<unknown>;
  errors: string[];
}): Promise<void> {
  const { claim, parsed, founder } = args;

  let suggestion: AccountSuggestion | null = null;
  try {
    suggestion = await args.suggest({ iban: parsed.iban ?? '', vendorName: parsed.vendorName });
  } catch {
    // A failed suggestion only means the claim queues for review.
    suggestion = null;
  }
  const account = suggestion?.account ?? parsed.account ?? null;
  // The booking reads the claim, not this local object: persist what was suggested.
  if (suggestion?.account && !parsed.account) {
    claim.set('parse.account', suggestion.account);
    await claim.save();
  }

  const date = parsed.date ?? claim.receivedAt;
  const [accountExists, yearClosed] = await Promise.all([
    account ? Account.exists({ number: account, archived: { $ne: true } }).then(Boolean) : Promise.resolve(false),
    FiscalYear.exists({ year: date.getFullYear(), status: 'closed' }).then(Boolean),
  ]);
  const confidence = isConfidentClaim({
    parse: parsed,
    founderActive: founder.active,
    account,
    accountExists,
    limitCents: args.limitCents,
    yearClosed,
    duplicate: false,
    reverseChargeNeedsCompany: parsed.reverseCharge,
  });
  if (!confidence.ok) return;

  try {
    await args.book({ claimId: String(claim._id), actor: AUTO_BOOK_ACTOR });
  } catch (err) {
    claim.error = `Buchung fehlgeschlagen: ${message(err)}`;
    await claim.save();
    args.errors.push(`${claim.fileName}: Buchung fehlgeschlagen — ${message(err)}`);
  }
}

/**
 * One expense-intake pass: read the `expenses` mailbox, file every PDF under
 * `<receipts>/Spesen/<year>/`, map the sender to a founder and store one claim
 * per attachment — then answer each mail that produced a claim in its own
 * thread.
 *
 * Writes `ExpenseClaim` documents and Drive files; a complete, low-value claim
 * may then book itself against the founder's liability (`autoBookClaim`). It
 * never writes a `BankTransaction` or a supplier rule: a receipt that arrived
 * is not a payment, and an IBAN in a receipt is not a rule an admin confirmed.
 * Idempotent per (messageId, attachmentId) and per content hash.
 */
export async function runExpenseIntake(deps: ExpenseIntakeDeps): Promise<ExpenseIntakeResult> {
  const now = deps.now ?? new Date();
  const parse = deps.parse ?? parseExpenseText;
  const extractText = deps.extractText ?? extractPdfText;
  const sendReply = deps.sendReply ?? ((mail: OutgoingMail) => sendMail(deps.gmail, mail));
  const result: ExpenseIntakeResult = {
    messages: 0,
    attachments: 0,
    created: 0,
    skipped: 0,
    noText: 0,
    failed: 0,
    errors: [],
    notified: 0,
    notifyErrors: [],
  };

  const messages = await listBillMessages(deps.gmail, {
    query: `to:${deps.mailbox} has:attachment newer_than:${EXPENSE_QUERY_DAYS}d`,
    maxResults: deps.maxMessages ?? 25,
  });
  result.messages = messages.length;

  const suggest = deps.suggestAccount ?? suggestAccount;
  const book = deps.bookClaim ?? bookExpenseClaim;
  let limit: Promise<number> | null = null;
  const limitCents = () =>
    (limit ??=
      deps.autoBookLimitCents !== undefined
        ? Promise.resolve(deps.autoBookLimitCents)
        : getExpenseAutoBookLimitCents());

  const founders = await Founder.find({ active: true }).lean();
  const founderByEmail = new Map<string, FounderDoc>();
  for (const founder of founders) {
    for (const email of founder.emails) founderByEmail.set(email.toLowerCase(), founder);
  }

  // `Spesen` and its year folder are shared by every mail of the run: resolve
  // each once, so a rerun creates no duplicate folder and a mail with three
  // PDFs lists the folders once.
  const yearFolder = folderResolver(deps);

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
    const fromAddress = addressFromHeader(from);
    const subject = headerValue(msg, 'Subject');
    const founder = founderByEmail.get(fromAddress) ?? null;

    let attachments;
    try {
      attachments = await fetchPdfAttachments(deps.gmail, id, msg.payload);
    } catch (err) {
      result.failed += 1;
      result.errors.push(`Anhänge ${id}: ${message(err)}`);
      continue;
    }

    const replyLines: ClaimReplyLine[] = [];

    for (const attachment of attachments) {
      result.attachments += 1;
      if (await ExpenseClaim.exists({ messageId: id, attachmentId: attachment.attachmentId })) {
        result.skipped += 1;
        continue;
      }
      const sha256 = createHash('sha256').update(attachment.buffer).digest('hex');
      if (await ExpenseClaim.exists({ sha256 })) {
        result.skipped += 1;
        continue;
      }

      let parsed: ParsedClaim | null = null;
      try {
        const text = await extractText(attachment.buffer);
        if (text.trim().length >= 20) parsed = parse(text, { fromName: displayNameFromHeader(from) });
      } catch (err) {
        // The reader threw, so we do not know whether the PDF is readable:
        // record nothing and retry next run (a scan is final, see below).
        result.failed += 1;
        result.errors.push(`${attachment.fileName}: ${message(err)}`);
        continue;
      }

      const period = periodOf(parsed?.date ?? receivedAt);
      const fileName = claimFileName({
        shortName: founder?.shortName ?? 'Unbekannt',
        period,
        vendorName: parsed?.vendorName ?? '',
        invoiceNumber: parsed?.invoiceNumber,
      });

      let filed;
      try {
        filed = await deps.upload({ buffer: attachment.buffer, fileName, folderId: await yearFolder(receivedAt.getFullYear()) });
      } catch (err) {
        // A claim that cannot be filed is not recorded: the next run tries again.
        result.failed += 1;
        result.errors.push(`${fileName}: ${message(err)}`);
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
        fileName,
        driveFileId: filed.fileId,
        driveLink: filed.link,
        founderId: founder?._id ?? null,
        status: 'received' as const,
        period,
        ...(parsed ? { parse: parsed } : {}),
        ...(parsed ? {} : { error: 'Kein lesbarer Text im PDF' }),
        createdBy: 'expense-intake',
      };

      try {
        const claim = await ExpenseClaim.create(doc);
        result.created += 1;
        if (!parsed) result.noText += 1;
        if (parsed && founder) {
          try {
            await autoBookClaim({
              claim,
              parsed,
              founder,
              limitCents: await limitCents(),
              suggest,
              book,
              errors: result.errors,
            });
          } catch (err) {
            // Even an unexpected failure in the auto-book step is a warning.
            result.errors.push(`${fileName}: Auto-Buchung — ${message(err)}`);
          }
        }
        replyLines.push({
          fileName,
          vendor: parsed?.vendorName ?? '',
          grossCents: parsed?.grossCents ?? 0,
          claimId: String(claim._id),
        });
      } catch (err) {
        if (isDuplicateKey(err)) {
          result.skipped += 1;
          continue;
        }
        result.failed += 1;
        result.errors.push(`${fileName}: ${message(err)}`);
      }
    }

    // One reply per incoming mail, in that mail's own thread. A reply carries no
    // attachment and the query is `has:attachment`, so it cannot be re-read.
    if (replyLines.length === 0) continue;
    const reply = claimIntakeReply(replyLines, intakeAppUrl());
    const originalMessageId = headerValue(msg, 'Message-ID');
    try {
      await sendReply({
        ...reply,
        to: deps.mailbox,
        ...(msg.threadId ? { threadId: msg.threadId } : {}),
        ...(originalMessageId ? { inReplyTo: originalMessageId, references: originalMessageId } : {}),
      });
      result.notified += 1;
    } catch (err) {
      result.notifyErrors.push(`Nachricht ${id}: ${message(err)}`);
    }
  }

  return result;
}

/** Expected failure of a re-import: a human sentence, never a 5xx. */
export class ReimportError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'PRECONDITION_FAILED', message: string) {
    super(message);
  }
}

export interface ReimportResult {
  id: string;
  fileName: string;
  founderName: string | null;
  status: string;
}

/**
 * Redo the intake of one claim from the same mail — no new email needed. The
 * claim is updated in place (claims are never deleted): the attachment is
 * re-read, re-filed under the founder now known, and any hand correction is
 * cleared because it belongs to the old read. No confirmation reply is sent.
 */
export async function reimportClaim(claimId: string, deps: ExpenseIntakeDeps): Promise<ReimportResult> {
  const claim = await ExpenseClaim.findById(claimId);
  if (!claim) throw new ReimportError('NOT_FOUND', 'Beleg nicht gefunden');
  if (['booked', 'payoutPending', 'settled'].includes(claim.status)) {
    throw new ReimportError('PRECONDITION_FAILED', 'Beleg ist bereits gebucht – ein Neuimport würde die Buchung verdoppeln');
  }
  if (claim.messageId.startsWith('manual:')) {
    throw new ReimportError('PRECONDITION_FAILED', 'Ein manuell erfasster Beleg hat keine E-Mail');
  }

  let msg;
  try {
    msg = (await deps.gmail.users.messages.get({ userId: 'me', id: claim.messageId, format: 'full' })).data;
  } catch (err) {
    throw new ReimportError('PRECONDITION_FAILED', `E-Mail nicht gefunden: ${message(err)}`);
  }
  const from = headerValue(msg, 'From');
  const founders = await Founder.find({ active: true }).lean();
  const byEmail = new Map<string, FounderDoc>();
  for (const founder of founders) {
    for (const email of founder.emails) byEmail.set(email.toLowerCase(), founder);
  }
  const founder = byEmail.get(addressFromHeader(from)) ?? null;

  let attachments;
  try {
    attachments = await fetchPdfAttachments(deps.gmail, claim.messageId, msg.payload);
  } catch (err) {
    throw new ReimportError('PRECONDITION_FAILED', `Anhänge nicht lesbar: ${message(err)}`);
  }
  // Gmail attachment ids are not stable across API views. The content hash is
  // what intake uses to identify a PDF, so it is the reliable fallback.
  const hashOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const attachment =
    attachments.find((a) => a.attachmentId === claim.attachmentId) ??
    attachments.find((a) => hashOf(a.buffer) === claim.sha256) ??
    (attachments.length === 1 ? attachments[0] : undefined);
  if (!attachment) {
    throw new ReimportError(
      'PRECONDITION_FAILED',
      `Der Anhang ist in der E-Mail nicht mehr vorhanden (vorhanden: ${attachments.map((a) => a.attachmentId).join(', ') || 'keine'})`,
    );
  }

  const extractText = deps.extractText ?? extractPdfText;
  const parse = deps.parse ?? parseExpenseText;
  const text = await extractText(attachment.buffer);
  const parsed = text.trim().length >= 20 ? parse(text, { fromName: displayNameFromHeader(from) }) : null;

  const period = periodOf(parsed?.date ?? claim.receivedAt);
  const fileName = claimFileName({
    shortName: founder?.shortName ?? 'Unbekannt',
    period,
    vendorName: parsed?.vendorName ?? '',
    invoiceNumber: parsed?.invoiceNumber,
  });
  let filed;
  try {
    filed = await deps.upload({ buffer: attachment.buffer, fileName, folderId: await folderResolver(deps)(claim.receivedAt.getFullYear()) });
  } catch (err) {
    throw new ReimportError('PRECONDITION_FAILED', `PDF konnte nicht abgelegt werden: ${message(err)}`);
  }

  claim.set({
    from,
    subject: headerValue(msg, 'Subject'),
    founderId: founder?._id ?? null,
    fileName,
    driveFileId: filed.fileId,
    driveLink: filed.link,
    period,
    status: 'received',
    error: parsed ? undefined : 'Kein lesbarer Text im PDF',
  });
  claim.set('parse', parsed ?? undefined);
  claim.set('corrected', undefined);
  await claim.save();

  const errors: string[] = [];
  if (parsed && founder) {
    try {
      await autoBookClaim({
        claim,
        parsed,
        founder,
        limitCents: deps.autoBookLimitCents ?? (await getExpenseAutoBookLimitCents()),
        suggest: deps.suggestAccount ?? suggestAccount,
        book: deps.bookClaim ?? bookExpenseClaim,
        errors,
      });
    } catch (err) {
      errors.push(message(err));
    }
  }
  return { id: String(claim._id), fileName, founderName: founder?.name ?? null, status: claim.status };
}

/** Origin for the link in the reply; same setting the bills intake uses. */
function intakeAppUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.QUEEN_APP_URL?.trim() || 'https://queen.bumbleflies.de').replace(/\/+$/, '');
}

/**
 * Production dependencies: the receipts folder from settings and the Gmail/Drive
 * credential of the admin who saved them. Throws with a human sentence when
 * something is not configured — the caller decides how to show it.
 */
export async function resolveExpenseIntakeDeps(): Promise<ExpenseIntakeDeps> {
  const folder = await getReceiptsFolder();
  if (!folder) {
    throw new Error('Belege-Ordner ist nicht eingerichtet (Einstellungen → Laufwerk)');
  }
  const access = await googleAccessForCron();
  if (!access) {
    throw new Error('Kein Google-Zugang hinterlegt — bitte in den Einstellungen unter „Google-Zugang“ erneuern');
  }
  const auth = createOAuth2Client(access.refreshToken);
  auth.setCredentials({ refresh_token: access.refreshToken, access_token: access.accessToken });
  const drive = google.drive({ version: 'v3', auth }) as unknown as FolderDriveLike & DriveClientLike;
  const gmail = createGmailClient(access.refreshToken, access.accessToken);
  return {
    gmail,
    drive,
    upload: (file) =>
      // `skip`: a receipt already in the year folder is the same document.
      uploadInvoicePdf({ auth, ifExists: 'skip', ...file }, { drive }),
    receiptsFolderId: folder.id,
    mailbox: expenseMailbox(),
    sendReply: (mail) => sendMail(gmail, mail),
  };
}
