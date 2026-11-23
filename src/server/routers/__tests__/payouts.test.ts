import { describe, it, expect, beforeAll, beforeEach, vi, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { ExpenseClaim } from '../../models/ExpenseClaim';
import { Founder } from '../../models/Founder';
import { JournalEntry } from '../../models/JournalEntry';
import { Payout } from '../../models/Payout';
import { Counter } from '../../models/Counter';
import { bookExpenseClaim } from '../../lib/accounting/claimBooking';
import { epcPayload } from '../../lib/payments/epcQr';
import { payoutPurpose } from '../payouts';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

const mailer = vi.hoisted(() => ({ call: vi.fn(async (_input: unknown) => 'gmail-id') }));
vi.mock('../../lib/payouts/payoutMail', () => ({
  resolvePayoutMailer: vi.fn(async () => mailer.call),
}));

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

async function makeFounder(overrides: Partial<typeof FOUNDER> = {}) {
  return Founder.create({ ...FOUNDER, ...overrides });
}

/** A real booked claim: status booked + an active journal entry. */
async function bookedClaim(founderId: unknown, grossCents: number, period: string, receivedAt: Date) {
  const claim = await ExpenseClaim.create({
    messageId: `msg-${new mongoose.Types.ObjectId()}`,
    attachmentId: 'a1',
    sha256: `sha-${new mongoose.Types.ObjectId()}`,
    mailbox: 'expenses@bumbleflies.de',
    from: 'chris@bumbleflies.de',
    subject: 'Spesen',
    receivedAt,
    fileName: 'beleg.pdf',
    founderId,
    status: 'received',
    period,
    parse: {
      date: receivedAt,
      vendorName: 'Bahn',
      grossCents,
      netCents: grossCents,
      vatCents: 0,
      vatRate: 0,
      account: '6837',
      addressedToCompany: false,
      currency: 'EUR',
    },
    createdBy: 'test',
  });
  const entry = await bookExpenseClaim({ claimId: String(claim._id), actor: 'test' });
  expect(entry.active).toBe(true);
  return claim;
}

beforeAll(initLedgerModels);

beforeEach(async (_ctx: TaskContext) => {
  if (mongoose.connection.readyState !== 1) return;
  await resetLedgerDb();
  await Promise.all([
    ExpenseClaim.deleteMany({}),
    Founder.deleteMany({}),
    Payout.deleteMany({}),
    Counter.deleteMany({ _id: /^payout:/ }),
    JournalEntry.collection.deleteMany({}),
  ]);
  mailer.call.mockClear();
  mailer.call.mockImplementation(async () => 'gmail-id');
});

describe('payoutPurpose (pure)', () => {
  it('includes the period only when every claim shares it', () => {
    expect(payoutPurpose('ChrisD', ['2026-01', '2026-01'], 'SP-2026-0001')).toBe('Spesen ChrisD 2026-01 SP-2026-0001');
    expect(payoutPurpose('ChrisD', ['2026-01', '2026-02'], 'SP-2026-0001')).toBe('Spesen ChrisD SP-2026-0001');
  });
});

describe('payout eligibility and aggregation', () => {
  it('offers only booked claims with an active entry and sums their gross', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    const first = await bookedClaim(founder._id, 4120, '2026-01', new Date(2026, 0, 5));
    const second = await bookedClaim(founder._id, 880, '2026-01', new Date(2026, 0, 6));
    // A received claim without a journal entry must not appear.
    await ExpenseClaim.create({
      messageId: 'msg-received',
      attachmentId: 'a1',
      sha256: 'sha-received',
      mailbox: 'expenses@bumbleflies.de',
      receivedAt: new Date(2026, 0, 7),
      fileName: 'offen.pdf',
      founderId: founder._id,
      status: 'received',
      period: '2026-01',
      parse: { grossCents: 99999, account: '6837' },
      createdBy: 'test',
    });

    const preview = await adminCaller().payouts.preview({ founderId: String(founder._id) });
    expect(preview.amountCents).toBe(5000);
    expect(preview.claims).toHaveLength(2);
    expect(new Set(preview.claims.map((c) => c.id))).toEqual(new Set([String(first._id), String(second._id)]));
    expect(preview.purpose).toMatch(/^Spesen ChrisD 2026-01 SP-\d{4}-\d{4}$/);
  });

  it('refuses a founder without an IBAN in preview and create', async (ctx) => {
    skipIfNoDb(ctx);
    // The schema requires an IBAN; only legacy data can lack one, so insert it
    // directly the way such a row would exist in production.
    const inserted = await Founder.collection.insertOne({
      name: FOUNDER.name,
      shortName: FOUNDER.shortName,
      emails: FOUNDER.emails,
      loginEmail: FOUNDER.loginEmail,
      bic: '',
      liabilityAccount: '3500',
      active: true,
      createdBy: 'test',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const founder = await Founder.findById(inserted.insertedId);
    expect(founder).toBeTruthy();
    await expect(adminCaller().payouts.preview({ founderId: String(founder!._id) })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
    await expect(adminCaller().payouts.create({ founderId: String(founder!._id) })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    });
  });

  it('creates one draft, adds to it on a second call, and requires a new draft after release', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    const first = await bookedClaim(founder._id, 1000, '2026-01', new Date(2026, 0, 5));
    const second = await bookedClaim(founder._id, 2000, '2026-02', new Date(2026, 0, 6));
    const caller = adminCaller();

    const draft = await caller.payouts.create({ founderId: String(founder._id), claimIds: [String(first._id)] });
    expect(draft.status).toBe('draft');
    expect(draft.amountCents).toBe(1000);

    const added = await caller.payouts.create({ founderId: String(founder._id), claimIds: [String(second._id)] });
    expect(added.id).toBe(draft.id);
    expect(added.claimIds).toHaveLength(2);
    expect(added.amountCents).toBe(3000);
    // Different periods: no period in the purpose.
    expect(added.purpose).toBe(`Spesen ChrisD ${added.number}`);

    await caller.payouts.release({ id: draft.id });
    // A new draft needs a fresh open claim — the released ones are locked.
    await bookedClaim(founder._id, 300, '2026-03', new Date(2026, 0, 10));
    const next = await caller.payouts.create({ founderId: String(founder._id) });
    expect(next.id).not.toBe(draft.id);
    expect(next.status).toBe('draft');
  });
});

describe('payout lifecycle', () => {
  it('release locks claims, mails into the newest claim thread, and warns only on mail failure', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    await bookedClaim(founder._id, 1000, '2026-01', new Date(2026, 0, 5));
    const newest = await bookedClaim(founder._id, 2000, '2026-01', new Date(2026, 0, 9));
    newest.messageId = 'gmail-newest';
    await newest.save();
    const caller = adminCaller();

    const draft = await caller.payouts.create({ founderId: String(founder._id) });
    const released = await caller.payouts.release({ id: draft.id });
    expect(released.status).toBe('released');
    expect(released.releasedAt).toBeTruthy();

    const claims = await ExpenseClaim.find({ _id: { $in: draft.claimIds } });
    expect(claims.every((claim) => claim.status === 'payoutPending')).toBe(true);
    expect(mailer.call).toHaveBeenCalledTimes(1);
    const input = mailer.call.mock.calls[0][0] as {
      payout: { number: string; amountCents: number };
      founder: { loginEmail: string };
      newestClaim?: { messageId?: string | null };
    };
    expect(input.payout.number).toBe(released.number);
    expect(input.payout.amountCents).toBe(3000);
    expect(input.founder.loginEmail).toBe(FOUNDER.loginEmail);
    // The reply must go into the thread of the newest claim, not the older one.
    expect(input.newestClaim?.messageId).toBe('gmail-newest');

    // A failing mail never un-releases the payout.
    mailer.call.mockImplementationOnce(async () => {
      throw new Error('gmail.send fehlt');
    });
    const other = await makeFounder({ shortName: 'Other', emails: ['other@bumbleflies.de'], loginEmail: 'other@bumbleflies.de' });
    const otherClaim = await bookedClaim(other._id, 500, '2026-01', new Date(2026, 0, 3));
    const otherDraft = await caller.payouts.create({ founderId: String(other._id), claimIds: [String(otherClaim._id)] });
    expect((await caller.payouts.release({ id: otherDraft.id })).status).toBe('released');
  });

  it('returns no QR before release and the exact EPC payload after release', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    const claim = await bookedClaim(founder._id, 1234, '2026-01', new Date(2026, 0, 5));
    const caller = adminCaller();
    const draft = await caller.payouts.create({ founderId: String(founder._id), claimIds: [String(claim._id)] });

    expect((await caller.payouts.get({ number: draft.number })).qr).toBeNull();
    await expect(caller.payouts.qr({ id: draft.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    await caller.payouts.release({ id: draft.id });
    const qr = await caller.payouts.qr({ id: draft.id });
    expect(qr.payload).toBe(
      epcPayload({
        name: founder.name,
        iban: founder.iban,
        amountCents: draft.amountCents,
        purpose: draft.purpose,
      }),
    );
    expect(qr.amountCents).toBe(1234);
    expect((await caller.payouts.get({ number: draft.number })).qr).toBe(qr.payload);

    await caller.payouts.markExecuted({ id: draft.id });
    expect((await caller.payouts.qr({ id: draft.id })).payload).toBe(qr.payload);
  });

  it('refuses cancel after execution but returns claims to booked before it', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    const claim = await bookedClaim(founder._id, 1000, '2026-01', new Date(2026, 0, 5));
    const caller = adminCaller();
    const draft = await caller.payouts.create({ founderId: String(founder._id), claimIds: [String(claim._id)] });
    await caller.payouts.release({ id: draft.id });
    await caller.payouts.cancel({ id: draft.id });
    expect((await ExpenseClaim.findById(claim._id))?.status).toBe('booked');
    expect((await Payout.findById(draft.id))?.status).toBe('canceled');
    await expect(caller.payouts.qr({ id: draft.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });

    const again = await caller.payouts.create({ founderId: String(founder._id), claimIds: [String(claim._id)] });
    await caller.payouts.release({ id: again.id });
    await caller.payouts.markExecuted({ id: again.id });
    await expect(caller.payouts.cancel({ id: again.id })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('keeps get admin-only', async (ctx) => {
    skipIfNoDb(ctx);
    const founder = await makeFounder();
    const claim = await bookedClaim(founder._id, 1000, '2026-01', new Date(2026, 0, 5));
    const draft = await adminCaller().payouts.create({ founderId: String(founder._id), claimIds: [String(claim._id)] });
    const user = appRouter.createCaller({
      user: { sub: 'u', email: 'someone@bumbleflies.de', role: 'user' },
      serviceAuth: false,
    });
    await expect(user.payouts.get({ number: draft.number })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
