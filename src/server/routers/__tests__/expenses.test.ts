import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { ExpenseClaim } from '../../models/ExpenseClaim';
import { Founder } from '../../models/Founder';
import { JournalEntry } from '../../models/JournalEntry';
import { appRouter } from '../../trpc';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

const FOUNDER = {
  name: 'Test Person',
  shortName: 'TP',
  emails: ['tp@example.org'],
  loginEmail: 'tp@bumbleflies.de',
  iban: 'DE89370400440532013000',
  liabilityAccount: '3500',
  active: true,
  createdBy: 'test',
};

function userCaller() {
  return appRouter.createCaller({
    user: { sub: 'user-id-1', email: 'tp@bumbleflies.de', role: 'user' },
    serviceAuth: false,
  });
}

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
      grossCents: 4120,
      netCents: 3462,
      vatCents: 658,
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
  await Founder.create(FOUNDER);
});

describe('expenses.claims.list', () => {
  it('lists claims of a year with merged corrected fields and the founder', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    await ExpenseClaim.create(
      claimDoc({
        founderId: founder._id,
        corrected: {
          grossCents: 4500,
          vatCents: null,
          vatRate: null,
          correctedAt: new Date(2026, 0, 21),
          correctedBy: 'admin-id-1',
        },
      }),
    );

    const rows = await adminCaller().expenses.claims.list({ year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0].parse?.grossCents).toBe(4500);
    expect(rows[0].parse?.vatCents).toBeNull();
    // Untouched fields keep the read's value.
    expect(rows[0].parse?.invoiceNumber).toBe('R-1');
    expect(rows[0].founder?.name).toBe('Test Person');
    expect(rows[0].corrected?.by).toBe('admin-id-1');
    expect(rows[0].autoBookable).toMatchObject({ ok: true, reasons: [] });
  });

  it('leaves claims of another year out', async (ctx) => {
    skipIfNoDb(ctx);
    await ExpenseClaim.create(claimDoc({ period: '2025-12', receivedAt: new Date(2025, 11, 20) }));
    expect(await adminCaller().expenses.claims.list({ year: 2026 })).toHaveLength(0);
  });

  it('shows a non-admin only their own claims', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    await ExpenseClaim.create(claimDoc({ founderId: founder._id }));
    await ExpenseClaim.create(
      claimDoc({ messageId: 'm2', attachmentId: 'a2', sha256: 'hash-2', founderId: new mongoose.Types.ObjectId() }),
    );

    expect(await adminCaller().expenses.claims.list({ year: 2026 })).toHaveLength(2);
    expect(await userCaller().expenses.claims.list({ year: 2026 })).toHaveLength(1);
  });
});

describe('expenses.claims mutations', () => {
  it('is admin-only for mutations', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc());
    const founder = (await Founder.findOne())!;
    const user = userCaller().expenses.claims;
    await expect(user.correct({ id: String(claim._id), grossCents: 1 })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(user.confirm({ id: String(claim._id) })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(user.setIgnored({ id: String(claim._id), ignored: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      user.assignFounder({ id: String(claim._id), founderId: String(founder._id) }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(user.intakeNow()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      user.createManual({ founderId: String(founder._id), date: new Date(2026, 0, 20), vendorName: 'Bahn', grossCents: 100 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('assigns a founder and remembers the sender address', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    const claim = await ExpenseClaim.create(
      claimDoc({ founderId: null, from: 'Test Person <TP2@Example.org>' }),
    );

    await adminCaller().expenses.claims.assignFounder({
      id: String(claim._id),
      founderId: String(founder._id),
      rememberEmail: true,
    });

    const stored = await ExpenseClaim.findById(claim._id).lean();
    expect(String(stored?.founderId)).toBe(String(founder._id));
    const updated = await Founder.findById(founder._id).lean();
    expect(updated?.emails).toContain('tp2@example.org');
  });

  it('corrects a claim without touching the read', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc());
    const result = await adminCaller().expenses.claims.correct({
      id: String(claim._id),
      grossCents: 4500,
      vatCents: null,
      account: '6640',
    });

    expect(result.parse?.grossCents).toBe(4500);
    expect(result.parse?.vatCents).toBeNull();
    // Fields the admin did not touch keep the read's value.
    expect(result.parse?.invoiceNumber).toBe('R-1');
    expect(result.needsRebook).toBe(false);

    const stored = await ExpenseClaim.findById(claim._id).lean();
    expect(stored?.parse?.grossCents).toBe(4120);
    expect(stored?.corrected?.grossCents).toBe(4500);
  });

  it('flags a booked claim for rebooking instead of rebooking it here', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(
      claimDoc({ status: 'booked', journalEntryId: new mongoose.Types.ObjectId() }),
    );
    const result = await adminCaller().expenses.claims.correct({ id: String(claim._id), grossCents: 4500 });
    expect(result.needsRebook).toBe(true);
    expect((await ExpenseClaim.findById(claim._id).lean())?.status).toBe('booked');
  });

  it('books a received claim and is idempotent on a second click', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    const claim = await ExpenseClaim.create(claimDoc({ founderId: founder._id }));

    const first = await adminCaller().expenses.claims.confirm({ id: String(claim._id) });
    expect(first).toMatchObject({ status: 'booked', rebooked: false });
    expect(first.entryId).toBeTruthy();
    expect(await JournalEntry.countDocuments()).toBe(1);

    const second = await adminCaller().expenses.claims.confirm({ id: String(claim._id) });
    expect(second.entryId).toBe(first.entryId);
    expect(second.rebooked).toBe(false);
    expect(await JournalEntry.countDocuments()).toBe(1);
  });

  it('rebooks after a correction by reversing the live entry', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    const claim = await ExpenseClaim.create(claimDoc({ founderId: founder._id }));
    const first = await adminCaller().expenses.claims.confirm({ id: String(claim._id) });

    await adminCaller().expenses.claims.correct({ id: String(claim._id), account: '6640' });
    const second = await adminCaller().expenses.claims.confirm({ id: String(claim._id) });

    expect(second.rebooked).toBe(true);
    expect(second.entryId).not.toBe(first.entryId);
    const old = await JournalEntry.findById(first.entryId!).lean();
    expect(old?.active).toBe(false);
    const active = await JournalEntry.find({ active: true }, { 'source.kind': 1 }).lean();
    expect(active.map((e) => e.source?.kind).sort()).toEqual(['expense_claim', 'reversal']);
  });

  it('reports a booking problem as a sentence, not a 5xx', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc({ founderId: null }));
    await expect(
      adminCaller().expenses.claims.confirm({ id: String(claim._id) }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED', message: 'Kein Gesellschafter zugeordnet' });
  });

  it('ignores and restores a claim before the payout', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc());
    await adminCaller().expenses.claims.setIgnored({ id: String(claim._id), ignored: true });
    expect((await ExpenseClaim.findById(claim._id).lean())?.status).toBe('ignored');
    await adminCaller().expenses.claims.setIgnored({ id: String(claim._id), ignored: false });
    expect((await ExpenseClaim.findById(claim._id).lean())?.status).toBe('received');
  });

  it('refuses to ignore a claim that is already waiting for its payout', async (ctx) => {
    skipIfNoDb(ctx);
    const claim = await ExpenseClaim.create(claimDoc({ status: 'payoutPending' }));
    await expect(
      adminCaller().expenses.claims.setIgnored({ id: String(claim._id), ignored: true }),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('creates a manual claim with a synthetic mail key', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = (await Founder.findOne())!;
    const created = await adminCaller().expenses.claims.createManual({
      founderId: String(founder._id),
      date: new Date(2026, 1, 3),
      vendorName: 'Bahn',
      grossCents: 990,
      account: '6837',
    });
    const stored = await ExpenseClaim.findById(created.id).lean();
    expect(stored?.status).toBe('received');
    expect(stored?.period).toBe('2026-02');
    expect(stored?.messageId).toMatch(/^manual:/);
    expect(stored?.founderId?.toString()).toBe(String(founder._id));
    expect(stored?.parse?.grossCents).toBe(990);
    expect(stored?.createdBy).toBe('admin-id-1');
  });

  it('reports intakeNow failures instead of throwing (Traefik rewrites 5xx bodies)', async (ctx) => {
    skipIfNoDb(ctx);
    // No receipts folder and no Google token in the test env.
    const result = await adminCaller().expenses.claims.intakeNow();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Belege-Ordner');
  });
});
