import { extractText } from 'unpdf';
import type { DriveFilesLike } from './receiptsDrive';

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data);
  // instanceof fails across realms (gaxios, test environments): check the tag instead.
  if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data as ArrayBuffer);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  throw new Error('Drive lieferte keine Dateidaten');
}

/** PDF header `%PDF-` within the first 1024 bytes (where readers accept it). */
function isPdf(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

/** The PDF's text layer, pages joined; '' for scans without one and for anything that is not a PDF (photos). */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  // pdf.js (via unpdf) refuses a Node Buffer *by name*: "Please provide binary
  // data as `Uint8Array`, rather than `Buffer`". Callers hand over whatever the
  // transport produced (a Gmail attachment is a Buffer), so normalise to a
  // plain view of exactly those bytes. This made every e-mailed bill look like
  // a scan until 2026-10-31.
  const data = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    : new Uint8Array(bytes);
  if (!isPdf(data)) return '';
  const { text } = await extractText(data, { mergePages: true });
  return text;
}

/** Downloads a receipt PDF from Drive and extracts its text. */
export async function receiptText(drive: DriveFilesLike, fileId: string): Promise<string> {
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  return extractPdfText(toBytes(res.data));
}
