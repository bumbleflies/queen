import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { connectMongo } from '../../db/mongo';
import { Bill } from '../../models/Bill';
import { BankTransaction } from '../../models/BankTransaction';
import { Supplier } from '../../models/Supplier';
import { JournalEntry } from '../../models/JournalEntry';
import { Counter } from '../../models/Counter';
import {
  runBillIntake,
  billsMailbox,
  describeIntakeError,
  isMissingGmailScope,
  type BillIntakeDeps,
} from '../billIntake';
import type { OutgoingMail } from '../../services/GmailService';
import { driveStub, gmailThread, gmailWith, intakeDeps, resetBills } from './helpers/intakeFixtures';

beforeAll(async () => {
  await connectMongo();
  await Promise.all([Bill.init(), BankTransaction.init(), Supplier.init()]);
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([
    resetBills(),
    BankTransaction.deleteMany({}),
    Supplier.deleteMany({}),
    Counter.deleteMany({}),
  ]);
});

/** Collects the replies a run would post, without touching Gmail. */
function replySpy() {
  const replies: OutgoingMail[] = [];
  return {
    replies,
    sendReply: async (mail: OutgoingMail) => {
      replies.push(mail);
      return `sent-${replies.length}`;
    },
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
    const result = await runBillIntake(intakeDeps({ client }));

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
    await runBillIntake(intakeDeps({ client }));

    expect(await BankTransaction.countDocuments()).toBe(0);
    expect(await Supplier.countDocuments()).toBe(0);
    expect(await JournalEntry.countDocuments()).toBe(0);
    expect(await Counter.countDocuments()).toBe(0);
  });

  it('is idempotent: a second run files and stores nothing again', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    await runBillIntake(intakeDeps({ client }));
    const again = await runBillIntake(intakeDeps({ client }));

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
    const result = await runBillIntake(intakeDeps({ client }));
    expect(result).toMatchObject({ attachments: 2, created: 1, skipped: 1 });
  });

  it('files a scan without text layer as noText instead of dropping it', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'scan.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(intakeDeps({ client, extractText: async () => '   ' }));

    expect(result).toMatchObject({ created: 1, noText: 1 });
    const bill = await Bill.findOne({ messageId: 'm1' });
    expect(bill?.status).toBe('noText');
    expect(bill?.driveFileId).toBe('file-1');
  });

  it('records nothing when the PDF cannot be filed, so the next run retries', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(
      intakeDeps({ client, upload: async () => { throw new Error('Drive 403'); } }),
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
      intakeDeps({ client, extractText: async () => { throw new Error('Please provide binary data as `Uint8Array`'); } }),
    );

    expect(broken).toMatchObject({ created: 1, noText: 0, failed: 1 });
    const failed = await Bill.findOne({ messageId: 'm1' });
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toContain('Uint8Array');
    // The PDF is filed anyway: it is a valid receipt, only reading it failed.
    expect(failed?.driveFileId).toBe('file-1');

    // A `failed` bill is not an answer: the next run reads it again.
    const repaired = await runBillIntake(intakeDeps({ client }));
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
    const result = await runBillIntake(intakeDeps({ client }));

    expect(result.created).toBe(1);
    expect(fetched).toEqual([]);
  });

  it('creates the year folder for a bill of a past year', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([
      { id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x'), internalDate: String(Date.UTC(2025, 11, 20)) },
    ]);
    const stub = driveStub();
    await runBillIntake(intakeDeps({ client, drive: stub.drive as BillIntakeDeps['drive'] }));
    expect(stub.created).toEqual([{ name: '2025', parent: 'root' }]);
  });
});

describe('runBillIntake confirmation replies', () => {
  it('sends one reply per mail, in its thread, listing every PDF that mail carried', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailThread([
      {
        id: 'm1',
        subject: 'Zwei Rechnungen',
        messageId: '<m1@mail.example>',
        threadId: 'thread-m1',
        files: [
          { fileName: 'a.pdf', bytes: Buffer.from('%PDF-1.4 a') },
          { fileName: 'b.pdf', bytes: Buffer.from('%PDF-1.4 b') },
        ],
      },
    ]);
    const { replies, sendReply } = replySpy();
    const result = await runBillIntake(intakeDeps({ client, sendReply }));

    expect(result).toMatchObject({ created: 2, notified: 1, notifyErrors: [] });
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      to: 'bills@bumbleflies.de',
      subject: 'Re: Zwei Rechnungen',
      threadId: 'thread-m1',
      inReplyTo: '<m1@mail.example>',
      references: '<m1@mail.example>',
    });
    expect(replies[0].text).toContain('abgelegt als a.pdf');
    expect(replies[0].text).toContain('abgelegt als b.pdf');
    expect(replies[0].text).toContain('https://queen.example/finance?tab=bills');
  });

  it('answers each mail separately, in that mail’s own thread', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([
      { id: 'm1', fileName: 'a.pdf', bytes: Buffer.from('%PDF-1.4 first') },
      { id: 'm2', fileName: 'b.pdf', bytes: Buffer.from('%PDF-1.4 second') },
    ]);
    const { replies, sendReply } = replySpy();
    const result = await runBillIntake(intakeDeps({ client, sendReply }));

    expect(result).toMatchObject({ created: 2, notified: 2 });
    expect(replies.map((r) => r.threadId)).toEqual(['thread-m1', 'thread-m2']);
    expect(replies.map((r) => r.inReplyTo)).toEqual(['<m1@mail.example>', '<m2@mail.example>']);
    expect(replies[0].text).toContain('a.pdf');
    expect(replies[0].text).not.toContain('b.pdf');
  });

  it('stays silent on a re-run over the same mail', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const { replies, sendReply } = replySpy();
    await runBillIntake(intakeDeps({ client, sendReply }));
    const again = await runBillIntake(intakeDeps({ client, sendReply }));

    expect(replies).toHaveLength(1);
    expect(again).toMatchObject({ created: 0, skipped: 1, notified: 0, notifyErrors: [] });
  });

  it('sends nothing when the only PDF of a mail could not be filed', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const { replies, sendReply } = replySpy();
    const result = await runBillIntake(
      intakeDeps({ client, sendReply, upload: async () => { throw new Error('Drive 403'); } }),
    );

    expect(result).toMatchObject({ created: 0, failed: 1, notified: 0 });
    expect(replies).toEqual([]);
  });

  it('lists a failed attachment inside the reply of the bill that did arrive', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailThread([
      {
        id: 'm1',
        files: [
          { fileName: 'kaputt.pdf', bytes: Buffer.from('%PDF-1.4 broken') },
          { fileName: 'gut.pdf', bytes: Buffer.from('%PDF-1.4 good') },
        ],
      },
    ]);
    const { replies, sendReply } = replySpy();
    const result = await runBillIntake(
      intakeDeps({
        client,
        sendReply,
        upload: async (file) => {
          // The upload gets the filed name, so key the failure on the bytes.
          if (file.buffer.toString('utf8').includes('broken')) throw new Error('Drive 403');
          return { fileId: 'file-1', link: 'https://drive.example/1' };
        },
      }),
    );

    expect(result).toMatchObject({ created: 1, failed: 1, notified: 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('abgelegt als gut.pdf');
    expect(replies[0].text).toContain('Nicht verarbeitet (wird beim nächsten Lauf erneut versucht):');
    expect(replies[0].text).toContain('  • kaputt.pdf');
  });

  it('sends a reply when a previously failed bill is repaired', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const { replies, sendReply } = replySpy();

    // The text reader threw, so this bill is `failed`, not recorded: no reply.
    const broken = await runBillIntake(
      intakeDeps({ client, sendReply, extractText: async () => { throw new Error('Uint8Array'); } }),
    );
    expect(broken).toMatchObject({ created: 1, failed: 1, notified: 0 });
    expect(replies).toEqual([]);

    // The next run repairs it — a recorded bill now, so it is answered.
    const repaired = await runBillIntake(intakeDeps({ client, sendReply }));
    expect(repaired).toMatchObject({ created: 1, failed: 0, notified: 1 });
    expect(replies).toHaveLength(1);
    expect(replies[0].text).toContain('abgelegt als rechnung.pdf');
  });

  it('records a send failure on the result without failing the run', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(
      intakeDeps({
        client,
        sendReply: async () => {
          throw new Error('Gmail-Versand steht nicht zur Verfügung — es fehlt der Zugriff `gmail.send`');
        },
      }),
    );

    // The bills are filed regardless; the failure is a warning, not an error.
    expect(result).toMatchObject({ created: 1, notified: 0 });
    expect(result.notifyErrors).toHaveLength(1);
    expect(result.notifyErrors[0]).toContain('gmail.send');
    expect(await Bill.countDocuments()).toBe(1);
  });

  it('threads the default reply through Gmail, in the mail’s thread', async (ctx) => {
    if (mongoose.connection.readyState !== 1) ctx.skip();
    const { client, sent } = gmailWith([{ id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 x') }]);
    const result = await runBillIntake(intakeDeps({ client }));

    expect(result.notified).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].threadId).toBe('thread-m1');
    const headers = Buffer.from(sent[0].raw, 'base64url').toString('utf8').split('\r\n\r\n')[0].split('\r\n');
    expect(headers).toContain('To: bills@bumbleflies.de');
    expect(headers).toContain('In-Reply-To: <m1@mail.example>');
    expect(headers).toContain('References: <m1@mail.example>');
    expect(headers.some((h) => h.startsWith('From: '))).toBe(false);
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
    expect(describeIntakeError(new Error('Request had insufficient authentication scopes.'))).toContain('Google-Zugang erneuern');
  });

  it('turns a Gmail 429 into a friendly retry message, not a raw ISO timestamp', () => {
    const text = describeIntakeError(
      new Error('User-rate limit exceeded.  Retry after 2026-11-24T10:19:35.315Z'),
    );
    expect(text).toMatch(/^Gmail is rate-limited\. /);
    expect(text).not.toContain('2026-11-24T10:19:35.315Z');
  });

  it('has a safe fallback when a 429 carries no retry-after', () => {
    expect(describeIntakeError(new Error('User-rate limit exceeded.'))).toBe(
      'Gmail is rate-limited. Please try again in a few minutes.',
    );
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
