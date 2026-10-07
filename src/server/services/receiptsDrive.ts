import type { ReceiptFile } from '../lib/accounting/receipts';

export interface DriveFilesLike {
  files: {
    list(params: { q: string; fields?: string; spaces?: string; pageSize?: number }): Promise<{
      data: { files?: { id?: string | null; name?: string | null; webViewLink?: string | null }[] | null };
    }>;
  };
}

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** PDFs in `<root>/<year>/` (the "überwiesen" folder layout). */
export async function listReceiptFiles(drive: DriveFilesLike, rootFolderId: string, year: number): Promise<ReceiptFile[]> {
  const folders = await drive.files.list({
    q: `${q(rootFolderId)} in parents and name = ${q(String(year))} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const yearFolder = folders.data.files?.[0]?.id;
  if (!yearFolder) return [];
  const res = await drive.files.list({
    q: `${q(yearFolder)} in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
    pageSize: 1000,
  });
  return (res.data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({ id: f.id!, name: f.name!, link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` }));
}
