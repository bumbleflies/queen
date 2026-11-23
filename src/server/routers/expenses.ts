import { createHash, randomUUID } from 'crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import { ExpenseClaim } from '../models/ExpenseClaim';
import { Founder } from '../models/Founder';
import { Account } from '../models/Account';
import { FiscalYear } from '../models/FiscalYear';
import { claimFieldsOf, isConfidentClaim, periodOf } from '../lib/expenses/claimFields';
import { bookExpenseClaim, ClaimError, rebookExpenseClaim } from '../lib/accounting/claimBooking';
import { LedgerError } from '../lib/accounting/ledger';
import { PostingError } from '../lib/accounting/postingRules';
import { addressFromHeader } from '../services/GmailService';
import { getExpenseAutoBookLimitCents } from '../services/appSettings';
import { describeIntakeError } from '../jobs/billIntake';
import { resolveExpenseIntakeDeps, runExpenseIntake } from '../jobs/expenseIntake';
import { addFounderEmail } from './founders';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });

/** Euro amount in cents; null clears a field the read got wrong. */
const centsInput = z.number().int().safe().nullable();
const textInput = z.string().trim().max(200);

/** Everything an admin may correct on a claim; omitted = leave the current value. */
const claimCorrectionInput = z.object({
  date: z.coerce.date().nullable().optional(),
  vendorName: textInput.optional(),
  invoiceNumber: textInput.max(60).optional(),
  grossCents: centsInput.optional(),
  netCents: centsInput.optional(),
  vatCents: centsInput.optional(),
  /** 0.19 / 0.07 / 0, like the read stores it. */
  vatRate: z.number().min(0).max(1).nullable().optional(),
  account: z.string().trim().regex(/^\d{4,5}$/).nullable().optional(),
  reverseCharge: z.boolean().optional(),
  addressedToCompany: z.boolean().optional(),
  currency: z.enum(['EUR', 'other']).optional(),
});

/** Messages per click; the hourly job reads more. Keeps the button responsive. */
const INTAKE_NOW_MAX_MESSAGES = 10;

/**
 * Domain errors become sentences, not 5xx: Traefik in front of the app replaces
 * a 5xx body with its own HTML page, which reaches the browser as
 * `Unexpected token '<'`.
 */
function claimErrorToTRPC(err: unknown): TRPCError {
  if (err instanceof ClaimError) {
    return new TRPCError({
      code: err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'PRECONDITION_FAILED',
      message: err.message,
    });
  }
  if (err instanceof LedgerError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: err.message });
  }
  if (err instanceof PostingError) {
    return new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  return err instanceof TRPCError
    ? err
    : new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: (err as Error).message });
}

const claimsRouter = router({
  /**
   * Claims of a year, with the founder and the fields an admin corrected.
   * `parse` is what the claim says today (`claimFieldsOf`: correction wins over
   * the read) and `autoBookable` says whether the confidence rules would let it
   * book itself — a hint for the review, never a booking.
   *
   * Admins see every claim; a founder sees their own (by `loginEmail`).
   */
  list: authedProcedure.input(yearInput).query(async ({ ctx, input }) => {
    const [allClaims, founders, accounts, closedYears, limitCents] = await Promise.all([
      ExpenseClaim.find({ period: { $regex: `^${input.year}-` } }).sort({ receivedAt: -1 }).lean(),
      Founder.find().lean(),
      Account.find({ archived: { $ne: true } }, { number: 1 }).lean(),
      FiscalYear.find({ status: 'closed' }, { year: 1 }).lean(),
      getExpenseAutoBookLimitCents(),
    ]);

    const founderById = new Map(founders.map((f) => [String(f._id), f]));
    const accountNumbers = new Set(accounts.map((a) => a.number));
    const closed = new Set(closedYears.map((y) => y.year));

    const ownFounderIds =
      ctx.user.role === 'admin'
        ? null
        : new Set(
            founders
              .filter((f) => f.loginEmail.toLowerCase() === ctx.user.email.toLowerCase())
              .map((f) => String(f._id)),
          );
    const claims = ownFounderIds
      ? allClaims.filter((c) => c.founderId && ownFounderIds.has(String(c.founderId)))
      : allClaims;

    // A second claim with the same PDF is a duplicate, not a second expense.
    const shaCounts = new Map<string, number>();
    for (const claim of claims) shaCounts.set(claim.sha256, (shaCounts.get(claim.sha256) ?? 0) + 1);

    return claims.map((claim) => {
      const merged = claimFieldsOf(claim);
      const founder = claim.founderId ? founderById.get(String(claim.founderId)) ?? null : null;
      const autoBookable = merged
        ? isConfidentClaim({
            parse: merged,
            founderActive: !!founder?.active,
            account: merged.account ?? null,
            accountExists: !!merged.account && accountNumbers.has(merged.account),
            limitCents,
            yearClosed: closed.has(Number(claim.period.slice(0, 4))),
            duplicate: (shaCounts.get(claim.sha256) ?? 0) > 1,
            reverseChargeNeedsCompany: merged.reverseCharge,
          })
        : { ok: false, reasons: ['Beleg nicht gelesen'], vatDeductible: false, grossOnly: true };

      return {
        id: String(claim._id),
        receivedAt: claim.receivedAt,
        period: claim.period,
        from: claim.from ?? '',
        subject: claim.subject ?? '',
        fileName: claim.fileName,
        driveFileId: claim.driveFileId ?? '',
        driveLink: claim.driveLink ?? '',
        status: claim.status,
        error: claim.error ?? null,
        founder: founder
          ? { id: String(founder._id), name: founder.name, shortName: founder.shortName, active: founder.active }
          : null,
        parse: merged,
        corrected: claim.corrected
          ? { at: claim.corrected.correctedAt ?? null, by: claim.corrected.correctedBy ?? '' }
          : null,
        payoutId: claim.payoutId ? String(claim.payoutId) : null,
        autoBookable,
      };
    });
  }),

  /**
   * Read the expenses mailbox now (admin). The same job as the hourly run,
   * including one confirmation reply per mail that produced a claim, capped so
   * the click returns quickly. Expected failures are returned, not thrown:
   * Traefik in front of this app replaces 5xx bodies with its HTML error page.
   */
  intakeNow: adminProcedure.mutation(async () => {
    try {
      const deps = await resolveExpenseIntakeDeps();
      return { ok: true as const, ...(await runExpenseIntake({ ...deps, maxMessages: INTAKE_NOW_MAX_MESSAGES })) };
    } catch (err) {
      return { ok: false as const, error: describeIntakeError(err) };
    }
  }),

  /**
   * A receipt the founder cannot forward (a paper receipt): the values are
   * entered by hand, optionally with a Drive link. It books nothing.
   */
  createManual: adminProcedure
    .input(
      z.object({
        founderId: z.string().min(1),
        date: z.coerce.date(),
        vendorName: z.string().trim().min(1).max(200),
        invoiceNumber: z.string().trim().max(60).optional(),
        grossCents: z.number().int().safe().positive(),
        netCents: z.number().int().safe().nonnegative().optional(),
        vatCents: z.number().int().safe().nonnegative().optional(),
        vatRate: z.number().min(0).max(1).optional(),
        account: z.string().trim().regex(/^\d{4,5}$/).optional(),
        driveLink: z.string().trim().max(500).optional(),
        period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const founder = await Founder.findById(input.founderId);
      if (!founder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });

      const parse = {
        date: input.date,
        vendorName: input.vendorName,
        invoiceNumber: input.invoiceNumber ?? '',
        grossCents: input.grossCents,
        netCents: input.netCents ?? null,
        vatCents: input.vatCents ?? null,
        vatRate: input.vatRate ?? null,
        account: input.account ?? null,
        reverseCharge: false,
        // A hand-entered claim does not prove the document names bumbleflies;
        // without that, Vorsteuer is not claimed (gross only).
        addressedToCompany: false,
        currency: 'EUR' as const,
      };
      const sha256 = createHash('sha256')
        .update(JSON.stringify({ founderId: input.founderId, date: input.date.toISOString(), vendorName: input.vendorName, grossCents: input.grossCents }))
        .digest('hex');

      const claim = await ExpenseClaim.create({
        messageId: `manual:${randomUUID()}`,
        attachmentId: 'manual',
        sha256,
        mailbox: 'manual',
        from: ctx.user.email,
        subject: 'Manuell erfasst',
        receivedAt: new Date(),
        fileName: `Spesen-${founder.shortName}-${(input.period ?? periodOf(input.date)).replace('-', '')}-${input.vendorName.replace(/[^\w]+/g, '-')}.pdf`,
        driveFileId: '',
        driveLink: input.driveLink ?? '',
        founderId: founder._id,
        status: 'received',
        period: input.period ?? periodOf(input.date),
        parse,
        createdBy: ctx.user.sub,
      });
      return { id: String(claim._id) };
    }),

  /**
   * Correct a wrong read by hand (admin). The read stays on the document; the
   * correction lives beside it and wins (`claimFieldsOf`). A booked claim is not
   * rebooked here: the caller gets `needsRebook` and `confirm` does it later.
   */
  correct: adminProcedure
    .input(claimCorrectionInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const claim = await ExpenseClaim.findById(id);
      if (!claim) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });

      // Only the changed fields are stored. Copying the whole read here would
      // freeze a wrong value in place when the PDF is re-read later.
      claim.set('corrected', { ...changes, correctedAt: new Date(), correctedBy: ctx.user.sub });
      await claim.save();
      return {
        id: String(claim._id),
        parse: claimFieldsOf(claim),
        needsRebook: claim.status === 'booked',
      };
    }),

  /**
   * Book the claim, or rebook it after a correction (admin). Booking is
   * idempotent, so a double click returns the same entry; a correction is
   * applied by reversing the live entry and posting the claim again.
   */
  confirm: adminProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    const claim = await ExpenseClaim.findById(input.id);
    if (!claim) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });

    try {
      if (claim.status === 'booked') {
        // Nothing changed since the booking: no reversal churn.
        if (!claim.corrected) {
          return {
            id: String(claim._id),
            status: 'booked' as const,
            entryId: claim.journalEntryId ? String(claim.journalEntryId) : null,
            rebooked: false,
          };
        }
        const entry = await rebookExpenseClaim({ claimId: input.id, actor: ctx.user.sub });
        return {
          id: String(claim._id),
          status: 'booked' as const,
          entryId: String(entry._id),
          rebooked: true,
        };
      }

      const entry = await bookExpenseClaim({ claimId: input.id, actor: ctx.user.sub });
      return {
        id: String(claim._id),
        status: 'booked' as const,
        entryId: String(entry._id),
        rebooked: false,
      };
    } catch (err) {
      throw claimErrorToTRPC(err);
    }
  }),

  /** Hide a claim from the list. Claims are never deleted: the mail is the audit trail. */
  setIgnored: adminProcedure
    .input(z.object({ id: z.string().min(1), ignored: z.boolean() }))
    .mutation(async ({ input }) => {
      const claim = await ExpenseClaim.findById(input.id);
      if (!claim) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });
      if (claim.status === 'payoutPending' || claim.status === 'settled') {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Beleg ist bereits zur Auszahlung freigegeben' });
      }
      claim.set({ status: input.ignored ? 'ignored' : claim.journalEntryId ? 'booked' : 'received' });
      await claim.save();
      return { id: String(claim._id), status: claim.status };
    }),

  /**
   * Map a claim to its founder. `rememberEmail` also adds the sender address to
   * that founder, so the next mail from it is assigned automatically.
   */
  assignFounder: adminProcedure
    .input(
      z.object({
        id: z.string().min(1),
        founderId: z.string().min(1),
        rememberEmail: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const claim = await ExpenseClaim.findById(input.id);
      if (!claim) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });
      const founder = await Founder.findById(input.founderId);
      if (!founder) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gesellschafter nicht gefunden' });

      claim.set({ founderId: founder._id });
      await claim.save();
      if (input.rememberEmail) {
        const address = addressFromHeader(claim.from ?? '');
        if (address) await addFounderEmail(String(founder._id), address);
      }
      return { id: String(claim._id), founderId: String(founder._id) };
    }),
});

export const expensesRouter = router({ claims: claimsRouter });
