import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ExpenseClaim } from '../../../models/ExpenseClaim';
import { Founder } from '../../../models/Founder';
import { FiscalYear } from '../../../models/FiscalYear';
import { JournalEntry } from '../../../models/JournalEntry';
import { bookExpenseClaim, rebookExpenseClaim, ClaimError } from '../claimBooking';
import { LedgerError } from '../ledger';
import { initLedgerModels, resetLedgerDb, skipIfNoDb } from '../../../routers/__tests__/helpers/ledgerFixtures';

const FOUNDER = {
  name: 'Test Person',
  shortName: 'TP',
  emails: ['tp@example.org'],
  loginEmail: 'tp@bumbleflies.de',
  iban: 'DE89370400440532013000',
  active: true,
  createdBy: 'test',
};

function claimDoc(over: Record<string, unknown> = {}) {
  return {
    messageId: 'm1',
    attachmentId: 'a1',
    sha256: 'hash-1',
    mailbox: 'expenses@bumbleflies.de',
    from: 'Test Person <tp@example.org>',
    subject: 'Spesen Januar',
    receivedAt: new Date(2026, 0, 20),
    fileName: 'Spesen-TP-202601-Bahn.pdf',
    driveFileId: 'drive-1',
    driveLink: 'https://drive.example/1',
    status: 'received' as const,
    period: '2026-01',
    parse: {
      date: new Date(2026, 0, 20),
      vendorName: 'Bahn',
      invoiceNumber: 'R-1',
      grossCents: 11900,
      netCents: 10000,
      vatCents: 1900,
      vatRate: 0.19,
      account: '6837',
      reverseCharge: false,
      addressedToCompany: true,
      currency: 'EUR',
    },
    createdBy: 'expense-intake',
    ...over,
  };
}

async function createClaim(over: Record<string, unknown> = {}, founderOver: Record<string, unknown> = {}) {
  const founder = await Founder.create({ ...FOUNDER, ...founderOver });
  const claim = await ExpenseClaim.create(claimDoc({ founderId: founder._id, ...over }));
  return { founder, claim };
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
});

describe('bookExpenseClaim', () => {
  it('posts once and marks the claim booked', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();

    const entry = await bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });

    expect(await JournalEntry.countDocuments()).toBe(1);
    expect(entry.source?.kind).toBe('expense_claim');
    expect(entry.source?.refId).toBe(String(claim._id));
    expect(entry.createdBy).toBe('admin-id-1');
    expect(entry.lines.map((l) => l.account).sort()).toEqual(['1406', '3500', '6837']);
    const stored = await ExpenseClaim.findById(claim._id).lean();
    expect(stored?.status).toBe('booked');
    expect(String(stored?.journalEntryId)).toBe(String(entry._id));
  });

  it('is idempotent for the same claim', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();

    const first = await bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });
    const second = await bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });

    expect(String(second._id)).toBe(String(first._id));
    expect(await JournalEntry.countDocuments()).toBe(1);
  });

  it('refuses a closed fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();
    await FiscalYear.create({ year: 2026, status: 'closed' });

    await expect(
      bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toMatchObject({ name: 'LedgerError', code: 'YEAR_CLOSED' });
    expect((await ExpenseClaim.findById(claim._id).lean())?.status).toBe('received');
  });

  it('refuses a claim without a founder', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc({ founderId: null }));
    await expect(
      bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toBeInstanceOf(ClaimError);
  });

  it('names the field that blocks booking', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim: noAccount } = await createClaim({
      parse: { vendorName: 'Bahn', grossCents: 11900, account: null, addressedToCompany: true },
    });
    await expect(
      bookExpenseClaim({ claimId: String(noAccount._id), actor: 'admin-id-1' }),
    ).rejects.toThrow('Aufwandskonto fehlt – bitte zuerst korrigieren');

    const { claim: noAmount } = await createClaim({
      messageId: 'm2', attachmentId: 'a2', sha256: 'hash-2',
      parse: { vendorName: 'Bahn', grossCents: null, account: '6837', addressedToCompany: true },
    });
    await expect(
      bookExpenseClaim({ claimId: String(noAmount._id), actor: 'admin-id-1' }),
    ).rejects.toThrow('Betrag fehlt – bitte zuerst korrigieren');

    const { claim: neither } = await createClaim({
      messageId: 'm3', attachmentId: 'a3', sha256: 'hash-3',
      parse: { vendorName: 'Bahn', grossCents: null, account: null, addressedToCompany: true },
    });
    await expect(
      bookExpenseClaim({ claimId: String(neither._id), actor: 'admin-id-1' }),
    ).rejects.toThrow('Betrag und Aufwandskonto fehlen – bitte zuerst korrigieren');
  });

  it('uses the founder liability account, defaulting to 3500', async (ctx) => {
    skipIfNoDb(ctx);
    const { founder, claim } = await createClaim({}, { liabilityAccount: '1700' });
    const entry = await bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });
    expect(entry.lines.some((l) => l.account === '1700' && l.creditCents === 11900)).toBe(true);

    const second = await createClaim({ messageId: 'm2', attachmentId: 'a2', sha256: 'hash-2' });
    expect(second.founder.liabilityAccount).toBe('3500');
    const defaultEntry = await bookExpenseClaim({ claimId: String(second.claim._id), actor: 'admin-id-1' });
    expect(defaultEntry.lines.some((l) => l.account === '3500' && l.creditCents === 11900)).toBe(true);

    expect(String(founder._id)).toBe(String(claim.founderId));
  });
});

describe('rebookExpenseClaim', () => {
  it('rebooks by reversing the old entry', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();
    const first = await bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });

    const doc = await ExpenseClaim.findById(claim._id);
    doc!.set('corrected', { account: '6640', correctedAt: new Date(2026, 0, 21), correctedBy: 'admin-id-1' });
    await doc!.save();

    const second = await rebookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' });

    const old = await JournalEntry.findById(first._id).lean();
    expect(old?.active).toBe(false);
    // The reversal is its own entry; `second` is the new claim posting.
    const reversal = await JournalEntry.findById(old?.reversedBy).lean();
    expect(reversal?.source?.kind).toBe('reversal');
    expect(String(old?.reversedBy)).not.toBe(String(second._id));
    expect(second.active).toBe(true);
    expect(second.lines.map((l) => l.account)).toContain('6640');

    const stored = await ExpenseClaim.findById(claim._id).lean();
    expect(stored?.status).toBe('booked');
    expect(String(stored?.journalEntryId)).toBe(String(second._id));
    expect((stored?.reversedEntryIds ?? []).map(String)).toContain(String(first._id));
    // The reversal is a live posting too; the old claim entry and it are retired.
    const active = await JournalEntry.find({ active: true }, { 'source.kind': 1 }).lean();
    expect(active.map((e) => e.source?.kind).sort()).toEqual(['expense_claim', 'reversal']);
  });

  it('refuses to touch a claim that is already in a payout', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim({ status: 'payoutPending' });
    await expect(
      bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toMatchObject({ code: 'STATE' });
    await expect(
      rebookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toMatchObject({ code: 'STATE' });
  });

  it('refuses a claim that is not booked', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();
    await expect(
      rebookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toBeInstanceOf(ClaimError);
  });

  it('refuses a booked claim whose entry is no longer active', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim({
      status: 'booked',
      journalEntryId: new mongoose.Types.ObjectId(),
    });
    await expect(
      rebookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toMatchObject({ code: 'STATE' });
  });

  it('reports a missing entry as a state error, not a crash', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim({ status: 'booked' });
    await expect(
      rebookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toMatchObject({ code: 'STATE' });
  });
});

describe('LedgerError stays the ledger layer', () => {
  it('is what a closed year throws', async (ctx) => {
    skipIfNoDb(ctx);
    const { claim } = await createClaim();
    await FiscalYear.create({ year: 2026, status: 'closed' });
    await expect(
      bookExpenseClaim({ claimId: String(claim._id), actor: 'admin-id-1' }),
    ).rejects.toBeInstanceOf(LedgerError);
  });
});
