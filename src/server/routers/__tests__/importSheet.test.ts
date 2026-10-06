import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { readFileSync } from 'fs';
import path from 'path';
import { appRouter } from '../../trpc';
import { Client } from '../../models/Client';
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
import { Counter } from '../../models/Counter';
import { applySheetImport } from '../../lib/applySheetImport';
import { buildImportPlan } from '../../lib/sheetImport';
import { allocateCustomerNumber, allocateInvoiceNumber } from '../../lib/numbering';

const dir = path.join(__dirname, '..', '..', 'lib', '__tests__', 'fixtures', 'sheet');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const input = {
  clientsCsv: read('clientData.csv'),
  invoicesCsv: read('invoiceData.csv'),
  positionsCsv: read('invoicePositions.csv'),
};

function dbAvailable(): boolean {
  return mongoose.connection.readyState === 1;
}
function skipIfNoDb(ctx: TaskContext): void {
  if (!dbAvailable()) ctx.skip();
}

beforeAll(async () => {
  if (!dbAvailable()) return;
  await Client.init();
  await Invoice.init();
});

beforeEach(async () => {
  if (!dbAvailable()) return;
  await Client.deleteMany({});
  await Invoice.deleteMany({});
  await InvoiceLine.deleteMany({});
  await Counter.deleteMany({});
});

describe('applySheetImport', () => {
  it('dry run writes nothing but reports what would be created', async (ctx) => {
    skipIfNoDb(ctx);
    const report = await applySheetImport(buildImportPlan(input), { dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.clients.created).toHaveLength(3);
    expect(report.invoices.created).toHaveLength(6);
    expect(await Client.countDocuments()).toBe(0);
    expect(await Invoice.countDocuments()).toBe(0);
  });

  it('apply keeps numbers, states, dates and lines; never files PDFs', async (ctx) => {
    skipIfNoDb(ctx);
    const report = await applySheetImport(buildImportPlan(input), { dryRun: false });
    expect(report.invoices.created).toHaveLength(6);

    const legacy = await Invoice.findOne({ invoiceNumber: '1001' });
    expect(legacy).toMatchObject({ legacy: true, status: 'paid', importedPaid: true });
    expect(legacy!.paidAt).toBeUndefined();
    expect(legacy!.reconcileState).toBe('matched');
    expect(legacy!.customerNumber).toBe(10001);
    expect(legacy!.invoiceDate!.getFullYear()).toBe(2020);

    const multi = await Invoice.findOne({ invoiceNumber: '20230511-01' });
    expect(multi!.totals).toMatchObject({ netCents: 472000, vatCents: 89680, grossCents: 561680 });
    expect(await InvoiceLine.countDocuments({ invoiceId: multi!._id })).toBe(6);
    expect(multi!.driveMetadata?.fileName).toBe(
      '2023-05.20230511-01 - beispiel - Moderation Teammeeting.pdf',
    );

    const open = await Invoice.findOne({ invoiceNumber: '20241209-01' });
    expect(open).toMatchObject({ status: 'sent', reconcileState: 'unmatched' });
    expect(open!.sentAt).toBeDefined();

    const canceled = await Invoice.findOne({ invoiceNumber: '20250821-01' });
    expect(canceled!.status).toBe('canceled');
    expect(await Invoice.countDocuments({ kind: 'credit_note' })).toBe(0);

    const client = await Client.findOne({ customerNumber: 10001 });
    expect(String(legacy!.clientId)).toBe(String(client!._id));
  });

  it('is idempotent: re-run creates nothing and never overwrites', async (ctx) => {
    skipIfNoDb(ctx);
    await applySheetImport(buildImportPlan(input), { dryRun: false });
    await Invoice.updateOne({ invoiceNumber: '1001' }, { title: 'changed in queen' });
    const report = await applySheetImport(buildImportPlan(input), { dryRun: false });
    expect(report.clients.created).toHaveLength(0);
    expect(report.invoices.created).toHaveLength(0);
    expect(report.invoices.existing).toHaveLength(6);
    expect(await Invoice.countDocuments()).toBe(6);
    expect(await InvoiceLine.countDocuments()).toBe(11);
    expect((await Invoice.findOne({ invoiceNumber: '1001' }))!.title).toBe('changed in queen');
  });

  it('advances counters so new numbers never collide with imported ones', async (ctx) => {
    skipIfNoDb(ctx);
    await applySheetImport(buildImportPlan(input), { dryRun: false });
    expect(await allocateCustomerNumber()).toBe(10004);
    expect(await allocateInvoiceNumber(new Date(2023, 4, 11))).toBe('20230511-02');
  });

  it('refuses to apply a plan with errors', async (ctx) => {
    skipIfNoDb(ctx);
    const plan = buildImportPlan({
      ...input,
      invoicesCsv: input.invoicesCsv.replace('"20241209-01","10003"', '"20241209-01","19999"'),
    });
    await expect(applySheetImport(plan, { dryRun: false })).rejects.toThrow(/errors/);
    expect(await Invoice.countDocuments()).toBe(0);
  });

  it('resolves Drive file ids by file name and reports misses', async (ctx) => {
    skipIfNoDb(ctx);
    const report = await applySheetImport(buildImportPlan(input), {
      dryRun: false,
      folderId: 'folder-1',
      resolveDriveFile: async (name) =>
        name.includes('20230511-01')
          ? { fileId: 'file-1', link: 'https://drive/file-1', name: `Gebucht - ${name}` }
          : null,
    });
    expect(report.drive.resolved).toEqual(['20230511-01']);
    expect(report.drive.missing).toEqual(
      expect.arrayContaining(['1001', '20241209-01', '20250821-01']),
    );
    const inv = await Invoice.findOne({ invoiceNumber: '20230511-01' });
    expect(inv!.driveMetadata).toMatchObject({
      fileId: 'file-1',
      folderId: 'folder-1',
      fileName: 'Gebucht - 2023-05.20230511-01 - beispiel - Moderation Teammeeting.pdf',
    });
  });

  it('parity: counts and gross per year/state match between sheet and db', async (ctx) => {
    skipIfNoDb(ctx);
    const report = await applySheetImport(buildImportPlan(input), { dryRun: false });
    expect(report.parity.sheet).toEqual(report.parity.db);
    expect(report.parity.sheet.invoices).toBe(6);
    expect(report.parity.sheet.lines).toBe(11);
    expect(report.parity.sheet.grossByYear['2023']).toBe(561680);
    expect(report.parity.ok).toBe(true);
  });
});

describe('admin.importSheet', () => {
  it('requires admin', async () => {
    const caller = appRouter.createCaller({ user: undefined, serviceAuth: false });
    await expect(caller.admin.importSheet({ ...input, dryRun: true })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('defaults to dry run and returns plan report', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = appRouter.createCaller({
      user: { sub: new mongoose.Types.ObjectId().toString(), email: 'a@example.de', role: 'admin' },
      serviceAuth: false,
    });
    const res = await caller.admin.importSheet(input);
    expect(res.dryRun).toBe(true);
    expect(res.mismatches).toHaveLength(1);
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(await Invoice.countDocuments()).toBe(0);
  });
});
