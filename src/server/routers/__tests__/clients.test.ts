import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';

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
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await InvoiceLine.deleteMany({});
});

describe('clients router', () => {
  it('duplicate customerNumber rejected with CONFLICT', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.clients.create({
      customerNumber: 10001,
      name: 'Acme GmbH',
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    });
    await expect(
      caller.clients.create({
        customerNumber: 10001,
        name: 'Other GmbH',
        invoiceAddress: 'Andere Str. 2\n12345 Berlin',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('customerNumber cannot change once invoices exist (BAD_REQUEST)', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const client = await caller.clients.create({
      name: 'Acme GmbH',
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    });
    await caller.invoices.createDraft({
      clientId: client._id.toString(),
      title: 'Beratung',
      servicePeriod: '05.2025',
    });
    await expect(
      caller.clients.update({ id: client._id.toString(), customerNumber: 99999 }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('list includes openCount and overdueCount per client', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const active = (await caller.clients.create({
      name: 'Acme GmbH',
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    })) as any;
    const quiet = (await caller.clients.create({
      name: 'Quiet UG',
      invoiceAddress: 'Ruhigstr. 2\n12345 Berlin',
    })) as any;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const base = {
      clientId: active._id,
      customerNumber: active.customerNumber,
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
      servicePeriod: '05.2025',
      paymentTermDays: 30,
    };
    await Invoice.create([
      { ...base, invoiceNumber: '20990101-01', title: 'Open work', status: 'sent', dueDate: tomorrow },
      { ...base, invoiceNumber: '20990101-02', title: 'Late work', status: 'sent', dueDate: yesterday },
      { ...base, invoiceNumber: '20990101-03', title: 'Draft work', status: 'draft' },
      { ...base, invoiceNumber: '20990101-04', title: 'Paid work', status: 'paid', dueDate: yesterday },
    ]);
    const rows = (await caller.clients.list()) as any[];
    const row = rows.find((r) => String(r._id) === String(active._id));
    const other = rows.find((r) => String(r._id) === String(quiet._id));
    expect(row.openCount).toBe(2);
    expect(row.overdueCount).toBe(1);
    expect(other.openCount).toBe(0);
    expect(other.overdueCount).toBe(0);
  });

  it('client with invoices cannot be deleted (BAD_REQUEST)', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const client = await caller.clients.create({
      name: 'Acme GmbH',
      invoiceAddress: 'Musterstr. 1\n12345 Berlin',
    });
    await caller.invoices.createDraft({
      clientId: client._id.toString(),
      title: 'Beratung',
      servicePeriod: '05.2025',
    });
    await expect(caller.clients.delete({ id: client._id.toString() })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});
