import { describe, it, expect, beforeEach, beforeAll, vi, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
import { enqueueFileInvoice } from '../../jobs/queue';
import { initLedgerModels, resetLedgerDb } from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({
  enqueueFileInvoice: vi.fn(async (_invoiceId: string) => {}),
}));

function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}

function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  if (!dbAvailable()) return;
  await Client.init();
  await Invoice.init();
  await InvoiceLine.init();
  await initLedgerModels();
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  vi.clearAllMocks();
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await InvoiceLine.deleteMany({});
  await resetLedgerDb(); // seeds accounts for the ledger hooks
});

async function createClientWithDraft(caller: ReturnType<typeof adminCaller>) {
  const client = await caller.clients.create({
    name: 'Acme GmbH',
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
  });
  const draft = await caller.invoices.createDraft({
    clientId: (client as any)._id.toString(),
    title: 'Beratung Mai',
    servicePeriod: '05.2025',
  });
  return { client, draft };
}

const line = {
  position: '1',
  description: 'Beratung',
  quantity: 1,
  unitNetCents: 10000,
  vatRate: 0.19 as const,
};

describe('invoices router', () => {
  it('updateDraft/setLines on sent → BAD_REQUEST /Only draft/', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    await caller.invoices.setLines({ id, lines: [line] });
    await caller.invoices.markSent({ id });
    await expect(caller.invoices.updateDraft({ id, title: 'Changed' })).rejects.toThrowError(
      /Only draft/,
    );
    await expect(caller.invoices.setLines({ id, lines: [line] })).rejects.toThrowError(
      /Only draft/,
    );
  });

  it('markSent sets invoiceDate, dueDate, snapshots address, enqueues filing job', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    await caller.invoices.setLines({ id, lines: [line] });
    const sent = (await caller.invoices.markSent({ id })) as any;
    expect(sent.status).toBe('sent');
    expect(sent.invoiceDate).toBeDefined();
    const invoiceDate = new Date(sent.invoiceDate);
    const dueDate = new Date(sent.dueDate);
    const diffDays = Math.round(
      (dueDate.getTime() - invoiceDate.getTime()) / (24 * 60 * 60 * 1000),
    );
    expect(diffDays).toBe(sent.paymentTermDays);
    expect(sent.invoiceAddress).toContain('Musterstr. 1');
    expect(sent.filingUserId).toBe('admin-id-1');
    expect(enqueueFileInvoice).toHaveBeenCalledTimes(1);
    expect(enqueueFileInvoice).toHaveBeenCalledWith(id);
  });

  it('cancel on sent creates credit_note with negated lines + cancels; original → canceled', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    await caller.invoices.setLines({ id, lines: [line] });
    await caller.invoices.markSent({ id });
    const result = (await caller.invoices.cancel({ id })) as any;
    expect(result.creditNote.kind).toBe('credit_note');
    expect(result.creditNote.cancels.toString()).toBe(id);
    expect(result.creditNote.status).toBe('sent');
    expect(result.creditNote.totals).toMatchObject({
      netCents: -10000,
      vatCents: -1900,
      grossCents: -11900,
    });
    const creditLines = await caller.invoices.get({ id: result.creditNote._id.toString() });
    expect((creditLines as any).lines[0].unitNetCents).toBe(-10000);
    expect(result.original.status).toBe('canceled');
    expect(enqueueFileInvoice).toHaveBeenCalledWith(result.creditNote._id.toString());
  });

  it('cancel negates the stored totals exactly (no per-line re-rounding)', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    // 50 @ 19% → VAT rounds 9.5 up to 10 (gross 60); re-rounding the negated
    // line would yield -9 (gross -59) instead of the exact -10 / -60.
    await caller.invoices.setLines({
      id,
      lines: [{ position: '1', description: 'Rundung', quantity: 1, unitNetCents: 50, vatRate: 0.19 }],
    });
    await caller.invoices.markSent({ id });
    const result = (await caller.invoices.cancel({ id })) as any;
    expect(result.creditNote.totals).toMatchObject({
      netCents: -50,
      vatCents: -10,
      grossCents: -60,
    });
  });

  it('cancel on paid → BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    await caller.invoices.setLines({ id, lines: [line] });
    await caller.invoices.markSent({ id });
    await caller.invoices.markPaid({ id });
    await expect(caller.invoices.cancel({ id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('deleteDraft on sent → BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const { draft } = await createClientWithDraft(caller);
    const id = (draft as any)._id.toString();
    await caller.invoices.setLines({ id, lines: [line] });
    await caller.invoices.markSent({ id });
    await expect(caller.invoices.deleteDraft({ id })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });

  it('list {overdueOnly:true} returns only sent with dueDate < today', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const client = (await caller.clients.create({
      name: 'Acme GmbH',
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    })) as any;
    const clientId = client._id.toString();

    // overdue: sent long ago with short term
    const d1 = (await caller.invoices.createDraft({
      clientId,
      title: 'Overdue',
      servicePeriod: '01.2020',
      paymentTermDays: 1,
    })) as any;
    await caller.invoices.setLines({ id: d1._id.toString(), lines: [line] });
    await caller.invoices.markSent({
      id: d1._id.toString(),
      invoiceDate: new Date('2020-01-05'),
    });

    // not overdue: draft (no dueDate)
    await caller.invoices.createDraft({
      clientId,
      title: 'Draft one',
      servicePeriod: '01.2026',
    });

    const overdue = (await caller.invoices.list({ overdueOnly: true })) as any[];
    expect(overdue.length).toBe(1);
    expect(overdue[0].title).toBe('Overdue');
  });
});
