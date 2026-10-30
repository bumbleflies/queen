import { google } from 'googleapis';
import { createOAuth2Client } from './DriveService';

/** Minimal Gmail v1 surface used here (injectable for tests). */
export interface GmailClientLike {
  users: {
    messages: {
      list(params: {
        userId: string;
        q?: string;
        maxResults?: number;
        pageToken?: string;
      }): Promise<{
        data: { messages?: { id?: string | null; threadId?: string | null }[] | null; nextPageToken?: string | null };
      }>;
      get(params: { userId: string; id: string; format?: string }): Promise<{ data: GmailMessage }>;
      attachments: {
        get(params: {
          userId: string;
          messageId: string;
          id: string;
        }): Promise<{ data: { data?: string | null; size?: number | null } }>;
      };
    };
  };
}

export interface GmailPart {
  partId?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { data?: string | null; attachmentId?: string | null; size?: number | null } | null;
  parts?: GmailPart[] | null;
}

export interface GmailMessage {
  id?: string | null;
  threadId?: string | null;
  /** Epoch milliseconds as a string. */
  internalDate?: string | null;
  payload?: GmailPart | null;
}

export interface PdfPart {
  attachmentId: string;
  fileName: string;
  size: number;
  /** Set when Gmail inlined the bytes instead of handing out an attachment id. */
  inlineData: string | null;
}

export interface FetchedPdf {
  attachmentId: string;
  fileName: string;
  buffer: Buffer;
}

/**
 * Gmail client for a stored refresh token. `accessToken` is optional: the
 * library refreshes lazily from the refresh token when it is omitted.
 */
export function createGmailClient(refreshToken: string, accessToken?: string): GmailClientLike {
  const auth = createOAuth2Client(refreshToken);
  if (accessToken) auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.gmail({ version: 'v1', auth }) as unknown as GmailClientLike;
}

/** Gmail encodes bodies base64url; `Buffer.from` needs the standard alphabet back. */
export function decodeBase64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Depth-first walk: Gmail nests attachments in `multipart/mixed` inside
 * `multipart/alternative`, so top-level parts are not enough.
 */
export function listPdfParts(payload: GmailPart | null | undefined): PdfPart[] {
  const found: PdfPart[] = [];
  const walk = (part: GmailPart | null | undefined): void => {
    if (!part) return;
    const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(part.filename ?? '');
    const attachmentId = part.body?.attachmentId ?? '';
    const inlineData = part.body?.data ?? null;
    if (isPdf && part.filename && (attachmentId || inlineData)) {
      found.push({ attachmentId, fileName: part.filename, size: part.body?.size ?? 0, inlineData });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return found;
}

/** The attachment bytes: inline `body.data` when Gmail inlined them, else `attachments.get`. */
export async function fetchPdfAttachments(
  client: GmailClientLike,
  messageId: string,
  payload: GmailPart | null | undefined,
): Promise<FetchedPdf[]> {
  const out: FetchedPdf[] = [];
  for (const part of listPdfParts(payload)) {
    let data = part.inlineData;
    if (!data && part.attachmentId) {
      const res = await client.users.messages.attachments.get({ userId: 'me', messageId, id: part.attachmentId });
      data = res.data.data ?? null;
    }
    if (!data) continue;
    out.push({
      attachmentId: part.attachmentId || `${messageId}:${part.fileName}`,
      fileName: part.fileName,
      buffer: decodeBase64Url(data),
    });
  }
  return out;
}

/** Header value by case-insensitive name; '' when absent. */
export function headerValue(message: GmailMessage, name: string): string {
  const wanted = name.toLowerCase();
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === wanted)?.value ?? '';
}

/** `"Hetzner Online GmbH" <billing@hetzner.com>` → `Hetzner Online GmbH`. */
export function displayNameFromHeader(from: string): string {
  const name = from.replace(/<[^>]*>/g, '').replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (name) return name;
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  return address.split('@')[0] ?? '';
}

export interface BillMessage {
  id: string;
}

/** Message ids matching the bill query (list results carry no date; `messages.get` does). */
export async function listBillMessages(
  client: GmailClientLike,
  options: { query: string; maxResults: number },
): Promise<BillMessage[]> {
  const res = await client.users.messages.list({
    userId: 'me',
    q: options.query,
    maxResults: options.maxResults,
  });
  return (res.data.messages ?? [])
    .filter((m): m is { id: string } => typeof m.id === 'string' && m.id.length > 0)
    .map((m) => ({ id: m.id }));
}
