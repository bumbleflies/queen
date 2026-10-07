import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Client } from '../models/Client';
import { Invoice } from '../models/Invoice';
import { InvoiceLine } from '../models/InvoiceLine';
import { invoiceTotals } from '../lib/money';
import { allocateInvoiceNumber } from '../lib/numbering';
import { assertTransition } from '../lib/invoiceStateMachine';
import { enqueueFileInvoice } from '../jobs/queue';
import { postInvoiceEntry, postPaymentEntry, safeLedger } from '../lib/accounting/ledgerHooks';
import {
  createDraftSchema,
  setLinesSchema,
  updateDraftSchema,
} from '../../shared/schemas/invoice';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Natural order for hierarchical positions ('1' < '1.1' < '2' < '10'). */
function comparePositions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const listSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'canceled']).optional(),
  clientId: z.string().min(1).optional(),
  overdueOnly: z.boolean().optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  search: z.string().optional(),
});

async function getInvoiceOrThrow(id: string) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invoice not found' });
  return invoice;
}

export const invoicesRouter = router({
  list: adminProcedure.input(listSchema.optional()).query(async ({ input }) => {
    const filter: Record<string, unknown> = {};
    if (input?.overdueOnly) {
      filter.status = 'sent';
      filter.dueDate = { $lt: startOfToday() };
    } else if (input?.status) {
      filter.status = input.status;
    }
    if (input?.clientId) filter.clientId = input.clientId;
    if (input?.year !== undefined) {
      filter.invoiceDate = {
        $gte: new Date(input.year, 0, 1),
        $lt: new Date(input.year + 1, 0, 1),
      };
    }
    const search = input?.search?.trim();
    if (search) {
      const rx = new RegExp(escapeRegExp(search), 'i');
      const or: Record<string, unknown>[] = [{ invoiceNumber: rx }, { title: rx }];
      const matchingClients = await Client.find({ name: rx }).select('_id');
      if (matchingClients.length > 0) {
        or.push({ clientId: { $in: matchingClients.map((c) => c._id) } });
      }
      if (/^\d+$/.test(search)) or.push({ customerNumber: Number(search) });
      filter.$or = or;
    }
    return Invoice.find(filter).sort({ createdAt: -1 });
  }),

  get: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const invoice = await getInvoiceOrThrow(input.id);
    const lines = await InvoiceLine.find({ invoiceId: invoice._id });
    lines.sort((a, b) => comparePositions(a.position, b.position));
    return { ...invoice.toObject(), lines };
  }),

  createDraft: adminProcedure.input(createDraftSchema).mutation(async ({ input }) => {
    const client = await Client.findById(input.clientId);
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
    const invoiceNumber = await allocateInvoiceNumber(new Date());
    const invoice = await Invoice.create({
      invoiceNumber,
      legacy: false,
      kind: 'invoice',
      clientId: client._id,
      customerNumber: client.customerNumber,
      invoiceAddress: input.invoiceAddress ?? client.invoiceAddress,
      title: input.title,
      servicePeriod: input.servicePeriod,
      paymentTermDays: input.paymentTermDays ?? client.defaultPaymentTermDays ?? 30,
      currency: input.currency ?? 'EUR',
      status: 'draft',
      totals: { netCents: 0, vatCents: 0, grossCents: 0 },
      payments: [],
      reconcileState: 'unmatched',
      footerNotes: [],
    });
    return invoice;
  }),

  updateDraft: adminProcedure.input(updateDraftSchema).mutation(async ({ input }) => {
    const { id, ...patch } = input;
    const invoice = await getInvoiceOrThrow(id);
    assertTransition(invoice.status, 'update');
    if (patch.title !== undefined) invoice.title = patch.title;
    if (patch.invoiceAddress !== undefined) invoice.invoiceAddress = patch.invoiceAddress;
    if (patch.servicePeriod !== undefined) invoice.servicePeriod = patch.servicePeriod;
    if (patch.paymentTermDays !== undefined) invoice.paymentTermDays = patch.paymentTermDays;
    await invoice.save();
    return invoice;
  }),

  setLines: adminProcedure.input(setLinesSchema).mutation(async ({ input }) => {
    const invoice = await getInvoiceOrThrow(input.id);
    assertTransition(invoice.status, 'setLines');
    const totals = invoiceTotals(
      input.lines.map((l) => ({
        quantity: l.quantity,
        unitNetCents: l.unitNetCents,
        vatRate: l.vatRate,
      })),
    );
    await InvoiceLine.deleteMany({ invoiceId: invoice._id });
    const lines =
      input.lines.length > 0
        ? await InvoiceLine.insertMany(
            input.lines.map((l) => ({ ...l, invoiceId: invoice._id })),
          )
        : [];
    invoice.totals = totals;
    await invoice.save();
    return { ...invoice.toObject(), lines };
  }),

  deleteDraft: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const invoice = await getInvoiceOrThrow(input.id);
      assertTransition(invoice.status, 'delete');
      await InvoiceLine.deleteMany({ invoiceId: invoice._id });
      await invoice.deleteOne();
      return { deleted: true as const };
    }),

  markSent: adminProcedure
    .input(z.object({ id: z.string().min(1), invoiceDate: z.coerce.date().optional() }))
    .mutation(async ({ input, ctx }) => {
      const invoice = await getInvoiceOrThrow(input.id);
      assertTransition(invoice.status, 'markSent');
      const lines = await InvoiceLine.find({ invoiceId: invoice._id });
      if (lines.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot mark sent: invoice needs at least one line',
        });
      }
      const totals = invoiceTotals(
        lines.map((l) => ({
          quantity: l.quantity,
          unitNetCents: l.unitNetCents,
          vatRate: l.vatRate,
        })),
      );
      if (totals.grossCents === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot mark sent: invoice gross must not be zero',
        });
      }
      const invoiceDate = input.invoiceDate ?? new Date();
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + invoice.paymentTermDays);
      if (!invoice.invoiceAddress) {
        const client = await Client.findById(invoice.clientId);
        if (client) invoice.invoiceAddress = client.invoiceAddress;
      }
      invoice.invoiceDate = invoiceDate;
      invoice.dueDate = dueDate;
      invoice.totals = totals;
      invoice.status = 'sent';
      invoice.sentAt = new Date();
      invoice.filingUserId = ctx.user?.sub;
      await invoice.save();
      await safeLedger(`invoice ${invoice.invoiceNumber}`, () =>
        postInvoiceEntry({ invoice, lines, negate: false, createdBy: ctx.user.sub }),
      );
      await enqueueFileInvoice(invoice._id.toString());
      return invoice;
    }),

  markPaid: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        paidAt: z.coerce.date().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const invoice = await getInvoiceOrThrow(input.id);
      assertTransition(invoice.status, 'markPaid');
      invoice.status = 'paid';
      invoice.paidAt = input.paidAt ?? new Date();
      invoice.reconcileState = 'matched';
      if (input.note !== undefined) {
        invoice.footerNotes = [...(invoice.footerNotes ?? []), input.note];
      }
      await invoice.save();
      const paidSoFar = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
      const openCents = invoice.totals.grossCents - paidSoFar;
      if (invoice.kind === 'invoice' && openCents > 0) {
        await safeLedger(`markPaid ${invoice.invoiceNumber}`, () =>
          postPaymentEntry({
            refId: `markPaid:${invoice._id}`,
            date: invoice.paidAt!,
            amountCents: openCents,
            text: `Zahlung ${invoice.invoiceNumber} (manuell)`,
            createdBy: ctx.user.sub,
          }),
        );
      }
      return invoice;
    }),

  cancel: adminProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const original = await getInvoiceOrThrow(input.id);
      assertTransition(original.status, 'cancel');
      const lines = await InvoiceLine.find({ invoiceId: original._id });
      // Exact negation of the stored totals: recomputing from negated lines can
      // differ by a cent because per-line VAT rounds half toward +∞.
      const totals = {
        netCents: -original.totals.netCents,
        vatCents: -original.totals.vatCents,
        grossCents: -original.totals.grossCents,
      };
      const invoiceNumber = await allocateInvoiceNumber(new Date());
      const now = new Date();
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + original.paymentTermDays);
      const creditNote = await Invoice.create({
        invoiceNumber,
        legacy: false,
        kind: 'credit_note',
        cancels: original._id,
        clientId: original.clientId,
        customerNumber: original.customerNumber,
        invoiceAddress: original.invoiceAddress,
        title: `Storno zu ${original.invoiceNumber}`,
        invoiceDate: now,
        servicePeriod: original.servicePeriod,
        paymentTermDays: original.paymentTermDays,
        dueDate,
        currency: original.currency,
        status: 'sent',
        sentAt: now,
        totals,
        payments: [],
        reconcileState: 'unmatched',
        footerNotes: input.reason !== undefined ? [input.reason] : [],
      });
      if (lines.length > 0) {
        await InvoiceLine.insertMany(
          lines.map((l) => ({
            invoiceId: creditNote._id,
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            unitNetCents: -l.unitNetCents,
            vatRate: l.vatRate,
            vatNote: l.vatNote,
            source: l.source,
          })),
        );
      }
      await safeLedger(`credit note ${creditNote.invoiceNumber}`, () =>
        postInvoiceEntry({ invoice: creditNote, lines, negate: true, createdBy: ctx.user.sub }),
      );
      await enqueueFileInvoice(creditNote._id.toString());
      original.status = 'canceled';
      original.canceledAt = new Date();
      await original.save();
      return { original, creditNote };
    }),
});
