import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure } from '../trpcInit';
import { Supplier } from '../models/Supplier';
import { Account } from '../models/Account';
import { allocateSupplierNumber } from '../lib/numbering';
import { normalizeIban } from '../lib/accounting/suggest';
import { BANK_VAT_RATES } from '../lib/accounting/postingRules';

const fields = z.object({
  name: z.string().trim().min(1),
  ibans: z.array(z.string()).optional(),
  namePatterns: z.array(z.string()).optional(),
  purposePatterns: z.array(z.string()).optional(),
  defaultAccount: z.string().regex(/^\d{4,5}$/).nullable().optional(),
  defaultVatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)).nullable().optional(),
  defaultMode: z.enum(['normal', 'vatOnly']).optional(),
});

function clean(list: string[] | undefined, fn: (s: string) => string = (s) => s.trim()): string[] | undefined {
  return list?.map(fn).filter((s) => s !== '');
}

async function assertAccount(account: string | null | undefined): Promise<void> {
  if (account && !(await Account.exists({ number: account, archived: false }))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unbekanntes oder archiviertes Konto: ${account}` });
  }
}

export const suppliersRouter = router({
  list: authedProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) =>
      Supplier.find(input?.includeArchived ? {} : { archived: false }).sort({ kreditorNumber: 1 }),
    ),

  create: authedProcedure.input(fields).mutation(async ({ input }) => {
    await assertAccount(input.defaultAccount);
    return Supplier.create({
      ...input,
      ibans: clean(input.ibans, normalizeIban) ?? [],
      namePatterns: clean(input.namePatterns) ?? [],
      purposePatterns: clean(input.purposePatterns) ?? [],
      kreditorNumber: await allocateSupplierNumber(),
    });
  }),

  update: authedProcedure
    .input(fields.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await assertAccount(patch.defaultAccount);
      const supplier = await Supplier.findById(id);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kreditor nicht gefunden' });
      if (patch.name !== undefined) supplier.name = patch.name;
      if (patch.ibans !== undefined) supplier.ibans = clean(patch.ibans, normalizeIban) ?? [];
      if (patch.namePatterns !== undefined) supplier.namePatterns = clean(patch.namePatterns) ?? [];
      if (patch.purposePatterns !== undefined) supplier.purposePatterns = clean(patch.purposePatterns) ?? [];
      if (patch.defaultAccount !== undefined) supplier.defaultAccount = patch.defaultAccount ?? undefined;
      if (patch.defaultVatRate !== undefined) supplier.defaultVatRate = patch.defaultVatRate ?? undefined;
      if (patch.defaultMode !== undefined) supplier.defaultMode = patch.defaultMode;
      await supplier.save();
      return supplier;
    }),

  setArchived: authedProcedure
    .input(z.object({ id: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const supplier = await Supplier.findById(input.id);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kreditor nicht gefunden' });
      supplier.archived = input.archived;
      await supplier.save();
      return supplier;
    }),
});
