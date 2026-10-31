import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { Readable } from 'node:stream';

export interface DriveFile {
  id?: string | null;
  name?: string | null;
  webViewLink?: string | null;
}

/** Minimal subset of the Drive v3 client used here (injectable for tests). */
export interface DriveClientLike {
  files: {
    list(params: {
      q: string;
      fields?: string;
      spaces?: string;
    }): Promise<{ data: { files?: DriveFile[] | null } }>;
    create(params: {
      requestBody: { name: string; parents?: string[] };
      /** A stream: googleapis-common pipes it into a multipart/related body (see the note on `uploadInvoicePdf`). */
      media: { mimeType: string; body: Readable };
      fields?: string;
    }): Promise<{ data: { id?: string | null; webViewLink?: string | null } }>;
    update(params: {
      fileId: string;
      requestBody: { name: string };
      media: { mimeType: string; body: Readable };
      fields?: string;
    }): Promise<{ data: { id?: string | null; webViewLink?: string | null } }>;
  };
}

export interface UploadInvoicePdfArgs {
  auth: OAuth2Client;
  buffer: Buffer;
  fileName: string;
  folderId: string;
  /**
   * What to do when a file of that name is already in the folder.
   *
   * - `replace` (default, used for the invoices we generate): upload over it.
   * - `skip` (received bills): return the existing file untouched.
   *
   * `skip` exists because the app's OAuth scope is `drive.file`, which can only
   * write files the app itself created. A vendor PDF that a person filed by
   * hand cannot be overwritten (`The user has not granted the app … write
   * access to the file`, observed 2026-10-31) — and must not be: it is the
   * original document, already in the right place.
   */
  ifExists?: 'replace' | 'skip';
}

export interface UploadInvoicePdfResult {
  fileId: string;
  link: string;
}

/**
 * Build an OAuth2 client from the app credentials + a stored refresh token.
 * Does not perform any network calls; the client refreshes lazily/on demand.
 */
export function createOAuth2Client(refreshToken: string): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set');
  }
  const client = new OAuth2Client(clientId, clientSecret);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Upload a PDF to a Drive folder, replacing a file of the same name unless
 * `ifExists: 'skip'` is set (see `UploadInvoicePdfArgs`).
 *
 * The body must be a stream, not a Buffer: with `media` + `requestBody`
 * googleapis-common builds a multipart/related body and calls
 * `part.body.pipe(...)`, so a Buffer fails with `part.body.pipe is not a
 * function` before any request is made (googleapis 189 / googleapis-common 9,
 * observed 2026-10-31 on the first real upload after the bump).
 */
export async function uploadInvoicePdf(
  args: UploadInvoicePdfArgs,
  deps: { drive?: DriveClientLike } = {},
): Promise<UploadInvoicePdfResult> {
  const drive: DriveClientLike =
    deps.drive ?? (google.drive({ version: 'v3', auth: args.auth }) as unknown as DriveClientLike);

  const existing = await drive.files.list({
    q: `'${escapeDriveQueryValue(args.folderId)}' in parents and name = '${escapeDriveQueryValue(
      args.fileName,
    )}' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
  });
  const existingFile = existing.data.files?.[0];
  const existingId = existingFile?.id ?? undefined;

  if (existingId && args.ifExists === 'skip') {
    return { fileId: existingId, link: existingFile?.webViewLink ?? '' };
  }

  const media = { mimeType: 'application/pdf', body: Readable.from([args.buffer]) };

  const res = existingId
    ? await updateOrExplain(drive, existingId, args.fileName, media)
    : await drive.files.create({
        requestBody: { name: args.fileName, parents: [args.folderId] },
        media,
        fields: 'id, webViewLink',
      });

  const fileId = res.data.id ?? existingId;
  if (!fileId) throw new Error('Drive did not return a file id');
  return { fileId, link: res.data.webViewLink ?? '' };
}

/**
 * A file of that name exists but the app may not replace it. With the
 * `drive.file` scope that is not a Drive problem to retry — a person has to
 * rename or remove the foreign file, so say that instead of surfacing Google's
 * bare message.
 */
async function updateOrExplain(
  drive: DriveClientLike,
  fileId: string,
  fileName: string,
  media: { mimeType: string; body: Readable },
): Promise<{ data: { id?: string | null; webViewLink?: string | null } }> {
  try {
    return await drive.files.update({
      fileId,
      requestBody: { name: fileName },
      media,
      fields: 'id, webViewLink',
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/has not granted the app .* write access/i.test(text)) {
      throw new Error(
        `Die Datei „${fileName}“ liegt bereits im Zielordner, wurde aber nicht von der App angelegt ` +
          `und darf deshalb nicht überschrieben werden (Drive-Berechtigung „drive.file“). ` +
          `Bitte die vorhandene Datei umbenennen oder löschen und erneut ablegen.`,
      );
    }
    throw err;
  }
}
