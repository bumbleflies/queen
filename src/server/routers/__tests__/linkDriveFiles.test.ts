import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';

function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}
function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}
const admin = () =>
  appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });

async function seed() {
  const client = await Client.create({
    customerNumber: 10001,
    name: 'Acme GmbH',
    invoiceAddress: 'Musterstr. 1\n12345 Berlin',
  });
  const base = {
    clientId: client._id,
    customerNumber: 10001,
    invoiceAddress: 'Musterstr. 1',
    title: 'T',
    servicePeriod: '01.2024',
    paymentTermDays: 30,
    status: 'paid',
    totals: { netCents: 100, vatCents: 19, grossCents: 119 },
  };
  await Invoice.create({ ...base, invoiceNumber: '1001', legacy: true, driveMetadata: { fileName: 'a.pdf' } });
  await Invoice.create({
    ...base,
    invoiceNumber: '20240101-01',
    driveMetadata: { fileName: 'b.pdf', fileId: 'already', link: 'https://drive/already' },
  });
}

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Client.deleteMany({});
  await Invoice.deleteMany({});
});

describe('admin.linkDriveFiles', () => {
  it('requires admin', async () => {
    const caller = appRouter.createCaller({ user: undefined, serviceAuth: false });
    await expect(
      caller.admin.linkDriveFiles({ links: [{ invoiceNumber: '1', fileId: 'x' }] }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('dry run by default: reports, writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    await seed();
    const res = await admin().admin.linkDriveFiles({ links: [{ invoiceNumber: '1001', fileId: 'f1' }] });
    expect(res).toMatchObject({ dryRun: true, updated: ['1001'], skipped: [] });
    expect((await Invoice.findOne({ invoiceNumber: '1001' }))!.driveMetadata?.fileId).toBeUndefined();
  });

  it('sets fileId, link and fileName; keeps other drive metadata', async (ctx) => {
    skipIfNoDb(ctx);
    await seed();
    await admin().admin.linkDriveFiles({
      dryRun: false,
      links: [{ invoiceNumber: '1001', fileId: 'f1', fileName: 'Gebucht - a.pdf' }],
    });
    const inv = await Invoice.findOne({ invoiceNumber: '1001' });
    expect(inv!.driveMetadata).toMatchObject({
      fileId: 'f1',
      link: 'https://drive.google.com/file/d/f1/view',
      fileName: 'Gebucht - a.pdf',
    });
  });

  it('never overwrites an existing fileId and reports unknown invoices', async (ctx) => {
    skipIfNoDb(ctx);
    await seed();
    const res = await admin().admin.linkDriveFiles({
      dryRun: false,
      links: [
        { invoiceNumber: '20240101-01', fileId: 'new' },
        { invoiceNumber: '9999', fileId: 'x' },
      ],
    });
    expect(res.updated).toEqual([]);
    expect(res.skipped).toEqual([
      { invoiceNumber: '20240101-01', reason: 'already linked' },
      { invoiceNumber: '9999', reason: 'not found' },
    ]);
    expect((await Invoice.findOne({ invoiceNumber: '20240101-01' }))!.driveMetadata?.fileId).toBe(
      'already',
    );
  });
});
