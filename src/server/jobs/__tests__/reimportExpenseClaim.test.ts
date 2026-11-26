import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Founder } from '../../models/Founder';
import { ExpenseClaim } from '../../models/ExpenseClaim';
import { reimportClaim, type ExpenseIntakeDeps } from '../expenseIntake';
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

function setup() {
  const { client, sent } = gmailThread([
    {
      id: 'm1',
      from: 'Test Person <tp@example.org>',
      subject: 'Fwd: a receipt',
      internalDate: String(new Date(2026, 0, 20).getTime()),
      files: [{ fileName: 'beleg.pdf', bytes: Buffer.from('%PDF-1.4 test') }],
    },
  ]);
  const uploaded: { fileName: string; folderId: string }[] = [];
  const deps: ExpenseIntakeDeps = {
    gmail: client,
    drive: {
      files: {
        list: async () => ({ data: { files: [] } }),
        create: async ({ requestBody }: { requestBody: { name: string; parents?: string[] } }) => ({
          data: { id: `folder-${requestBody.name}` },
        }),
      },
    },
    upload: async (file) => {
      uploaded.push({ fileName: file.fileName, folderId: file.folderId });
      return { fileId: 'f1', link: 'https://drive/f1' };
    },
    receiptsFolderId: 'root',
    mailbox: 'expenses@bumbleflies.de',
    sendReply: async () => 'sent',
    parse: () => ({
      vendorName: 'Bahn', invoiceNumber: '', grossCents: 4120, netCents: 3462,
      vatCents: 658, vatRate: 0.19, iban: '', dueDate: null, reverseCharge: false,
      date: new Date(2026, 0, 20), addressedToCompany: true, currency: 'EUR',
    }),
    extractText: async () => 'x'.repeat(40),
    now: new Date(2026, 0, 21),
  };
  return { deps, sent, uploaded };
}

async function claim(over: Record<string, unknown> = {}) {
  return ExpenseClaim.create({
    messageId: 'm1', attachmentId: 'att-m1', sha256: 'old-hash',
    mailbox: 'expenses@bumbleflies.de', from: 'Test Person <tp@example.org>',
    subject: 'Fwd: a receipt', receivedAt: new Date(2026, 0, 20),
    fileName: 'Spesen-Unbekannt-202601-Bahn.pdf', driveLink: 'https://drive/old',
    founderId: null, status: 'received', period: '2026-01',
    parse: { vendorName: 'Wrong', grossCents: 1 },
    corrected: { vendorName: 'Human value', correctedAt: new Date(), correctedBy: 'admin' },
    createdBy: 'expense-intake',
    ...over,
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

describe('reimportClaim', () => {
  it('re-files and assigns the same mail without sending another reply', async (ctx) => {
    skipIfNoDb(ctx);
    const { deps, sent, uploaded } = setup();
    const old = await claim();
    const res = await reimportClaim(String(old._id), deps);

    expect(res.founderName).toBe('Test Person');
    expect(res.fileName).toMatch(/^Spesen-TP-202601-Bahn/);
    expect(sent).toHaveLength(0);
    expect(uploaded).toHaveLength(1);
    const stored = await ExpenseClaim.findById(old._id);
    expect(String(stored?.founderId)).toBe((await Founder.findOne())!._id.toString());
    expect(stored?.status).toBe('received');
    expect(stored?.parse?.vendorName).toBe('Bahn');
    expect(stored?.corrected).toBeUndefined();
    expect(stored?.driveLink).toBe('https://drive/f1');
  });

  it('refuses to re-import a booked claim', async (ctx) => {
    skipIfNoDb(ctx);
    const { deps } = setup();
    const booked = await claim({ status: 'booked', journalEntryId: new mongoose.Types.ObjectId() });
    await expect(reimportClaim(String(booked._id), deps)).rejects.toThrow(/gebucht/i);
    expect((await ExpenseClaim.findById(booked._id))?.fileName).toBe('Spesen-Unbekannt-202601-Bahn.pdf');
  });
});
