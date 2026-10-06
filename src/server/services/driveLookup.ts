/**
 * Read-only lookup of already-filed invoice PDFs for the Sheet import. Filed
 * PDFs live in per-year subfolders of the invoices folder, and booked ones are
 * renamed with a "Gebucht - " prefix, so both are searched.
 */
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const BOOKED_PREFIX = 'Gebucht - ';

export interface DriveListLike {
  files: {
    list(params: {
      q: string;
      fields?: string;
      spaces?: string;
      pageSize?: number;
    }): Promise<{
      data: { files?: { id?: string | null; name?: string | null; webViewLink?: string | null }[] | null };
    }>;
  };
}

export interface FoundPdf {
  fileId: string;
  link: string;
  name: string;
}

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function createInvoicePdfFinder(
  drive: DriveListLike,
  folderId: string,
): (fileName: string) => Promise<FoundPdf | null> {
  let parents: Promise<string[]> | undefined;
  const folderTree = () =>
    (parents ??= drive.files
      .list({
        q: `${q(folderId)} in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        fields: 'files(id, name)',
        spaces: 'drive',
        pageSize: 1000,
      })
      .then((res) => [
        folderId,
        ...(res.data.files ?? []).map((f) => f.id).filter((id): id is string => !!id),
      ]));

  return async (fileName) => {
    const ids = await folderTree();
    const base = fileName.startsWith(BOOKED_PREFIX) ? fileName.slice(BOOKED_PREFIX.length) : fileName;
    const res = await drive.files.list({
      q:
        `(name = ${q(base)} or name = ${q(BOOKED_PREFIX + base)})` +
        ` and (${ids.map((id) => `${q(id)} in parents`).join(' or ')})` +
        ` and mimeType != '${FOLDER_MIME}' and trashed = false`,
      fields: 'files(id, name, webViewLink)',
      spaces: 'drive',
    });
    const file = res.data.files?.[0];
    return file?.id ? { fileId: file.id, link: file.webViewLink ?? '', name: file.name ?? base } : null;
  };
}
