import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { BankTransaction } from '../../../models/BankTransaction';
import { ExpenseClaim } from '../../../models/ExpenseClaim';
import { Founder } from '../../../models/Founder';
import { Supplier } from '../../../models/Supplier';
import { appRouter } from '../../../trpc';
import { bookBankTransaction } from '../bankBooking';
import { autoBookOpen } from '../autoBook';
import { isFounderIban } from '../founderIbans';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../../routers/__tests__/helpers/ledgerFixtures';

const FOUNDER = {
  name: 'Chris Daehn',
  shortName: 'ChrisD',
  emails: ['chris@bumbleflies.de'],
  loginEmail: 'chris.daehn@bumbleflies.de',
  iban: 'DE89370400440532013000',
  bic: '',
  liabilityAccount: '3500',
  active: true,
  createdBy: 'test',
};

function bankRow(iban: string, description = 'Spesen ChrisD') {
  return BankTransaction.create({
    fireflyJournalId: `ff-${new mongoose.Types.ObjectId()}`,
    date: new Date(2026, 0, 10),
    amountCents: 5000,
    description,
    counterpartyName: 'Chris Daehn',
    counterpartyIban: iban,
    direction: 'out',
  });
}

beforeAll(initLedgerModels);

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Promise.all([
    Founder.deleteMany({}),
    Supplier.deleteMany({}),
    ExpenseClaim.deleteMany({}),
    BankTransaction.deleteMany({}),
  ]);
});

describe('isFounderIban (pure)', () => {
  it('matches a spaced/lowercase copy of a founder IBAN', () => {
    expect(isFounderIban([FOUNDER.iban], 'de89 3704 0044 0532 0130 00')).toBe(true);
  });

  it('does not match a regular supplier IBAN or an empty field', () => {
    expect(isFounderIban([FOUNDER.iban], 'DE02120300000000202051')).toBe(false);
    expect(isFounderIban([FOUNDER.iban], null)).toBe(false);
  });
});

describe('founder IBAN guard at booking call sites', () => {
  it('booking a reimbursement to a founder IBAN creates no supplier rule', async (ctx) => {
    skipIfNoDb(ctx);
    await Founder.create(FOUNDER);
    const tx = await bankRow(FOUNDER.iban);
    await bookBankTransaction({
      bankTxId: String(tx._id),
      account: '6300',
      vatRate: 0,
      mode: 'normal',
      createdBy: 'test',
    });
    expect(await Supplier.countDocuments({})).toBe(0);
  });

  it('a regular supplier IBAN still teaches a rule', async (ctx) => {
    skipIfNoDb(ctx);
    await Founder.create(FOUNDER);
    const tx = await bankRow('DE02120300000000202051', 'Software Lizenz');
    await bookBankTransaction({
      bankTxId: String(tx._id),
      account: '6837',
      vatRate: 0,
      mode: 'normal',
      createdBy: 'test',
    });
    const learned = await Supplier.find({ origin: 'learned' });
    expect(learned).toHaveLength(1);
    expect(learned[0].learnedAt).toBeTruthy();
  });

  it('auto-book skips a row to a founder IBAN even with a flagged rule', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await Founder.create(FOUNDER);
    await Supplier.create({
      kreditorNumber: 70001,
      name: 'Chris Daehn',
      ibans: [founder.iban],
      defaultAccount: '6300',
      defaultVatRate: 0,
      defaultMode: 'normal',
      autoBook: true,
    });
    await bankRow(FOUNDER.iban);
    const result = await autoBookOpen(new Date(2026, 0, 11));
    expect(result.booked).toBe(0);
  });

  it('the finance inbox shows a founder hint and no expense suggestion', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await Founder.create(FOUNDER);
    await ExpenseClaim.create({
      messageId: 'msg-1',
      attachmentId: 'a1',
      sha256: 'sha-1',
      mailbox: 'expenses@bumbleflies.de',
      receivedAt: new Date(2026, 0, 5),
      fileName: 'beleg.pdf',
      founderId: founder._id,
      status: 'booked',
      period: '2026-01',
      parse: { grossCents: 5000, account: '6837' },
      createdBy: 'test',
    });
    await bankRow(FOUNDER.iban);
    const caller = appRouter.createCaller({
      user: { sub: 'admin', email: 'admin@bumbleflies.de', role: 'admin' },
      serviceAuth: false,
    });
    const rows = await caller.bookings.inbox({ year: 2026 });
    const row = rows.find((r) => r.counterpartyIban === FOUNDER.iban);
    expect(row?.founderHint).toMatchObject({
      founderId: String(founder._id),
      name: FOUNDER.name,
      openClaims: 1,
    });
    expect(row?.suggestion).toBeNull();
  });
});
