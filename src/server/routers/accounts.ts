import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Account } from '../models/Account';
import { ACCOUNT_TYPES } from '../lib/accounting/skr04';

export const accountsRouter = router({
  list: adminProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) =>
      Account.find(input?.includeArchived ? {} : { archived: false }).sort({ number: 1 }),
    ),

  create: adminProcedure
    .input(
      z.object({
        number: z.string().regex(/^\d{4,5}$/),
        name: z.string().min(1),
        type: z.enum(ACCOUNT_TYPES),
        vatRate: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (await Account.exists({ number: input.number })) {
        throw new TRPCError({ code: 'CONFLICT', message: `Account ${input.number} exists` });
      }
      return Account.create({ ...input, archived: false });
    }),

  setArchived: adminProcedure
    .input(z.object({ number: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const account = await Account.findOneAndUpdate(
        { number: input.number },
        { archived: input.archived },
        { new: true },
      );
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      return account;
    }),
});
