import { Invoice } from '../models/Invoice';
import { InvoiceLine } from '../models/InvoiceLine';
import { Client } from '../models/Client';
import { User } from '../models/User';
import { generateInvoicePdf, type InvoiceLineLike } from '../services/PdfService';
import {
  createOAuth2Client,
  uploadInvoicePdf,
  type UploadInvoicePdfArgs,
  type UploadInvoicePdfResult,
} from '../services/DriveService';
import { getGoogleAccessTokenForUser, type GoogleAccess } from '../services/AuthService';

/** Sheet `nameTemplate` convention: `YYYY-MM.<invoiceNumber> - <clientName> <customerNumber> - <title>.pdf`. */
export interface FileNameInvoice {
  invoiceNumber: string;
  customerNumber: number;
  title: string;
  invoiceDate?: Date | null;
  createdAt?: Date | null;
}

export interface FileNameClient {
  name: string;
}

export function buildInvoiceFileName(invoice: FileNameInvoice, client: FileNameClient): string {
  const date = invoice.invoiceDate ?? invoice.createdAt ?? new Date();
  const yearMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const raw = `${yearMonth}.${invoice.invoiceNumber} - ${client.name} ${invoice.customerNumber} - ${invoice.title}.pdf`;
  return raw.replace(/\//g, '-');
}

/** Drive/Google errors carry the HTTP status on `code` or `response.status`. */
export function isRetryableDriveError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  const status =
    typeof e.code === 'number' ? e.code : typeof e.status === 'number' ? e.status : e.response?.status;
  return typeof status === 'number' && status >= 500;
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  sleep?: (ms: number) => Promise<void>;
  isRetryable?: (err: unknown) => boolean;
}

/** Bounded retry with exponential backoff. Bull uses the same policy in production. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const isRetryable = opts.isRetryable ?? (() => true);
  let lastError: unknown;
  for (let attempt = 0; attempt < opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= opts.attempts - 1 || !isRetryable(err)) {
        throw err;
      }
      await sleep(opts.baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

export interface FileInvoiceDeps {
  userId?: string;
  folderId?: string;
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  getAccessToken?: (userId: string) => Promise<GoogleAccess>;
  upload?: (args: UploadInvoicePdfArgs) => Promise<UploadInvoicePdfResult>;
  generatePdf?: typeof generateInvoicePdf;
}

export function getInvoicesFolderId(): string {
  const id = process.env.GOOGLE_DRIVE_INVOICES_FOLDER_ID;
  if (!id) throw new Error('GOOGLE_DRIVE_INVOICES_FOLDER_ID is not set');
  return id;
}

/** Resolve who owns the Drive refresh token used to file the invoice. */
async function resolveFilingUserId(): Promise<string> {
  const user = await User.findOne({
    refreshToken: { $exists: true, $ne: null },
  }).sort({ updatedAt: -1 });
  if (!user) {
    throw new Error('No user with a stored Google refresh token is available for filing');
  }
  return user._id.toString();
}

/**
 * Load the invoice, render its PDF and file it in Drive. A fresh access token is
 * requested at run time from the triggering user's stored refresh token.
 */
export async function processFileInvoice(
  invoiceId: string,
  deps: FileInvoiceDeps = {},
): Promise<void> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);

  const lines = await InvoiceLine.find({ invoiceId: invoice._id });
  const client = await Client.findById(invoice.clientId);
  if (!client) throw new Error(`Client ${String(invoice.clientId)} not found`);

  const userId = deps.userId ?? invoice.filingUserId ?? (await resolveFilingUserId());
  const getAccessToken = deps.getAccessToken ?? getGoogleAccessTokenForUser;
  const generatePdf = deps.generatePdf ?? generateInvoicePdf;
  const upload = deps.upload ?? uploadInvoicePdf;
  const folderId = deps.folderId ?? getInvoicesFolderId();
  const fileName = buildInvoiceFileName(invoice, client);

  try {
    const buffer = await generatePdf(invoice, lines as unknown as InvoiceLineLike[]);
    const { accessToken, refreshToken } = await getAccessToken(userId);
    const auth = createOAuth2Client(refreshToken);
    auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });

    const result = await withRetry(() => upload({ auth, buffer, fileName, folderId }), {
      attempts: deps.attempts ?? 3,
      baseDelayMs: deps.baseDelayMs ?? 500,
      sleep: deps.sleep,
      isRetryable: isRetryableDriveError,
    });

    invoice.driveMetadata = {
      fileId: result.fileId,
      folderId,
      link: result.link,
      fileName,
      filedAt: new Date(),
    };
    await invoice.save();
  } catch (err) {
    invoice.driveMetadata = {
      ...invoice.driveMetadata,
      failureReason: err instanceof Error ? err.message : String(err),
    };
    await invoice.save();
    throw err;
  }
}
