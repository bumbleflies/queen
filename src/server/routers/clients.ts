import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpcInit';
import { Client } from '../models/Client';
import { Invoice } from '../models/Invoice';
import { allocateCustomerNumber } from '../lib/numbering';
import { createClientSchema, updateClientSchema } from '../../shared/schemas/client';

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function withStatusCounts(c: typeof Client.prototype) {
  const [openCount, overdueCount] = await Promise.all([
    Invoice.countDocuments({ clientId: c._id, status: 'sent' }),
    Invoice.countDocuments({ clientId: c._id, status: 'sent', dueDate: { $lt: startOfToday() } }),
  ]);
  return { ...c.toObject(), openCount, overdueCount };
}

export const clientsRouter = router({
  /** List all clients by default; `archivedOnly` returns only archived ones,
   *  `archived` filters explicitly, `includeArchived` is an alias for no filter.
   *  Each row carries `openCount`/`overdueCount` for the status summary. */
  list: authedProcedure
    .input(
      z
        .object({
          archivedOnly: z.boolean().optional(),
          archived: z.boolean().optional(),
          includeArchived: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      async function find(filter: Record<string, unknown>) {
        const rows = await Client.find(filter).sort({ customerNumber: 1 });
        return Promise.all(rows.map(withStatusCounts));
      }
      if (input?.archivedOnly) return find({ archived: true });
      if (input?.archived !== undefined) return find({ archived: input.archived });
      if (input?.includeArchived) return find({});
      return find({});
    }),

  get: authedProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const client = await Client.findById(input.id);
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
    return client;
  }),

  create: authedProcedure.input(createClientSchema).mutation(async ({ input }) => {
    const customerNumber = input.customerNumber ?? (await allocateCustomerNumber());
    try {
      const { customerNumber: _omit, ...rest } = input;
      return await Client.create({ ...rest, customerNumber });
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `customerNumber ${customerNumber} already exists`,
        });
      }
      throw err;
    }
  }),

  update: authedProcedure.input(updateClientSchema).mutation(async ({ input }) => {
    const { id, ...patch } = input;
    const client = await Client.findById(id);
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
    if (patch.customerNumber !== undefined && patch.customerNumber !== client.customerNumber) {
      const referencing = await Invoice.countDocuments({ clientId: client._id });
      if (referencing > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'customerNumber is immutable once invoices exist',
        });
      }
      const existing = await Client.findOne({ customerNumber: patch.customerNumber });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `customerNumber ${patch.customerNumber} already exists`,
        });
      }
    }
    Object.assign(client, patch);
    try {
      await client.save();
    } catch (err) {
      if (isDuplicateKey(err)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'customerNumber already exists' });
      }
      throw err;
    }
    return client;
  }),

  delete: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const client = await Client.findById(input.id);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      const referencing = await Invoice.countDocuments({ clientId: client._id });
      if (referencing > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Client cannot be deleted: invoices reference this client. Archive it instead.',
        });
      }
      await client.deleteOne();
      return { deleted: true as const };
    }),

  archive: authedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const client = await Client.findById(input.id);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      client.archived = true;
      await client.save();
      return client;
    }),
});
