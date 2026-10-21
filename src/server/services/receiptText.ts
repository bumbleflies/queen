import { extractText } from 'unpdf';
import type { DriveFilesLike } from './receiptsDrive';

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  // instanceof fails across realms (gaxios, test environments): check the tag instead.
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data as ArrayBuffer);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  throw new Error('Drive lieferte keine Dateidaten');
}

/** The PDF's text layer, pages joined; '' for scans without one. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(bytes, { mergePages: true });
  return text;
}

/** Downloads a receipt PDF from Drive and extracts its text. */
export async function receiptText(drive: DriveFilesLike, fileId: string): Promise<string> {
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return extractPdfText(toBytes(res.data));
}
