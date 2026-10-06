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
