import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { Account } from '../../../models/Account';
import { Supplier } from '../../../models/Supplier';
import { ExpenseClaim } from '../../../models/ExpenseClaim';
import { Founder } from '../../../models/Founder';
import { suggestReviewAccount } from '../suggestAccount';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../../routers/__tests__/helpers/ledgerFixtures';

beforeAll(async () => {
  await initLedgerModels();
  if (mongoose.connection.readyState === 1) {
    await Promise.all([Account.init(), Supplier.init(), ExpenseClaim.init(), Founder.init()]);
  }
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Promise.all([Supplier.deleteMany({}), ExpenseClaim.deleteMany({}), Founder.deleteMany({})]);
});

const base = { iban: '', vendorName: 'Porkbun LLC' };

describe('suggestReviewAccount', () => {
  it('prefers a booked claim with the same vendor', async (ctx) => {
    skipIfNoDb(ctx);
    await Founder.create({
      name: 'A', shortName: 'A', emails: ['a@example.org'], loginEmail: 'a@bumbleflies.de',
      iban: 'DE89370400440532013000', createdBy: 'test',
    });
    await ExpenseClaim.create({
      messageId: 'm1', attachmentId: 'a1', sha256: 'h1', mailbox: 'expenses@bumbleflies.de',
      receivedAt: new Date(2026, 0, 1), fileName: 'a.pdf', period: '2026-01', status: 'booked',
      parse: { vendorName: 'Porkbun LLC', account: '6640', grossCents: 500 }, createdBy: 'test',
    });
    expect(await suggestReviewAccount(base)).toMatchObject({ account: '6640', source: 'history' });
  });

  it('falls back to a matching booking rule', async (ctx) => {
    skipIfNoDb(ctx);
    await Supplier.create({
      kreditorNumber: 70010, name: 'Digital services', ibans: [], namePatterns: ['porkbun'],
      purposePatterns: [], defaultAccount: '6837', defaultMode: 'normal', createdBy: 'test',
    });
    expect(await suggestReviewAccount(base)).toMatchObject({ account: '6837', source: 'rule' });
  });

  it('suggests the chart account used for digital services when nothing else matches', async (ctx) => {
    skipIfNoDb(ctx);
    expect(await suggestReviewAccount(base)).toMatchObject({ account: '6837', source: 'keyword' });
    expect(await suggestReviewAccount({ iban: '', vendorName: 'Unknown Corner Shop' })).toBeNull();
  });
});
