import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
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

export const clientsRouter = router({
  /** List all clients by default; `archivedOnly` returns only archived ones,
   *  `archived` filters explicitly, `includeArchived` is an alias for no filter. */
  list: adminProcedure
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
      if (input?.archivedOnly) return Client.find({ archived: true }).sort({ customerNumber: 1 });
      if (input?.archived !== undefined)
        return Client.find({ archived: input.archived }).sort({ customerNumber: 1 });
      if (input?.includeArchived) return Client.find({}).sort({ customerNumber: 1 });
      return Client.find({}).sort({ customerNumber: 1 });
    }),

  get: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const client = await Client.findById(input.id);
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
    return client;
  }),

  create: adminProcedure.input(createClientSchema).mutation(async ({ input }) => {
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

  update: adminProcedure.input(updateClientSchema).mutation(async ({ input }) => {
    const { id, ...patch } = input;
    const client = await Client.findById(id);
    if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
    if (patch.customerNumber !== undefined && patch.customerNumber !== client.customerNumber) {
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

  delete: adminProcedure
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

  archive: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const client = await Client.findById(input.id);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND', message: 'Client not found' });
      client.archived = true;
      await client.save();
      return client;
    }),
});
