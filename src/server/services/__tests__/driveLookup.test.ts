import { describe, it, expect, vi } from 'vitest';
import { createInvoicePdfFinder, type DriveListLike } from '../driveLookup';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function fakeDrive(files: { id: string; name: string; parent: string; mimeType?: string }[]) {
  const list = vi.fn(async ({ q }: { q: string }) => {
    const parents = [...q.matchAll(/'([^']+)' in parents/g)].map((m) => m[1]);
    const names = [...q.matchAll(/name = '((?:[^'\\]|\\.)*)'/g)].map((m) =>
      m[1].replace(/\\'/g, "'"),
    );
    const wantFolders = q.includes(`mimeType = '${FOLDER_MIME}'`);
    return {
      data: {
        files: files
          .filter((f) => parents.includes(f.parent))
          .filter((f) => (wantFolders ? f.mimeType === FOLDER_MIME : f.mimeType !== FOLDER_MIME))
          .filter((f) => names.length === 0 || names.includes(f.name))
          .map((f) => ({ id: f.id, name: f.name, webViewLink: `https://drive/${f.id}` })),
      },
    };
  });
  return { files: { list } } as unknown as DriveListLike & { files: { list: typeof list } };
}

describe('createInvoicePdfFinder', () => {
  const files = [
    { id: 'y2023', name: '2023', parent: 'root-folder', mimeType: FOLDER_MIME },
    { id: 'y2026', name: '2026', parent: 'root-folder', mimeType: FOLDER_MIME },
    { id: 'f1', name: 'Gebucht - 2023-05.20230511-01 - X 10004 - T.pdf', parent: 'y2023' },
    { id: 'f2', name: "2026-08.20260901-01 - it's 10015 - C.pdf", parent: 'y2026' },
    { id: 'f3', name: '2020-12.1001 - top.pdf', parent: 'root-folder' },
    { id: 'other', name: '2024-01.20240101-01 - Z 1 - T.pdf', parent: 'elsewhere' },
  ];

  it('finds PDFs in year subfolders, with or without the "Gebucht - " prefix', async () => {
    const find = createInvoicePdfFinder(fakeDrive(files), 'root-folder');
    expect(await find('2023-05.20230511-01 - X 10004 - T.pdf')).toEqual({
      fileId: 'f1',
      link: 'https://drive/f1',
      name: 'Gebucht - 2023-05.20230511-01 - X 10004 - T.pdf',
    });
    expect((await find("2026-08.20260901-01 - it's 10015 - C.pdf"))?.fileId).toBe('f2');
    expect((await find('2020-12.1001 - top.pdf'))?.fileId).toBe('f3');
  });

  it('returns null for files outside the invoices folder tree', async () => {
    const find = createInvoicePdfFinder(fakeDrive(files), 'root-folder');
    expect(await find('2024-01.20240101-01 - Z 1 - T.pdf')).toBeNull();
  });

  it('lists the subfolders only once', async () => {
    const drive = fakeDrive(files);
    const find = createInvoicePdfFinder(drive, 'root-folder');
    await find('a.pdf');
    await find('b.pdf');
    const folderQueries = drive.files.list.mock.calls.filter(([p]) =>
      p.q.includes(`mimeType = '${FOLDER_MIME}'`),
    );
    expect(folderQueries).toHaveLength(1);
  });
});
