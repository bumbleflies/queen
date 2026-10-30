/**
 * The receipts folder is laid out as `<root>/<year>/` (see `listReceiptFiles`),
 * so a bill PDF filed for matching must land in that year folder. Bills are
 * filed by a job, which may be the first thing to touch a new year: create the
 * folder when it is missing.
 */
export interface FolderDriveLike {
  files: {
    list(params: {
      q: string;
      fields?: string;
      spaces?: string;
      pageSize?: number;
      includeItemsFromAllDrives?: boolean;
      supportsAllDrives?: boolean;
    }): Promise<{ data: { files?: { id?: string | null; name?: string | null }[] | null } }>;
    create(params: {
      requestBody: { name: string; mimeType?: string; parents?: string[] };
      fields?: string;
    }): Promise<{ data: { id?: string | null } }>;
  };
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Id of `<root>/<year>/`, created when it does not exist yet. */
export async function ensureYearFolder(drive: FolderDriveLike, rootFolderId: string, year: number): Promise<string> {
  const name = String(year);
  const found = await drive.files.list({
    q: `${quoted(rootFolderId)} in parents and name = ${quoted(name)} and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [rootFolderId] },
    fields: 'id',
  });
  const id = created.data.id;
  if (!id) throw new Error(`Drive hat den Ordner ${name} nicht angelegt`);
  return id;
}
