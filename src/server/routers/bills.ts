import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, authedProcedure, adminProcedure } from '../trpcInit';
import { Bill } from '../models/Bill';
import { BankTransaction } from '../models/BankTransaction';
import { yearRange } from '../lib/accounting/bankCoverage';
import { parseBillText } from '../lib/bills/parseBill';
import { createGmailClient, displayNameFromHeader, fetchPdfAttachments } from '../services/GmailService';
import { extractPdfText } from '../services/receiptText';
import { googleAccessForCron } from '../services/driveForUser';
import { billFieldsOf } from '../services/billMatch';
import { describeIntakeError, resolveBillIntakeDeps, rematchBills, runBillIntake } from '../jobs/billIntake';
import { withRateLimitRetry } from '../lib/gmailRateLimit';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });

/** Euro amount in cents; null clears a field the read got wrong. */
const centsInput = z.number().int().safe().nullable();
const textInput = z.string().trim().max(200);

/** Everything an admin may correct on a bill; omitted = leave the read's value. */
const billCorrectionInput = z.object({
  vendorName: textInput.optional(),
  invoiceNumber: textInput.max(60).optional(),
  grossCents: centsInput.optional(),
  netCents: centsInput.optional(),
  vatCents: centsInput.optional(),
  /** 0.19 / 0.07 / 0, like the read stores it. */
  vatRate: z.number().min(0).max(1).nullable().optional(),
  iban: textInput.max(34).optional(),
  dueDate: z.coerce.date().nullable().optional(),
  reverseCharge: z.boolean().optional(),
});

/** Messages per click; the nightly job reads more. Keeps the button responsive. */
const INTAKE_NOW_MAX_MESSAGES = 10;

export const billsRouter = router({
  /**
   * Bills received by e-mail in a year, each with the payment it belongs to.
   * The link is stored on the Bill document (set by intake + rematch) — it
   * never books anything.
   *
   * `parse` is what the bill says today: an admin's correction where there is
   * one, else the PDF read. `corrected` only marks that someone fixed it.
   */
  list: authedProcedure.input(yearInput).query(async ({ input }) => {
    const [bills, txs] = await Promise.all([
      Bill.find({ receivedAt: yearRange(input.year) }).sort({ receivedAt: -1 }).lean(),
      BankTransaction.find({ direction: 'out', date: yearRange(input.year) }).sort({ date: 1 }).lean(),
    ]);
    const txById = new Map(txs.map((t) => [String(t._id), t]));
    return bills.map((bill) => {
      const tx = bill.transactionId ? txById.get(String(bill.transactionId)) : undefined;
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
        parse: billFieldsOf(bill),
        corrected: bill.corrected
          ? { at: bill.corrected.correctedAt ?? null, by: bill.corrected.correctedBy ?? '' }
          : null,
        matchMethod: bill.matchMethod ?? null,
        amountMismatch: bill.amountMismatch ?? null,
        transaction: tx
          ? {
              id: String(tx._id),
              date: tx.date,
              amountCents: tx.amountCents,
              counterpartyName: tx.counterpartyName ?? null,
              description: tx.description ?? '',
            }
          : null,
      };
    });
  }),

  /**
   * Re-link every bill in the year to its settling bank transaction.
   * Two grades: exact amount, or IBAN + invoice number in purpose. Manual
   * links are never overwritten. When a link is found and the transaction has
   * no receipt yet, the bill's filed PDF is attached as the receipt.
   */
  rematch: adminProcedure.input(yearInput).mutation(async ({ input }) => {
    return rematchBills({ year: input.year });
  }),

  /**
   * Read the mailbox now (admin). The same job as the hourly run — including
   * one confirmation reply per mail that produced a bill, in that mail's thread
   * — capped so the click returns quickly.
   *
   * Expected failures are returned, not thrown: Traefik in front of this app
   * replaces any 5xx body with its HTML error page, so a thrown BAD_GATEWAY
   * reaches the browser as `Unexpected token '<'` with no usable reason.
   */
  intakeNow: adminProcedure.mutation(async () => {
    try {
      const deps = await resolveBillIntakeDeps();
      // A short Gmail 429 can clear itself within seconds. Retries are safe:
      // intake is idempotent per (message, attachment) and content hash, and a
      // second pass sends no reply for mail whose bills were already recorded.
      // The hourly cron deliberately does NOT retry — its next run is the retry.
      const result = await withRateLimitRetry(() =>
        runBillIntake({ ...deps, maxMessages: INTAKE_NOW_MAX_MESSAGES }),
      );
      return { ok: true as const, ...result };
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

  /**
   * Correct a wrong read by hand (admin). The PDF's own values stay in `parse`;
   * the correction lives beside them and wins (`billFieldsOf`), so a later
   * `reread` repairs the read without discarding the human's numbers. Never
   * books anything — the payment still has to be booked in the inbox.
   */
  correct: adminProcedure
    .input(billCorrectionInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...changes } = input;
      const bill = await Bill.findById(id);
      if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });

      const before = billFieldsOf(bill);
      bill.set('corrected', {
        ...before,
        ...changes,
        correctedAt: new Date(),
        correctedBy: ctx.user.sub,
      });
      await bill.save();
      return { id: String(bill._id), parse: billFieldsOf(bill) };
    }),

  /** Re-read a bill's PDF attachment from Gmail and re-parse it.
   * Repairs bills whose first read failed or parsed wrong (for example the
   * mail's sender instead of the letterhead as vendor). Never books anything;
   * use bills.rematch afterwards to (re-)link to a bank transaction.
   */
  reread: adminProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const bill = await Bill.findById(input.id);
      if (!bill) throw new TRPCError({ code: 'NOT_FOUND', message: 'Beleg nicht gefunden' });

      const access = await googleAccessForCron();
      if (!access) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Kein Google-Zugang hinterlegt — bitte in den Einstellungen neu verbinden',
        });
      }

      const gmail = createGmailClient(access.refreshToken, access.accessToken);
      const msg = (await gmail.users.messages.get({ userId: 'me', id: bill.messageId, format: 'full' })).data;
      const attachments = await fetchPdfAttachments(gmail, bill.messageId, msg.payload);
      const attachment = attachments[0];
      if (!attachment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Kein PDF-Anhang mehr im Postfach' });
      }

      let text = '';
      let parseError = '';
      try {
        text = await extractPdfText(attachment.buffer);
      } catch (err) {
        parseError = err instanceof Error ? err.message : String(err);
      }

      let parsed = null;
      let status: 'parsed' | 'noText' | 'failed' = 'noText';
      if (text.trim().length >= 20) {
        parsed = parseBillText(text, { fromName: displayNameFromHeader(bill.from) });
        status = 'parsed';
      } else if (parseError) {
        status = 'failed';
      }

      const set: Record<string, unknown> = { status };
      const unset: Record<string, unknown> = {};
      if (parsed) {
        set.parse = parsed;
        unset.error = 1;
      } else {
        set.error = parseError || 'Kein lesbarer Text im PDF';
      }
      const update: Record<string, unknown> = { $set: set };
      if (Object.keys(unset).length > 0) update.$unset = unset;

      await Bill.findByIdAndUpdate(bill._id, update);
      return { id: String(bill._id), status, parsed: !!parsed, error: parseError ?? null };
    }),
});
