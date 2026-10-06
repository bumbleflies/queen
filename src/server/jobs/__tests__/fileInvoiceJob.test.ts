import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildInvoiceFileName,
  withRetry,
  isRetryableDriveError,
  processFileInvoice,
} from '../FileInvoiceJob';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
import { Client } from '../../models/Client';

vi.mock('../../services/DriveService', () => ({
  createOAuth2Client: vi.fn(() => ({ setCredentials: vi.fn() })),
  uploadInvoicePdf: vi.fn(),
}));

vi.mock('../../models/Invoice', () => ({ Invoice: { findById: vi.fn() } }));
vi.mock('../../models/InvoiceLine', () => ({ InvoiceLine: { find: vi.fn() } }));
vi.mock('../../models/Client', () => ({ Client: { findById: vi.fn() } }));

function makeInvoice() {
  return {
    _id: 'inv1',
    clientId: 'c1',
    invoiceNumber: '20250101-01',
    customerNumber: 10001,
    title: 'Beratung Mai',
    invoiceDate: new Date('2025-05-12T00:00:00'),
    createdAt: new Date('2025-05-12T00:00:00'),
    servicePeriod: '05.2025',
    paymentTermDays: 30,
    driveMetadata: undefined as Record<string, unknown> | undefined,
    save: vi.fn(async () => {}),
  };
}

const lines = [
  { position: '1', description: 'Beratung', quantity: 1, unitNetCents: 100000, vatRate: 0.19 },
];
const client = { _id: 'c1', name: 'Acme GmbH', customerNumber: 10001 };

const getAccessToken = vi.fn(async () => ({ accessToken: 'at', refreshToken: 'rt' }));
const generatePdf = vi.fn(async () => Buffer.from('%PDF-fake'));

function deps(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'u1',
    folderId: 'folder-1',
    getAccessToken,
    generatePdf,
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('buildInvoiceFileName', () => {
  it('follows the Sheet nameTemplate convention', () => {
    const name = buildInvoiceFileName(makeInvoice() as any, client as any);
    expect(name).toBe('2025-05.20250101-01 - Acme GmbH 10001 - Beratung Mai.pdf');
  });

  it('sanitises forward slashes', () => {
    const invoice = { ...makeInvoice(), title: 'Beleg 01/2025' };
    const name = buildInvoiceFileName(invoice as any, client as any);
    expect(name).toBe('2025-05.20250101-01 - Acme GmbH 10001 - Beleg 01-2025.pdf');
  });

  it('falls back to createdAt when invoiceDate is missing', () => {
    const invoice = { ...makeInvoice(), invoiceDate: undefined };
    const name = buildInvoiceFileName(invoice as any, client as any);
    expect(name).toBe('2025-05.20250101-01 - Acme GmbH 10001 - Beratung Mai.pdf');
  });
});

describe('withRetry', () => {
  it('retries 5xx errors then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw { code: 503 };
        return 'ok';
      },
      { attempts: 3, baseDelayMs: 100, sleep, isRetryable: isRetryableDriveError },
    );

    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-5xx errors', async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw { code: 400 };
        },
        { attempts: 3, baseDelayMs: 100, sleep, isRetryable: isRetryableDriveError },
      ),
    ).rejects.toEqual({ code: 400 });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('processFileInvoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (Invoice.findById as any).mockResolvedValue(makeInvoice());
    (InvoiceLine.find as any).mockResolvedValue(lines);
    (Client.findById as any).mockResolvedValue(client);
    getAccessToken.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
    generatePdf.mockResolvedValue(Buffer.from('%PDF-fake'));
  });

  it('uploads the PDF and stores driveMetadata on success', async () => {
    const upload = vi.fn(async () => ({ fileId: 'f1', link: 'https://drive/f1' }));
    await processFileInvoice('inv1', deps({ upload }) as any);

    const invoice = await (Invoice.findById as any).mock.results[0].value;
    expect(upload).toHaveBeenCalledTimes(1);
    const arg = upload.mock.calls[0][0] as any;
    expect(arg.fileName).toBe('2025-05.20250101-01 - Acme GmbH 10001 - Beratung Mai.pdf');
    expect(arg.folderId).toBe('folder-1');
    expect(invoice.driveMetadata).toMatchObject({
      fileId: 'f1',
      folderId: 'folder-1',
      link: 'https://drive/f1',
      fileName: '2025-05.20250101-01 - Acme GmbH 10001 - Beratung Mai.pdf',
    });
    expect(invoice.save).toHaveBeenCalled();
  });

  it('retries 5xx uploads then succeeds', async () => {
    let calls = 0;
    const upload = vi.fn(async () => {
      calls++;
      if (calls < 3) throw { code: 503 };
      return { fileId: 'f1', link: 'https://drive/f1' };
    });
    await processFileInvoice('inv1', deps({ upload }) as any);
    expect(upload).toHaveBeenCalledTimes(3);
  });

  it('stores failureReason and rethrows on permanent failure', async () => {
    const upload = vi.fn(async () => {
      throw { code: 400, message: 'bad request' };
    });
    await expect(processFileInvoice('inv1', deps({ upload }) as any)).rejects.toBeDefined();

    const invoice = await (Invoice.findById as any).mock.results[0].value;
    expect(upload).toHaveBeenCalledTimes(1);
    expect(invoice.driveMetadata?.failureReason).toBeDefined();
    expect(invoice.save).toHaveBeenCalled();
  });
});
