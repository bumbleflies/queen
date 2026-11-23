import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { Founder } from '../../models/Founder';
import { ExpenseClaim } from '../../models/ExpenseClaim';
import { JournalEntry } from '../../models/JournalEntry';
import { runExpenseIntake, expenseMailbox, type ExpenseIntakeDeps } from '../expenseIntake';
import { ensureSubfolder } from '../../services/receiptsFolder';
import type { GmailClientLike } from '../../services/GmailService';
import type { ParsedClaim } from '../../lib/expenses/claimFields';
import { gmailThread } from './helpers/intakeFixtures';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../routers/__tests__/helpers/ledgerFixtures';

const founder = {
  name: 'Test Person',
  shortName: 'TP',
  emails: ['tp@example.org'],
  loginEmail: 'tp@bumbleflies.de',
  iban: 'DE89370400440532013000',
  liabilityAccount: '3500',
  active: true,
  createdBy: 'test',
};

/** The read a claim stores; the test never parses a real PDF. */
function parsed(over: Partial<ParsedClaim> = {}): ParsedClaim {
  return {
    vendorName: 'Bahn',
    invoiceNumber: '',
    grossCents: 4120,
    netCents: 3462,
    vatCents: 658,
    vatRate: 0.19,
    iban: '',
    dueDate: null,
    reverseCharge: false,
    date: new Date(2026, 0, 20),
    addressedToCompany: true,
    currency: 'EUR',
    ...over,
  };
}

/** Drive that knows which folders it already has, so a rerun creates nothing. */
function folderDrive(existing: Record<string, string> = {}) {
  const created: { name: string; parent: string }[] = [];
  const ids = new Map<string, string>(Object.entries(existing));
  return {
    created,
    drive: {
      files: {
        list: async ({ q }: { q: string }) => {
          const name = q.match(/name = '([^']+)'/)?.[1];
          const id = name ? ids.get(name) : undefined;
          return { data: { files: id ? [{ id, name }] : [] } };
        },
        create: async ({ requestBody }: { requestBody: { name: string; parents?: string[] } }) => {
          created.push({ name: requestBody.name, parent: requestBody.parents?.[0] ?? '' });
          const id = `folder-${requestBody.name}`;
          ids.set(requestBody.name, id);
          return { data: { id } };
        },
      },
    },
  };
}

function mail(over: Partial<Parameters<typeof gmailThread>[0][number]> = {}) {
  return gmailThread([
    {
      id: 'm1',
      from: 'Test Person <tp@example.org>',
      internalDate: String(new Date(2026, 0, 20).getTime()),
      files: [{ fileName: 'beleg.pdf', bytes: Buffer.from('%PDF-1.4 test') }],
      ...over,
    },
  ]);
}

function deps(over: Partial<ExpenseIntakeDeps> = {}): ExpenseIntakeDeps {
  const { drive } = folderDrive();
  return {
    gmail: mail().client,
    drive,
    upload: async () => ({ fileId: 'f1', link: 'https://drive/f1' }),
    receiptsFolderId: 'root',
    mailbox: 'expenses@bumbleflies.de',
    sendReply: async () => 'sent',
    parse: () => parsed(),
    extractText: async () => 'x'.repeat(40),
    now: new Date(2026, 0, 21),
    ...over,
  };
}

beforeAll(async () => {
  await initLedgerModels();
  if (mongoose.connection.readyState === 1) {
    await ExpenseClaim.init();
    await Founder.init();
  }
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await ExpenseClaim.deleteMany({});
  await Founder.deleteMany({});
  await Founder.create(founder);
});

describe('ensureSubfolder', () => {
  it('reuses an existing folder instead of creating a second one', async () => {
    const { drive, created } = folderDrive({ Spesen: 'spesen-1' });
    const id = await ensureSubfolder(drive, 'root', 'Spesen');
    expect(id).toBe('spesen-1');
    expect(created).toEqual([]);
  });

  it('creates the folder under its parent when it is missing', async () => {
    const { drive, created } = folderDrive();
    const id = await ensureSubfolder(drive, 'root', 'Spesen');
    expect(id).toBe('folder-Spesen');
    expect(created).toEqual([{ name: 'Spesen', parent: 'root' }]);
  });
});

describe('runExpenseIntake', () => {
  it('creates one claim per attachment and maps the sender to the founder', async (ctx) => {
    skipIfNoDb(ctx);
    const result = await runExpenseIntake(deps());
    expect(result.created).toBe(1);
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' });
    expect(claim?.founderId?.toString()).toBe((await Founder.findOne())!._id.toString());
    expect(claim?.status).toBe('received');
    expect(claim?.period).toBe('2026-01');
  });

  it('files the PDF under <receipts>/Spesen/<year>/', async (ctx) => {
    skipIfNoDb(ctx);
    const { drive, created } = folderDrive();
    const uploaded: { fileName: string; folderId: string }[] = [];
    await runExpenseIntake(
      deps({
        drive,
        upload: async (file) => {
          uploaded.push({ fileName: file.fileName, folderId: file.folderId });
          return { fileId: 'f1', link: 'https://drive/f1' };
        },
      }),
    );
    expect(created).toEqual([
      { name: 'Spesen', parent: 'root' },
      { name: '2026', parent: 'folder-Spesen' },
    ]);
    expect(uploaded).toEqual([{ fileName: 'Spesen-TP-202601-Bahn.pdf', folderId: 'folder-2026' }]);
  });

  it('leaves a claim without an account suggestion unbooked', async (ctx) => {
    skipIfNoDb(ctx);
    // No earlier claim with this vendor/IBAN: there is no account to book to.
    await runExpenseIntake(deps());
    expect(await JournalEntry.countDocuments()).toBe(0);
    expect((await ExpenseClaim.findOne({ messageId: 'm1' }).lean())?.status).toBe('received');
  });

  it('leaves an unknown sender unassigned but still records the claim', async (ctx) => {
    skipIfNoDb(ctx);
    const { client } = mail({ from: 'Fremd <x@example.org>' });
    await runExpenseIntake(deps({ gmail: client }));
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' });
    expect(claim?.founderId ?? null).toBeNull();
  });

  it('creates one claim per PDF in a mail', async (ctx) => {
    skipIfNoDb(ctx);
    const { client } = gmailThread([
      {
        id: 'm1',
        from: 'Test Person <tp@example.org>',
        files: [
          { fileName: 'a.pdf', bytes: Buffer.from('%PDF-1.4 a') },
          { fileName: 'b.pdf', bytes: Buffer.from('%PDF-1.4 b') },
        ],
      },
    ]);
    const result = await runExpenseIntake(deps({ gmail: client }));
    expect(result.created).toBe(2);
    expect(await ExpenseClaim.countDocuments({ messageId: 'm1' })).toBe(2);
  });

  it('is idempotent per message and attachment', async (ctx) => {
    skipIfNoDb(ctx);
    await runExpenseIntake(deps());
    await runExpenseIntake(deps());
    expect(await ExpenseClaim.countDocuments()).toBe(1);
  });

  it('does not record a claim whose PDF could not be read, so the next run retries', async (ctx) => {
    skipIfNoDb(ctx);
    const result = await runExpenseIntake(
      deps({
        extractText: async () => {
          throw new Error('pdf kaputt');
        },
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
    expect(await ExpenseClaim.countDocuments()).toBe(0);
  });

  it('records a scanned PDF as a claim without a read', async (ctx) => {
    skipIfNoDb(ctx);
    const result = await runExpenseIntake(deps({ extractText: async () => 'kurz' }));
    expect(result.created).toBe(1);
    expect(result.noText).toBe(1);
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' });
    expect(claim?.error).toMatch(/kein lesbarer Text/i);
  });

  it('sends one confirmation reply into the mail thread', async (ctx) => {
    skipIfNoDb(ctx);
    const replies: { to: string; threadId?: string; subject: string; text: string }[] = [];
    await runExpenseIntake(
      deps({
        sendReply: async (outgoing) => {
          replies.push({ to: outgoing.to, threadId: outgoing.threadId, subject: outgoing.subject, text: outgoing.text });
          return 'sent';
        },
      }),
    );
    expect(replies).toHaveLength(1);
    expect(replies[0].to).toBe('expenses@bumbleflies.de');
    expect(replies[0].threadId).toBe('thread-m1');
    expect(replies[0].subject).toBe('Re: Spesen');
    expect(replies[0].text).toContain('1 Beleg');
  });

  it('filters the mailbox in the Gmail query', async (ctx) => {
    skipIfNoDb(ctx);
    const list = vi.fn(async () => ({ data: { messages: [] } }));
    await runExpenseIntake(deps({ gmail: { users: { messages: { list, get: vi.fn() } } } as unknown as GmailClientLike }));
    expect(list.mock.calls[0][0].q).toContain('to:expenses@bumbleflies.de');
  });
});

describe('expenseMailbox', () => {
  it('defaults to the Expenses group and can be overridden', () => {
    expect(expenseMailbox({})).toBe('expenses@bumbleflies.de');
    expect(expenseMailbox({ QUEEN_EXPENSE_MAILBOX: ' spesen@example.org ' })).toBe('spesen@example.org');
  });
});
