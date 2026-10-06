import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

export interface DriveFile {
  id?: string | null;
  name?: string | null;
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
      media: { mimeType: string; body: Buffer };
      fields?: string;
    }): Promise<{ data: { id?: string | null; webViewLink?: string | null } }>;
    update(params: {
      fileId: string;
      requestBody: { name: string };
      media: { mimeType: string; body: Buffer };
      fields?: string;
    }): Promise<{ data: { id?: string | null; webViewLink?: string | null } }>;
  };
}

export interface UploadInvoicePdfArgs {
  auth: OAuth2Client;
  buffer: Buffer;
  fileName: string;
  folderId: string;
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
 * Upload an invoice PDF to a Drive folder. If a file with the same name already
 * exists in the folder, update/replace it instead of creating a duplicate.
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
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const existingId = existing.data.files?.[0]?.id ?? undefined;
  const media = { mimeType: 'application/pdf', body: args.buffer };

  const res = existingId
    ? await drive.files.update({
        fileId: existingId,
        requestBody: { name: args.fileName },
        media,
        fields: 'id, webViewLink',
      })
    : await drive.files.create({
        requestBody: { name: args.fileName, parents: [args.folderId] },
        media,
        fields: 'id, webViewLink',
      });

  const fileId = res.data.id ?? existingId;
  if (!fileId) throw new Error('Drive did not return a file id');
  return { fileId, link: res.data.webViewLink ?? '' };
}
