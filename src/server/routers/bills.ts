import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import { Bill } from '../models/Bill';
import { BankTransaction } from '../models/BankTransaction';
import { yearRange } from '../lib/accounting/bankCoverage';
import { bestTransactionForBill } from '../lib/bills/matchBill';
import { billLikeOf, txLikeOf } from '../services/billMatch';
import { describeIntakeError, resolveBillIntakeDeps, runBillIntake } from '../jobs/billIntake';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });

/** Messages per click; the nightly job reads more. Keeps the button responsive. */
const INTAKE_NOW_MAX_MESSAGES = 10;

export const billsRouter = router({
  /**
   * Bills received by e-mail in a year, each with the payment it belongs to.
   * The match is a suggestion from amount + IBAN + invoice number in the
   * Verwendungszweck — it never books anything.
   */
  list: authedProcedure.input(yearInput).query(async ({ input }) => {
    const [bills, txs] = await Promise.all([
      Bill.find({ receivedAt: yearRange(input.year) }).sort({ receivedAt: -1 }).lean(),
      BankTransaction.find({ direction: 'out', date: yearRange(input.year) }).sort({ date: 1 }).lean(),
    ]);
    const txLikes = txs.map((t) => ({ id: String(t._id), ...txLikeOf(t) }));
    return bills.map((bill) => {
      const paid = bestTransactionForBill(billLikeOf(bill), txLikes);
      return {
        id: String(bill._id),
        receivedAt: bill.receivedAt,
        from: bill.from ?? '',
        subject: bill.subject ?? '',
        fileName: bill.fileName,
        driveFileId: bill.driveFileId,
        driveLink: bill.driveLink ?? '',
        status: bill.status,
        ignored: !!bill.ignored,
        error: bill.error ?? null,
        parse: bill.parse ?? null,
        transaction: paid
          ? {
              id: paid.id,
              date: paid.date,
              amountCents: paid.amountCents,
              counterpartyName: paid.counterpartyName ?? null,
              description: paid.description ?? '',
            }
          : null,
      };
    });
  }),

  /**
   * Read the mailbox now (admin). Same job as the nightly run, capped so the
   * click returns quickly.
   *
   * Expected failures are returned, not thrown: Traefik in front of this app
   * replaces any 5xx body with its HTML error page, so a thrown BAD_GATEWAY
   * reaches the browser as `Unexpected token '<'` with no usable reason.
   */
  intakeNow: adminProcedure.mutation(async () => {
    try {
      const deps = await resolveBillIntakeDeps();
      return { ok: true as const, ...(await runBillIntake({ ...deps, maxMessages: INTAKE_NOW_MAX_MESSAGES })) };
    } catch (err) {
      return { ok: false as const, error: describeIntakeError(err) };
    }
  }),

  /** Hide a bill from the list. Bills are never deleted: the mail is the audit trail. */
  setIgnored: adminProcedure
    .input(z.object({ id: z.string().min(1), ignored: z.boolean() }))
    .mutation(async ({ input }) => {
      const updated = await Bill.findByIdAndUpdate(input.id, { ignored: input.ignored }, { returnDocument: 'after' });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });
      return { id: String(updated._id), ignored: !!updated.ignored };
    }),
});
