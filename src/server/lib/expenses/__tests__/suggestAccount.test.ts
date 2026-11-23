import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ExpenseClaim } from '../../../models/ExpenseClaim';
import { Founder } from '../../../models/Founder';
import { suggestAccount } from '../suggestAccount';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../../routers/__tests__/helpers/ledgerFixtures';

const IBAN = 'DE89 3704 0044 0532 0130 00';
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

async function claim(over: Record<string, unknown>) {
  return ExpenseClaim.create({
    messageId: `m-${Math.random()}`,
    attachmentId: 'a1',
    sha256: `hash-${Math.random()}`,
    mailbox: 'expenses@bumbleflies.de',
    from: 'Test Person <tp@example.org>',
    subject: 'Spesen',
    receivedAt: new Date(2026, 0, 20),
    fileName: 'Spesen-TP-202601-Bahn.pdf',
    founderId: (await Founder.findOne())!._id,
    status: 'booked',
    period: '2026-01',
    parse: {
      vendorName: 'Bahn',
      iban: IBAN,
      grossCents: 4120,
      account: '6640',
      date: new Date(2026, 0, 20),
    },
    createdBy: 'test',
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

describe('suggestAccount', () => {
  it('uses the account of earlier booked claims with the same IBAN or vendor', async (ctx) => {
    skipIfNoDb(ctx);
    await claim({});
    await claim({ parse: { vendorName: 'Bahn', iban: '', account: '6640' } });
    await claim({ parse: { vendorName: 'Bahn AG', iban: IBAN, account: '6640' } });

    expect(await suggestAccount({ iban: IBAN, vendorName: 'Bahn' })).toMatchObject({
      account: '6640',
      source: 'history',
    });
  });

  it('returns null when the last three claims disagree', async (ctx) => {
    skipIfNoDb(ctx);
    await claim({ parse: { vendorName: 'Bahn', iban: IBAN, account: '6640' } });
    await claim({ parse: { vendorName: 'Bahn', iban: IBAN, account: '6837' } });

    expect(await suggestAccount({ iban: IBAN, vendorName: 'Bahn' })).toBeNull();
  });

  it('ignores claims that are not booked or settled', async (ctx) => {
    skipIfNoDb(ctx);
    await claim({ status: 'received' });
    expect(await suggestAccount({ iban: IBAN, vendorName: 'Bahn' })).toBeNull();
  });

  it('returns null without a usable match', async (ctx) => {
    skipIfNoDb(ctx);
    await claim({ parse: { vendorName: 'Andere', iban: 'DE00123456789012345678', account: '6640' } });

    expect(await suggestAccount({ iban: '', vendorName: '' })).toBeNull();
    expect(await suggestAccount({ iban: IBAN, vendorName: 'Bahn' })).toBeNull();
  });
});
