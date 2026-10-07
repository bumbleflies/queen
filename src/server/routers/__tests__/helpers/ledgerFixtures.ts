import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { appRouter } from '../../../trpc';
import { Account } from '../../../models/Account';
import { BankTransaction } from '../../../models/BankTransaction';
import { Client } from '../../../models/Client';
import { Counter } from '../../../models/Counter';
import { FiscalYear } from '../../../models/FiscalYear';
import { Invoice } from '../../../models/Invoice';
import { InvoiceLine } from '../../../models/InvoiceLine';
import { JournalEntry } from '../../../models/JournalEntry';
import { seedAccounts } from '../../../lib/accounting/seedAccounts';

export const INVOICE_DATE = new Date(2026, 2, 10);

export function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

export function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

export async function initLedgerModels(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([Account.init(), JournalEntry.init(), FiscalYear.init()]);
}

/** Empty every collection the ledger tests touch and re-seed SKR04. */
export async function resetLedgerDb(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([
    Client.deleteMany({}),
    Invoice.deleteMany({}),
    InvoiceLine.deleteMany({}),
    BankTransaction.deleteMany({}),
    FiscalYear.deleteMany({}),
    Account.deleteMany({}),
    Counter.deleteMany({ _id: /^journal:/ }),
    JournalEntry.collection.deleteMany({}), // bypasses the immutability guard
  ]);
  await seedAccounts();
}

/** Client + draft with a rounding-sensitive line + a normal line, marked sent. */
export async function sentInvoice(
  caller: ReturnType<typeof adminCaller>,
  invoiceDate = INVOICE_DATE,
) {
  const client = await caller.clients.create({ name: 'Acme GmbH', invoiceAddress: 'Musterstr. 1' });
  const draft = await caller.invoices.createDraft({
    clientId: (client as any)._id.toString(),
    title: 'Beratung',
    servicePeriod: '03.2026',
  });
  const id = (draft as any)._id.toString();
  await caller.invoices.setLines({
    id,
    lines: [
      { position: '1', description: 'Beratung', quantity: 0.5, unitNetCents: 333, vatRate: 0.19 },
      { position: '2', description: 'Workshop', quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
    ],
  });
  await caller.invoices.markSent({ id, invoiceDate });
  return (await Invoice.findById(id))!;
}
