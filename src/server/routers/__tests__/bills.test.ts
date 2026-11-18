import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { Bill } from '../../models/Bill';
import { BankTransaction } from '../../models/BankTransaction';
import { appRouter } from '../../trpc';
import { rematchBills, type BillIntakeDeps } from '../../jobs/billIntake';
import type { OutgoingMail } from '../../services/GmailService';
import { gmailWith, intakeDeps } from '../../jobs/__tests__/helpers/intakeFixtures';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

// "Jetzt abrufen" resolves the same production deps the cron does. Only the
// resolution is swapped; the job itself is the real one.
const intake = vi.hoisted(() => ({ deps: null as BillIntakeDeps | null }));
vi.mock('../../jobs/billIntake', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../jobs/billIntake')>();
  return {
    ...actual,
    resolveBillIntakeDeps: async () => intake.deps ?? actual.resolveBillIntakeDeps(),
  };
});

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
  intake.deps = null;
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
    await rematchBills({ year: 2026 });
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows).toHaveLength(1);
    expect(rows[0].transaction?.id).toBe(String(tx._id));
    expect(rows[0].transaction?.amountCents).toBe(11900);
    expect(rows[0].matchMethod).toBe('amount');
    expect(rows[0].parse?.grossCents).toBe(11900);
  });

  it('pairs a bill by IBAN + purpose when amounts differ', async (ctx) => {
    skipIfNoDb(ctx);
    // Grade 2: IBAN equal + invoice number in purpose links even when amounts
    // differ (partial payment). amountMismatch records the difference.
    await Bill.create({ ...BILL, parse: { ...BILL.parse, invoiceNumber: '98848178', grossCents: 4915 } });
    const tx = await bankTx({ amountCents: 4000, description: 'Kundennr. 103855369 Belegnr. 98848178', counterpartyIban: 'DE44500921000000059512' });
    await rematchBills({ year: 2026 });
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].transaction?.id).toBe(String(tx._id));
    expect(rows[0].matchMethod).toBe('iban+purpose');
    expect(rows[0].amountMismatch).toBe(4915 - 4000);
    expect(rows[0].transaction?.amountCents).toBe(4000);
  });

  it('leaves a bill without a fitting payment unmatched', async (ctx) => {
    skipIfNoDb(ctx);
    await Bill.create(BILL);
    await bankTx({ amountCents: 500 });
    await rematchBills({ year: 2026 });
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

describe('bills.correct', () => {
  const wrongRead = {
    ...BILL.parse,
    vendorName: 'Hetzner Online GmbH • Industriestr. 25 • 91710 Gunzenhausen • Germany',
    grossCents: 202600,
    netCents: null,
    vatCents: 33626297200,
    vatRate: null,
  };

  it('is admin-only', async (ctx) => {
    skipIfNoDb(ctx);
    const bill = await Bill.create({ ...BILL, parse: wrongRead });
    await expect(
      userCaller().bills.correct({ id: String(bill._id), grossCents: 1214 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('reports an unknown bill instead of creating one', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(
      adminCaller().bills.correct({ id: String(new mongoose.Types.ObjectId()), grossCents: 1214 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('lets the correction win over the read, keeping the read itself', async (ctx) => {
    skipIfNoDb(ctx);
    const bill = await Bill.create({ ...BILL, parse: wrongRead });
    await adminCaller().bills.correct({
      id: String(bill._id),
      grossCents: 1214,
      netCents: 1020,
      vatCents: null,
      vatRate: null,
    });

    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].parse?.grossCents).toBe(1214);
    expect(rows[0].parse?.netCents).toBe(1020);
    expect(rows[0].parse?.vatCents).toBeNull();
    // Untouched fields keep the read's value.
    expect(rows[0].parse?.invoiceNumber).toBe('R-1');
    expect(rows[0].corrected).toMatchObject({ by: 'admin-id-1' });

    // The read stays on the document: a later reread repairs it, never the human's numbers.
    const stored = await Bill.findById(bill._id).lean();
    expect(stored?.parse?.grossCents).toBe(202600);
    expect(stored?.corrected?.grossCents).toBe(1214);
  });

  it('survives a re-read of the same PDF', async (ctx) => {
    skipIfNoDb(ctx);
    const bill = await Bill.create({ ...BILL, parse: wrongRead });
    await adminCaller().bills.correct({ id: String(bill._id), grossCents: 1214 });

    // What bills.reread does: replace the read, leave the correction alone.
    await Bill.findByIdAndUpdate(bill._id, { $set: { parse: { ...wrongRead, grossCents: 202600 } } });

    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].parse?.grossCents).toBe(1214);
  });

  it('feeds the corrected amount into the bill↔payment match', async (ctx) => {
    skipIfNoDb(ctx);
    const bill = await Bill.create({ ...BILL, parse: { ...wrongRead, iban: '' } });
    const tx = await bankTx({ amountCents: 1214, counterpartyIban: null, description: 'Hetzner' });
    await rematchBills({ year: 2026 });
    expect((await adminCaller().bills.list({ year: 2026 }))[0].transaction).toBeNull();

    await adminCaller().bills.correct({ id: String(bill._id), grossCents: 1214 });
    await rematchBills({ year: 2026 });
    const rows = await adminCaller().bills.list({ year: 2026 });
    expect(rows[0].transaction?.id).toBe(String(tx._id));
    expect(rows[0].matchMethod).toBe('amount');
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

  it('intakeNow reports the reason instead of a 5xx (Traefik rewrites those bodies)', async (ctx) => {
    skipIfNoDb(ctx);
    // No Drive folder saved and no Google token in the test env.
    const result = await adminCaller().bills.intakeNow();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Belege-Ordner');
  });

  it('intakeNow answers the mail in its thread, exactly like the hourly cron', async (ctx) => {
    skipIfNoDb(ctx);
    const { client } = gmailWith([
      { id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 router') },
    ]);
    const replies: OutgoingMail[] = [];
    intake.deps = intakeDeps({
      client,
      sendReply: async (mail) => {
        replies.push(mail);
        return 'sent-1';
      },
    });

    const result = await adminCaller().bills.intakeNow();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(1);
    expect(result.notified).toBe(1);
    expect(result.notifyErrors).toEqual([]);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      to: 'bills@bumbleflies.de',
      subject: 'Re: Ihre Rechnung',
      threadId: 'thread-m1',
      inReplyTo: '<m1@mail.example>',
    });
    expect(replies[0].text).toContain('abgelegt als rechnung.pdf');
    expect(replies[0].text).toContain('https://queen.example/finance?tab=bills');
  });

  it('intakeNow reports a reply it could not send without failing the run', async (ctx) => {
    skipIfNoDb(ctx);
    const { client } = gmailWith([
      { id: 'm1', fileName: 'rechnung.pdf', bytes: Buffer.from('%PDF-1.4 router') },
    ]);
    intake.deps = intakeDeps({
      client,
      sendReply: async () => {
        throw new Error('es fehlt der Zugriff `gmail.send`');
      },
    });

    const result = await adminCaller().bills.intakeNow();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.created).toBe(1);
    expect(result.notified).toBe(0);
    expect(result.notifyErrors).toHaveLength(1);
    expect(result.notifyErrors[0]).toContain('gmail.send');
    expect(await Bill.countDocuments()).toBe(1);
  });
});
