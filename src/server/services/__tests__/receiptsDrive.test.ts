import { describe, it, expect, vi } from 'vitest';
import { listReceiptFiles } from '../receiptsDrive';

describe('listReceiptFiles', () => {
  it('finds the year subfolder and lists its PDFs', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: { files: [{ id: 'y2026', name: '2026' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'p1', name: 'a.pdf', webViewLink: 'https://drive/p1' }] } });
    const files = await listReceiptFiles({ files: { list } }, 'root', 2026);
    expect(files).toEqual([{ id: 'p1', name: 'a.pdf', link: 'https://drive/p1' }]);
    expect(list.mock.calls[0][0].q).toContain("'root' in parents");
    expect(list.mock.calls[0][0].q).toContain("name = '2026'");
    expect(list.mock.calls[1][0].q).toContain("'y2026' in parents");
    expect(list.mock.calls[1][0].q).toContain("mimeType = 'application/pdf'");
  });

  it('returns [] when the year folder does not exist', async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: { files: [] } });
    expect(await listReceiptFiles({ files: { list } }, 'root', 2027)).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
