/**
 * Write an ImportPlan (sheetImport.ts) to MongoDB. Idempotent: clients are
 * keyed by customerNumber, invoices by invoiceNumber; anything that already
 * exists is reported and left untouched (issued invoices are immutable).
 * Never enqueues PDF filing — the Sheet's PDFs already exist in Drive.
 */
import type { Types } from 'mongoose';
import { Client } from '../models/Client';
import { Counter } from '../models/Counter';
import { Invoice } from '../models/Invoice';
import { InvoiceLine } from '../models/InvoiceLine';
import type { ImportPlan, PlannedInvoice } from './sheetImport';

export interface DriveFileRef {
  fileId: string;
  link: string;
}

export interface ApplyOptions {
  dryRun: boolean;
  folderId?: string;
  /** Look up an existing PDF in the invoices folder by exact file name. */
  resolveDriveFile?: (fileName: string) => Promise<DriveFileRef | null>;
}

export interface ParitySummary {
  clients: number;
  invoices: number;
  lines: number;
  grossByYear: Record<string, number>;
  grossByState: Record<string, number>;
}

export interface ImportReport {
  dryRun: boolean;
  clients: { created: number[]; existing: number[] };
  invoices: { created: string[]; existing: string[] };
  drive: { resolved: string[]; missing: string[]; lookupError?: string };
  parity: { sheet: ParitySummary; db: ParitySummary; ok: boolean };
}

function yearKey(d: Date | null | undefined): string {
  return d ? String(d.getFullYear()) : 'none';
}

function add(map: Record<string, number>, key: string, cents: number): void {
  map[key] = (map[key] ?? 0) + cents;
}

function sheetParity(plan: ImportPlan): ParitySummary {
  const grossByYear: Record<string, number> = {};
  const grossByState: Record<string, number> = {};
  for (const inv of plan.invoices) {
    add(grossByYear, yearKey(inv.invoiceDate), inv.sheetTotals.grossCents);
    add(grossByState, inv.status, inv.sheetTotals.grossCents);
  }
  return {
    clients: plan.clients.length,
    invoices: plan.invoices.length,
    lines: plan.invoices.reduce((n, i) => n + i.lines.length, 0),
    grossByYear,
    grossByState,
  };
}

async function dbParity(plan: ImportPlan): Promise<ParitySummary> {
  const numbers = plan.invoices.map((i) => i.invoiceNumber);
  const invoices = await Invoice.find({ invoiceNumber: { $in: numbers } });
  const grossByYear: Record<string, number> = {};
  const grossByState: Record<string, number> = {};
  for (const inv of invoices) {
    add(grossByYear, yearKey(inv.invoiceDate), inv.totals.grossCents);
    add(grossByState, inv.status, inv.totals.grossCents);
  }
  return {
    clients: await Client.countDocuments({
      customerNumber: { $in: plan.clients.map((c) => c.customerNumber) },
    }),
    invoices: invoices.length,
    lines: await InvoiceLine.countDocuments({ invoiceId: { $in: invoices.map((i) => i._id) } }),
    grossByYear,
    grossByState,
  };
}

function sortedJson(p: ParitySummary): string {
  const sort = (o: Record<string, number>) =>
    Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ ...p, grossByYear: sort(p.grossByYear), grossByState: sort(p.grossByState) });
}

/** Raise counters to at least the imported maxima ($max never lowers them). */
async function advanceCounters(plan: ImportPlan): Promise<void> {
  const maxCustomer = Math.max(0, ...plan.clients.map((c) => c.customerNumber));
  if (maxCustomer > 0) {
    await Counter.updateOne({ _id: 'customer' }, { $max: { seq: maxCustomer } }, { upsert: true });
  }
  const perDay = new Map<string, number>();
  for (const inv of plan.invoices) {
    const m = /^(\d{8})-(\d{2})$/.exec(inv.invoiceNumber);
    if (!m) continue;
    perDay.set(m[1], Math.max(perDay.get(m[1]) ?? 0, Number(m[2])));
  }
  for (const [stamp, seq] of perDay) {
    await Counter.updateOne({ _id: `invoice:${stamp}` }, { $max: { seq } }, { upsert: true });
  }
}

function invoiceDoc(inv: PlannedInvoice, clientId: Types.ObjectId | undefined) {
  const issued = inv.status !== 'draft';
  return {
    invoiceNumber: inv.invoiceNumber,
    legacy: inv.legacy,
    kind: 'invoice' as const,
    clientId,
    customerNumber: inv.customerNumber,
    invoiceAddress: inv.invoiceAddress,
    title: inv.title,
    invoiceDate: inv.invoiceDate,
    servicePeriod: inv.servicePeriod,
    paymentTermDays: inv.paymentTermDays,
    dueDate: inv.dueDate,
    currency: 'EUR',
    status: inv.status,
    // Exact send/cancel times are unknown; the invoice date is the best proxy for sentAt.
    sentAt: issued ? inv.invoiceDate : undefined,
    totals: inv.totals,
    payments: [],
    reconcileState: inv.status === 'paid' ? ('matched' as const) : ('unmatched' as const),
    importedPaid: inv.importedPaid,
    footerNotes: [],
  };
}

export async function applySheetImport(
  plan: ImportPlan,
  options: ApplyOptions,
): Promise<ImportReport> {
  if (!options.dryRun && plan.errors.length > 0) {
    throw new Error(`Import plan has ${plan.errors.length} errors; fix them before applying`);
  }
  const report: ImportReport = {
    dryRun: options.dryRun,
    clients: { created: [], existing: [] },
    invoices: { created: [], existing: [] },
    drive: { resolved: [], missing: [] },
    parity: { sheet: sheetParity(plan), db: sheetParity(plan), ok: false },
  };

  // --- Clients ---
  const clientIds = new Map<number, Types.ObjectId>();
  for (const c of plan.clients) {
    const existing = await Client.findOne({ customerNumber: c.customerNumber });
    if (existing) {
      report.clients.existing.push(c.customerNumber);
      clientIds.set(c.customerNumber, existing._id);
      continue;
    }
    report.clients.created.push(c.customerNumber);
    if (!options.dryRun) {
      const created = await Client.create(c);
      clientIds.set(c.customerNumber, created._id);
    }
  }

  // --- Invoices ---
  for (const inv of plan.invoices) {
    if (await Invoice.exists({ invoiceNumber: inv.invoiceNumber })) {
      report.invoices.existing.push(inv.invoiceNumber);
      continue;
    }
    report.invoices.created.push(inv.invoiceNumber);

    let drive: DriveFileRef | null = null;
    if (inv.driveFileName && options.resolveDriveFile && !report.drive.lookupError) {
      try {
        drive = await options.resolveDriveFile(inv.driveFileName);
      } catch (err) {
        report.drive.lookupError = err instanceof Error ? err.message : String(err);
      }
    }
    if (drive) report.drive.resolved.push(inv.invoiceNumber);
    else if (inv.status !== 'draft') report.drive.missing.push(inv.invoiceNumber);

    if (options.dryRun) continue;
    const created = await Invoice.create({
      ...invoiceDoc(inv, clientIds.get(inv.customerNumber)),
      driveMetadata: inv.driveFileName
        ? {
            fileName: inv.driveFileName,
            ...(drive ? { fileId: drive.fileId, link: drive.link, folderId: options.folderId } : {}),
          }
        : undefined,
    });
    if (inv.lines.length > 0) {
      await InvoiceLine.insertMany(inv.lines.map((l) => ({ ...l, invoiceId: created._id })));
    }
  }

  if (!options.dryRun) await advanceCounters(plan);

  report.parity.db = await dbParity(plan);
  report.parity.ok = sortedJson(report.parity.sheet) === sortedJson(report.parity.db);
  return report;
}
