import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Bill } from '../../models/Bill';
import { BankTransaction } from '../../models/BankTransaction';
import { appRouter } from '../../trpc';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

function userCaller() {
  return appRouter.createCaller({
    user: { sub: 'user-id-1', email: 'user@example.de', role: 'user' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  await initLedgerModels();
  if (mongoose.connection.readyState === 1) await Bill.init();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Bill.deleteMany({});
});

const BILL = {
  messageId: 'm1',
  attachmentId: 'a1',
  sha256: 'hash-1',
  mailbox: 'bills@bumbleflies.de',
  from: 'Hetzner Online GmbH <billing@hetzner.com>',
  subject: 'Ihre Rechnung',
  receivedAt: new Date(2026, 9, 1),
  fileName: 'rechnung.pdf',
  driveFileId: 'drive-1',
  driveLink: 'https://drive.example/1',
  status: 'parsed' as const,
  parse: {
    vendorName: 'Hetzner Online GmbH',
    invoiceNumber: 'R-1',
    grossCents: 11900,
    netCents: 10000,
    vatCents: 1900,
    vatRate: 0.19,
    iban: 'DE44500921000000059512',
    dueDate: new Date(2026, 9, 15),
    reverseCharge: false,
  },
  ignored: false,
  createdBy: 'bill-intake',
};

async function bankTx(over: Partial<Record<string, unknown>> = {}) {
  return BankTransaction.create({
    fireflyJournalId: 'tx-1',
    date: new Date(2026, 9, 10),
    amountCents: 11900,
    currency: 'EUR',
    description: 'Hetzner R-1',
    direction: 'out',
    counterpartyName: 'Hetzner Online GmbH',
    counterpartyIban: 'DE44500921000000059512',
    ignored: false,
    importedAt: new Date(2026, 9, 10),
    ...over,
  });
}

describe('bills.list', () => {
  it('pairs a bill with the payment it settles', async (ctx) => {
    skipIfNoDb(ctx);
    await Bill.create(BILL);
    const tx = await bankTx();
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction?.id).toBe(String(tx._id));
    expect(rows[0].parse?.grossCents).toBe(11900);
  });

  it('leaves a bill without a fitting payment unmatched', async (ctx) => {
    skipIfNoDb(ctx);
    await Bill.create(BILL);
    await bankTx({ amountCents: 500 });
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].transaction).toBeNull();
  });

  it('shows ignored bills with the flag instead of hiding the mail', async (ctx) => {
    skipIfNoDb(ctx);
    await Bill.create({ ...BILL, ignored: true });
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].ignored).toBe(true);
  });
});

describe('bills mutations', () => {
  it('intakeNow and setIgnored are admin-only', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(userCaller().bills.intakeNow()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const bill = await Bill.create(BILL);
    await expect(
      userCaller().bills.setIgnored({ id: String(bill._id), ignored: true }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('setIgnored flips the flag without deleting the bill', async (ctx) => {
    skipIfNoDb(ctx);
    const bill = await Bill.create(BILL);
    const updated = await adminCaller().bills.setIgnored({ id: String(bill._id), ignored: true });
    expect(updated.ignored).toBe(true);
    expect(await Bill.countDocuments()).toBe(1);
  });

  it('intakeNow reports a missing setup instead of silently doing nothing', async (ctx) => {
    skipIfNoDb(ctx);
    // No Drive folder saved and no Google token in the test env.
    await expect(adminCaller().bills.intakeNow()).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});
