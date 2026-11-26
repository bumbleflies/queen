import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Founder } from '../models/Founder';
import { normalizeIban } from '../lib/accounting/normalize';
import { applyFounderImport } from '../lib/expenses/founderImport';
import { Supplier } from '../models/Supplier';

const emailInput = z.string().trim().toLowerCase().email();
const ibanInput = z.string().trim().min(15).max(34).transform(normalizeIban);
/** Payout links must land on an account that can sign in to queen. */
const loginEmailInput = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .refine((e) => e.endsWith('@bumbleflies.de'), 'Die Login-Adresse muss @bumbleflies.de sein');

const DUPLICATE_EMAIL = 'E-Mail ist bereits einem Gesellschafter zugeordnet';

/**
 * Add one address to a founder's intake list. Shared with
 * `expenses.claims.assignFounder` ("diese Adresse künftig zuordnen"), so the
 * normalization lives in exactly one place.
 */
export async function addFounderEmail(founderId: string, email: string): Promise<string[]> {
  const normalized = email.trim().toLowerCase();
  if (!emailInput.safeParse(normalized).success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ungültige E-Mail-Adresse' });
  }
  const f = await Founder.findByIdAndUpdate(
    founderId,
    { $addToSet: { emails: normalized } },
    { returnDocument: 'after' },
  );
  if (!f) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
  return f.emails;
}

export const foundersRouter = router({
  list: adminProcedure.query(async () =>
    (await Founder.find().sort({ name: 1 }).lean()).map((f) => ({
      id: String(f._id),
      name: f.name,
      shortName: f.shortName,
      emails: f.emails,
      loginEmail: f.loginEmail,
      iban: f.iban,
      bic: f.bic ?? '',
      liabilityAccount: f.liabilityAccount,
      legacyCreditorNumber: f.legacyCreditorNumber ?? null,
      active: f.active,
    })),
  ),

  create: adminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(120),
        shortName: z.string().trim().min(1).max(12),
        emails: z.array(emailInput).min(1),
        loginEmail: loginEmailInput,
        iban: ibanInput,
        bic: z.string().trim().max(11).optional(),
        liabilityAccount: z.string().trim().regex(/^\d{4}$/).default('3500'),
        legacyCreditorNumber: z.number().int().min(70000).max(99999).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const emails = [...new Set(input.emails)];
      const dupe = await Founder.findOne({ emails: { $in: emails } });
      if (dupe) throw new TRPCError({ code: 'CONFLICT', message: DUPLICATE_EMAIL });
      const f = await Founder.create({ ...input, emails, createdBy: ctx.user.sub });

      // A founder IBAN must never auto-book a change-of-account rule.
      await Supplier.updateMany({ ibans: f.iban, autoBook: true }, { $set: { autoBook: false } });
      return { id: String(f._id), ...input, emails };
    }),

  update: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(1).max(120).optional(),
        shortName: z.string().trim().min(1).max(12).optional(),
        emails: z.array(emailInput).min(1).optional(),
        loginEmail: loginEmailInput.optional(),
        iban: ibanInput.optional(),
        bic: z.string().trim().max(11).optional(),
        liabilityAccount: z.string().trim().regex(/^\d{4}$/).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      if (patch.emails) {
        const emails = [...new Set(patch.emails)];
        const dupe = await Founder.findOne({ _id: { $ne: id }, emails: { $in: emails } });
        if (dupe) throw new TRPCError({ code: 'CONFLICT', message: DUPLICATE_EMAIL });
        patch.emails = emails;
      }
      const f = await Founder.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true });
      if (!f) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
      return { id: String(f._id) };
    }),

  setActive: adminProcedure
    .input(z.object({ id: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ input }) => {
      const f = await Founder.findByIdAndUpdate(input.id, { $set: { active: input.active } }, { returnDocument: 'after' });
      if (!f) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });
      return { id: String(f._id), active: f.active };
    }),

  /** "Diese Adresse künftig zuordnen" on an unknown sender. */
  addEmail: adminProcedure
    .input(z.object({ id: z.string().min(1), email: emailInput }))
    .mutation(async ({ input }) => {
      const emails = await addFounderEmail(input.id, input.email);
      return { id: input.id, emails };
    }),

  /** Upsert founders from JSON. Dry run by default; one bad row writes nothing. */
  importJson: adminProcedure
    .input(z.object({ json: z.string().min(1), dryRun: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => applyFounderImport(input.json, input.dryRun, ctx.user.sub)),
});
