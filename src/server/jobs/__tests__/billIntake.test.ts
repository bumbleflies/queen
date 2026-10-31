import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo } from '../../db/mongo';
import { Bill } from '../../models/Bill';
import { BankTransaction } from '../../models/BankTransaction';
import { Supplier } from '../../models/Supplier';
import { JournalEntry } from '../../models/JournalEntry';
import { Counter } from '../../models/Counter';
import { runBillIntake, billsMailbox, describeIntakeError, isMissingGmailScope, type BillIntakeDeps } from '../billIntake';
import type { GmailClientLike, GmailMessage } from '../../services/GmailService';

beforeAll(async () => {
  await connectMongo();
  await Promise.all([Bill.init(), BankTransaction.init(), Supplier.init()]);
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([
    Bill.deleteMany({}),
    BankTransaction.deleteMany({}),
    Supplier.deleteMany({}),
    Counter.deleteMany({}),
  ]);
});

const PDF_TEXT = `Hetzner Online GmbH
Rechnungsnummer: R-1000
IBAN: DE44 5009 2100 0000 0595 12
Summe netto 100,00 EUR
19,00 % USt 19,00 EUR
Summe brutto 119,00 EUR`;

/** Nested multipart exactly like Gmail sends it: attachment bytes come from attachments.get. */
function gmailWith(files: { id: string; fileName: string; bytes: Buffer; internalDate?: string }[], opts: { inline?: boolean } = {}) {
  const fetched: string[] = [];
  const messages = new Map<string, GmailMessage>();
  for (const file of files) {
    const attachmentId = `att-${file.id}`;
    messages.set(file.id, {
      id: file.id,
      internalDate: file.internalDate ?? String(Date.UTC(2026, 9, 1, 8)),
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: '"Hetzner Online GmbH" <billing@hetzner.com>' },
          { name: 'Subject', value: 'Ihre Rechnung' },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: Buffer.from('siehe Anhang').toString('base64url') } },
              {
                mimeType: 'application/pdf',
                filename: file.fileName,
                body: opts.inline
                  ? { data: file.bytes.toString('base64url'), size: file.bytes.length }
                  : { attachmentId, size: file.bytes.length },
              },
            ],
          },
        ],
      },
    });
  }
  const client: GmailClientLike = {
    users: {
      messages: {
        list: async () => ({ data: { messages: files.map((f) => ({ id: f.id })) } }),
        get: async ({ id }) => ({ data: messages.get(id)! }),
        attachments: {
          get: async ({ id }) => {
            fetched.push(id);
            const file = files.find((f) => `att-${f.id}` === id)!;
            return { data: { data: file.bytes.toString('base64url'), size: file.bytes.length } };
          },
        },
      },
    },
  };
  return { client, fetched };
}

function driveStub() {
  const created: { name: string; parent: string }[] = [];
  return {
    created,
    drive: {
      files: {
        list: async () => ({ data: { files: [] } }),
        create: async ({ requestBody }: { requestBody: { name: string; parents?: string[] } }) => {
          created.push({ name: requestBody.name, parent: requestBody.parents?.[0] ?? '' });
          return { data: { id: `folder-${requestBody.name}` } };
        },
      },
    },
  };
}

function deps(over: Partial<BillIntakeDeps> & { client: GmailClientLike }): BillIntakeDeps {
  const { drive } = driveStub();
  const uploaded: string[] = [];
  return {
    gmail: over.client,
    drive: (over.drive ?? drive) as BillIntakeDeps['drive'],
    upload: over.upload ?? (async (file) => {
      uploaded.push(file.fileName);
      return { fileId: `file-${uploaded.length}`, link: `https://drive.example/${uploaded.length}` };
    }),
    receiptsFolderId: 'root',
    mailbox: 'bills@bumbleflies.de',
    extractText: async () => PDF_TEXT,
    now: new Date(2026, 9, 2),
    ...over,
  };
}

describe('billsMailbox', () => {
  it('defaults to bills@ and honours the env override', () => {
    expect(billsMailbox({})).toBe('bills@bumbleflies.de');
    expect(billsMailbox({ QUEEN_BILLS_MAILBOX: ' rechnungen@bumbleflies.de ' })).toBe('rechnungen@bumbleflies.de');
  });
});

describe('runBillIntake', () => {
  it('finds a PDF nested in multipart and stores what it said', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client, fetched } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(deps({ client }));

    expect(result).toMatchObject({ messages: 1, attachments: 1, created: 1, skipped: 0, failed: 0 });
    expect(fetched).toEqual(['att-m1']);

    const bill = await Bill.findOne({ messageId: 'm1' });
    expect(bill?.status).toBe('parsed');
    expect(bill?.parse).toMatchObject({
      vendorName: 'Hetzner Online GmbH',
      invoiceNumber: 'R-1000',
      grossCents: 11900,
      vatCents: 1900,
      vatRate: 0.19,
      iban: 'DE44500921000000059512',
    });
    // Filed into the receipts year folder, named so receipt ranking finds it.
    expect(bill?.driveFileId).toBe('file-1');
  });

  it('writes no bank transaction, no supplier and no ledger entry', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    await runBillIntake(deps({ client }));

    expect(await BankTransaction.countDocuments()).toBe(0);
    expect(await Supplier.countDocuments()).toBe(0);
    expect(await JournalEntry.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0);
  });

  it('is idempotent: a second run files and stores nothing again', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    await runBillIntake(deps({ client }));
    const again = await runBillIntake(deps({ client }));

    expect(again).toMatchObject({ created: 0, skipped: 1 });
    expect(await Bill.countDocuments()).toBe(1);
  });

  it('skips the same PDF content arriving in another mail', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const bytes = Buffer.from('%PDF-1.4 same');
    const { client } = gmailWith([
      { id: 'm1', fileName: 'a.pdf', bytes },
      { id: 'm2', fileName: 'b.pdf', bytes },
    ]);
    const result = await runBillIntake(deps({ client }));
    expect(result).toMatchObject({ attachments: 2, created: 1, skipped: 1 });
  });

  it('files a scan without text layer as noText instead of dropping it', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'scan.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(deps({ client, extractText: async () => '   ' }));

    expect(result).toMatchObject({ created: 1, noText: 1 });
    const bill = await Bill.findOne({ messageId: 'm1' });
    expect(bill?.status).toBe('noText');
    expect(bill?.driveFileId).toBe('file-1');
  });

  it('records nothing when the PDF cannot be filed, so the next run retries', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(
      deps({ client, upload: async () => { throw new Error('Drive 403'); } }),
    );

    expect(result).toMatchObject({ created: 0, failed: 1 });
    expect(result.errors[0]).toContain('Drive 403');
    expect(await Bill.countDocuments()).toBe(0);
  });

  it('files a bill whose text could not be read as failed, and repairs it next run', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    // pdf.js refused a Buffer ("Please provide binary data as `Uint8Array`"), so
    // every bill looked like a scan and stayed `noText` forever.
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const broken = await runBillIntake(
      deps({ client, extractText: async () => { throw new Error('Please provide binary data as `Uint8Array`'); } }),
    );

    expect(broken).toMatchObject({ created: 1, noText: 0, failed: 1 });
    const failed = await Bill.findOne({ messageId: 'm1' });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('Uint8Array');
    // The PDF is filed anyway: it is a valid receipt, only reading it failed.
    expect(failed?.driveFileId).toBe('file-1');

    // A `failed` bill is not an answer: the next run reads it again.
    const repaired = await runBillIntake(deps({ client }));
    expect(repaired).toMatchObject({ created: 1, skipped: 0, failed: 0 });
    const bill = await Bill.findOne({ messageId: 'm1' });
    expect(bill?.status).toBe('parsed');
    expect(bill?.parse).toMatchObject({ invoiceNumber: 'R-1000' });
    expect(bill?.error).toBeUndefined();
    expect(await Bill.countDocuments()).toBe(1);
  });

  it('reads inline attachment bodies too', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client, fetched } = gmailWith(
      [{ id: 'm1', fileName: 'klein.pdf', bytes: Buffer.from('%PDF-1.4 inline') }],
      { inline: true },
    );
    const result = await runBillIntake(deps({ client }));

    expect(result.created).toBe(1);
    expect(fetched).toEqual([]);
  });

  it('creates the year folder for a bill of a past year', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([
      { id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x'), internalDate: String(Date.UTC(2025, 11, 20)) },
    ]);
    const stub = driveStub();
    await runBillIntake(deps({ client, drive: stub.drive as BillIntakeDeps['drive'] }));
    expect(stub.created).toEqual([{ name: '2025', parent: 'root' }]);
  });
});

describe('describeIntakeError', () => {
  it('turns the disabled-API error into an actionable sentence', () => {
    const message = 'Gmail API has not been used in project 391372270100 before or it is disabled.';
    const text = describeIntakeError(new Error(message));
    expect(text).toContain('Gmail-API');
    expect(text).toContain('391372270100');
    expect(text).toContain('nicht aktiviert');
  });

  it('tells an admin to sign in again when the scope is missing', () => {
    expect(describeIntakeError(new Error('Request had insufficient authentication scopes.'))).toContain('neu mit Google anmelden');
  });

  it('passes anything else through unchanged', () => {
    expect(describeIntakeError(new Error('Drive 403'))).toBe('Drive 403');
  });
});

describe('isMissingGmailScope', () => {
  it('recognises the Google scope errors, and nothing else', () => {
    expect(isMissingGmailScope(new Error('Request had insufficient authentication scopes.'))).toBe(true);
    expect(isMissingGmailScope(new Error('insufficientPermissions'))).toBe(true);
    expect(isMissingGmailScope(new Error('ACCESS_TOKEN_SCOPE_INSUFFICIENT'))).toBe(true);
    expect(isMissingGmailScope(new Error('Drive 403'))).toBe(false);
    expect(isMissingGmailScope('nope')).toBe(false);
  });
});
