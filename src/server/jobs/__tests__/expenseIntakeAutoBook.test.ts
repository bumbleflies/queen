import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ExpenseClaim } from '../../models/ExpenseClaim';
import { Founder } from '../../models/Founder';
import { JournalEntry } from '../../models/JournalEntry';
import { runExpenseIntake, type ExpenseIntakeDeps } from '../expenseIntake';
import { gmailThread } from './helpers/intakeFixtures';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../routers/__tests__/helpers/ledgerFixtures';
import type { ParsedClaim } from '../../lib/expenses/claimFields';
import type { AccountSuggestion } from '../../lib/expenses/suggestAccount';

const IBAN = 'DE89370400440532013000';
const founder = {
  name: 'Test Person',
  shortName: 'TP',
  emails: ['tp@example.org'],
  loginEmail: 'tp@bumbleflies.de',
  iban: IBAN,
  liabilityAccount: '3500',
  active: true,
  createdBy: 'test',
};

function parsed(over: Partial<ParsedClaim> = {}): ParsedClaim {
  return {
    vendorName: 'Bahn',
    invoiceNumber: '',
    grossCents: 4120,
    netCents: 3462,
    vatCents: 658,
    vatRate: 0.19,
    iban: IBAN,
    dueDate: null,
    reverseCharge: false,
    date: new Date(2026, 0, 20),
    addressedToCompany: true,
    currency: 'EUR',
    ...over,
  };
}

function suggested(account: string): AccountSuggestion {
  return { account, source: 'history', lastDate: new Date(2026, 0, 10) };
}

function deps(over: Partial<ExpenseIntakeDeps> = {}): ExpenseIntakeDeps {
  const { client } = gmailThread([
    {
      id: 'm1',
      from: 'Test Person <tp@example.org>',
      internalDate: String(new Date(2026, 0, 20).getTime()),
      files: [{ fileName: 'beleg.pdf', bytes: Buffer.from('%PDF-1.4 test') }],
    },
  ]);
  return {
    gmail: client,
    drive: {
      files: {
        list: async () => ({ data: { files: [{ id: 'spesen', name: 'Spesen' }] } }),
        create: async () => ({ data: { id: '2026' } }),
      },
    } as unknown as ExpenseIntakeDeps['drive'],
    upload: async () => ({ fileId: 'f1', link: 'https://drive/f1' }),
    receiptsFolderId: 'root',
    mailbox: 'expenses@bumbleflies.de',
    sendReply: async () => 'sent',
    parse: () => parsed(),
    extractText: async () => 'x'.repeat(40),
    now: new Date(2026, 0, 21),
    autoBookLimitCents: 10000,
    suggestAccount: async () => suggested('6640'),
    ...over,
  };
}

/** A booked receipt from the same vendor, the account history we suggest from. */
async function historyClaim(account: string) {
  return ExpenseClaim.create({
    messageId: 'old-m1',
    attachmentId: 'old-a1',
    sha256: 'old-hash',
    mailbox: 'expenses@bumbleflies.de',
    from: 'Test Person <tp@example.org>',
    subject: 'Spesen alt',
    receivedAt: new Date(2026, 0, 10),
    fileName: 'Spesen-TP-202601-Alt.pdf',
    founderId: (await Founder.findOne())!._id,
    status: 'booked',
    period: '2026-01',
    parse: parsed({ account, vendorName: 'Bahn' }),
    createdBy: 'test',
  });
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

describe('expense intake auto-booking', () => {
  it('books a complete claim at or below the limit', async (ctx) => {
    skipIfNoDb(ctx);
    await historyClaim('6640');

    const result = await runExpenseIntake(deps());

    expect(result.created).toBe(1);
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' }).lean();
    expect(claim?.status).toBe('booked');
    expect(claim?.parse?.account).toBe('6640');
    const entries = await JournalEntry.find({ 'source.kind': 'expense_claim' }).lean();
    expect(entries).toHaveLength(1);
    expect(entries[0].createdBy).toBe('auto:expense-intake');
    expect(entries[0].lines).toEqual(
      expect.arrayContaining([
        { account: '1406', debitCents: 658, creditCents: 0 },
        { account: '3500', debitCents: 0, creditCents: 4120 },
        { account: '6640', debitCents: 3462, creditCents: 0 },
      ]),
    );
  });

  it('queues above the limit', async (ctx) => {
    skipIfNoDb(ctx);
    const result = await runExpenseIntake(
      deps({ parse: () => parsed({ grossCents: 25000, netCents: 25000, vatCents: 0, vatRate: 0 }) }),
    );
    expect(result.created).toBe(1);
    expect((await ExpenseClaim.findOne({ messageId: 'm1' }).lean())?.status).toBe('received');
    expect(await JournalEntry.countDocuments()).toBe(0);
  });

  it('queues when no account can be proposed', async (ctx) => {
    skipIfNoDb(ctx);
    await runExpenseIntake(deps({ suggestAccount: async () => null }));
    expect((await ExpenseClaim.findOne({ messageId: 'm1' }).lean())?.status).toBe('received');
    expect(await JournalEntry.countDocuments()).toBe(0);
  });

  it('books a private-addressed receipt gross-only when the account is known', async (ctx) => {
    skipIfNoDb(ctx);
    await runExpenseIntake(deps({ parse: () => parsed({ addressedToCompany: false }) }));

    const claim = await ExpenseClaim.findOne({ messageId: 'm1' }).lean();
    expect(claim?.status).toBe('booked');
    const entry = await JournalEntry.findOne({ 'source.kind': 'expense_claim' }).lean();
    expect(entry?.lines).toEqual([
      { account: '3500', debitCents: 0, creditCents: 4120 },
      { account: '6640', debitCents: 4120, creditCents: 0 },
    ]);
  });

  it('never auto-books a §13b receipt not addressed to bumbleflies', async (ctx) => {
    skipIfNoDb(ctx);
    await runExpenseIntake(
      deps({
        parse: () =>
          parsed({
            reverseCharge: true,
            addressedToCompany: false,
            vatCents: 0,
            netCents: 4120,
          }),
      }),
    );
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' }).lean();
    expect(claim?.status).toBe('received');
    expect(await JournalEntry.countDocuments()).toBe(0);
  });

  it('never lets auto-booking fail the intake run', async (ctx) => {
    skipIfNoDb(ctx);
    const result = await runExpenseIntake(
      deps({
        bookClaim: async () => {
          throw new Error('Buchung kaputt');
        },
      }),
    );
    expect(result.created).toBe(1);
    expect(result.errors.join(' ')).toContain('Buchung kaputt');
    const claim = await ExpenseClaim.findOne({ messageId: 'm1' }).lean();
    expect(claim?.status).toBe('received');
    expect(claim?.error).toContain('Buchung kaputt');
  });
});
