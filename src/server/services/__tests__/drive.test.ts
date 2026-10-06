import { describe, it, expect, vi } from 'vitest';
import { uploadInvoicePdf, type DriveClientLike } from '../DriveService';
import type { OAuth2Client } from 'google-auth-library';

const auth = {} as unknown as OAuth2Client;

function makeDrive(existingId?: string) {
  const list = vi.fn(async () => ({
    data: { files: existingId ? [{ id: existingId, name: 'x.pdf' }] : [] },
  }));
  const create = vi.fn(async () => ({ data: { id: 'new-id', webViewLink: 'https://drive/new' } }));
  const update = vi.fn(async () => ({ data: { id: existingId, webViewLink: 'https://drive/upd' } }));
  return { drive: { files: { list, create, update } } as unknown as DriveClientLike, list, create, update };
}

describe('uploadInvoicePdf', () => {
  it('creates a new file when none exists in the folder', async () => {
    const { drive, list, create, update } = makeDrive();
    const res = await uploadInvoicePdf(
      { auth, buffer: Buffer.from('pdf'), fileName: 'inv.pdf', folderId: 'folder-1' },
      { drive },
    );

    expect(list).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const createArg = create.mock.calls[0][0] as any;
    expect(createArg.requestBody.parents).toEqual(['folder-1']);
    expect(createArg.requestBody.name).toBe('inv.pdf');
    expect(res).toEqual({ fileId: 'new-id', link: 'https://drive/new' });
  });

  it('updates an existing file with the same name instead of duplicating', async () => {
    const { drive, create, update } = makeDrive('existing-id');
    const res = await uploadInvoicePdf(
      { auth, buffer: Buffer.from('pdf'), fileName: 'inv.pdf', folderId: 'folder-1' },
      { drive },
    );

    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
    const updateArg = update.mock.calls[0][0] as any;
    expect(updateArg.fileId).toBe('existing-id');
    expect(res).toEqual({ fileId: 'existing-id', link: 'https://drive/upd' });
  });

  it('escapes single quotes in the Drive search query', async () => {
    const { drive, list } = makeDrive();
    await uploadInvoicePdf(
      { auth, buffer: Buffer.from('pdf'), fileName: "O'Brien 5.pdf", folderId: 'folder-1' },
      { drive },
    );
    const q = (list.mock.calls[0][0] as any).q as string;
    expect(q).toContain("name = 'O\\'Brien 5.pdf'");
  });
});
