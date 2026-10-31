import { describe, it, expect, vi } from 'vitest';
import PDFDocument from 'pdfkit';
import { extractPdfText, receiptText } from '../receiptText';

function pdf(draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // uncompressed: under jsdom pdfkit's deflate output is not readable by pdf.js
    const doc = new PDFDocument({ compress: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    draw(doc);
    doc.end();
  });
}

describe('receiptText', () => {
  it('downloads the file from Drive and extracts its text layer', async () => {
    const bytes = await pdf((doc) => doc.text('Muster Café — Summe 54,60 EUR'));
    const get = vi.fn(async () => ({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }));
    const text = await receiptText({ files: { list: vi.fn(), get } }, 'file-1');
    expect(text).toContain('Summe 54,60 EUR');
    expect(get).toHaveBeenCalledWith({ fileId: 'file-1', alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
  });

  it('gives empty text for files that are not PDFs (photos, scans as images)', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const get = vi.fn(async () => ({ data: png.buffer }));
    expect(await receiptText({ files: { list: vi.fn(), get } }, 'img-1')).toBe('');
    expect(await extractPdfText(png)).toBe('');
  });

  it('accepts a Node Buffer, which pdf.js otherwise refuses by name', async () => {
    // Gmail hands the intake a Buffer; pdf.js threw "Please provide binary data
    // as `Uint8Array`, rather than `Buffer`" and every bill became a scan.
    const bytes = await pdf((doc) => doc.text('Hetzner — Summe 119,00 EUR'));
    expect(bytes).toBeInstanceOf(Buffer);
    expect(await extractPdfText(bytes)).toContain('Summe 119,00 EUR');
  });

  it('gives empty text for a PDF without a text layer', async () => {
    const bytes = await pdf((doc) => doc.rect(50, 50, 200, 100).fill('#000'));
    expect((await extractPdfText(new Uint8Array(bytes))).trim()).toBe('');
  });
});
