import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import { Supplier } from '../models/Supplier';
import { Account } from '../models/Account';
import { allocateSupplierNumber } from '../lib/numbering';
import { normalizeIban, suggest } from '../lib/accounting/suggest';
import { openTransactions } from '../lib/accounting/bankCoverage';
import { applySupplierImport, toExport } from '../lib/accounting/supplierImport';
import { BANK_VAT_RATES } from '../lib/accounting/postingRules';

const fields = z.object({
  name: z.string().trim().min(1),
  ibans: z.array(z.string()).optional(),
  namePatterns: z.array(z.string()).optional(),
  purposePatterns: z.array(z.string()).optional(),
  defaultAccount: z.string().regex(/^\d{4,5}$/).nullable().optional(),
  defaultVatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)).nullable().optional(),
  defaultMode: z.enum(['normal', 'vatOnly', 'reverseCharge']).optional(),
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

  /** Rules with how many open bank rows each one currently wins (same priority as the inbox). */
  overview: authedProcedure
    .input(z.object({ year: z.number().int().min(2000).max(2100), includeArchived: z.boolean().optional() }))
    .query(async ({ input }) => {
      const [all, open] = await Promise.all([Supplier.find({}).sort({ kreditorNumber: 1 }), openTransactions(input.year)]);
      const active = all.filter((s) => !s.archived);
      const hits = new Map<string, number>();
      for (const tx of open) {
        const id = suggest(tx, active)?.supplierId;
        if (id) hits.set(id, (hits.get(id) ?? 0) + 1);
      }
      return all
        .filter((s) => input.includeArchived || !s.archived)
        .map((s) => ({ id: String(s._id), ...toExport(s), openHits: hits.get(String(s._id)) ?? 0 }));
    }),

  /** All rules (incl. archived) in the import format. */
  exportJson: adminProcedure.query(async () => (await Supplier.find({}).sort({ kreditorNumber: 1 })).map(toExport)),

  /** Upsert rules from JSON (export format). Dry run by default; any error → nothing written. */
  importJson: adminProcedure
    .input(z.object({ json: z.string().min(1), dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => applySupplierImport(input.json, input.dryRun)),

  create: adminProcedure.input(fields).mutation(async ({ input }) => {
    await assertAccount(input.defaultAccount);
    return Supplier.create({
      ...input,
      ibans: clean(input.ibans, normalizeIban) ?? [],
      namePatterns: clean(input.namePatterns) ?? [],
      purposePatterns: clean(input.purposePatterns) ?? [],
      kreditorNumber: await allocateSupplierNumber(),
    });
  }),

  update: adminProcedure
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

  setArchived: adminProcedure
    .input(z.object({ id: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const supplier = await Supplier.findById(input.id);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kreditor nicht gefunden' });
      supplier.archived = input.archived;
      await supplier.save();
      return supplier;
    }),
});
