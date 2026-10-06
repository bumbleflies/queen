import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { BankTransaction } from '../models/BankTransaction';
import { ReconcileRun } from '../models/ReconcileRun';
import { FireflyClient } from '../services/FireflyClient';
import { computeSyncWindow, syncBankTransactions } from '../lib/bankSync';

export interface BankListFilterInput {
  unmatchedOnly?: boolean;
  ignored?: boolean;
}

/** Pure query filter for the bank list (exported for unit tests). */
export function buildBankListFilter(input: BankListFilterInput = {}): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  if (input.unmatchedOnly) {
    filter.matchedInvoiceId = null;
    filter.ignored = { $ne: true };
    return filter;
  }
  if (input.ignored === true) filter.ignored = true;
  else if (input.ignored === false) filter.ignored = { $ne: true };
  return filter;
}

function readFireflyEnv() {
  const baseUrl = process.env.FIREFLY_URL;
  const pat = process.env.FIREFLY_PAT;
  const glsAccountId = process.env.FIREFLY_GLS_ACCOUNT_ID;
  const bankStartRaw = process.env.QUEEN_BANK_START;
  if (!baseUrl || !pat || !glsAccountId || !bankStartRaw) {
    throw new Error(
      'Firefly not configured (FIREFLY_URL, FIREFLY_PAT, FIREFLY_GLS_ACCOUNT_ID, QUEEN_BANK_START)',
    );
  }
  const bankStart = new Date(bankStartRaw);
  if (Number.isNaN(bankStart.getTime())) {
    throw new Error(`QUEEN_BANK_START is not a valid date: ${bankStartRaw}`);
  }
  return { baseUrl, pat, glsAccountId, bankStart };
}

/** Most recent run that finished without an error. */
async function findLastSuccessfulRun() {
  return ReconcileRun.findOne({
    finishedAt: { $ne: null },
    $or: [{ error: { $exists: false } }, { error: null }],
  }).sort({ finishedAt: -1 });
}

export const bankRouter = router({
  list: adminProcedure
    .input(
      z
        .object({
          unmatchedOnly: z.boolean().optional(),
          ignored: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => BankTransaction.find(buildBankListFilter(input)).sort({ date: -1 })),

  assign: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1), invoiceId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findByIdAndUpdate(
        input.bankTxId,
        { matchedInvoiceId: input.invoiceId, matchMethod: 'manual' },
        { new: true },
      );
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank transaction not found' });
      return tx;
    }),

  unassign: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findByIdAndUpdate(
        input.bankTxId,
        { $unset: { matchedInvoiceId: '', matchMethod: '' } },
        { new: true },
      );
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank transaction not found' });
      return tx;
    }),

  ignore: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findByIdAndUpdate(
        input.bankTxId,
        { ignored: true },
        { new: true },
      );
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank transaction not found' });
      return tx;
    }),

  unignore: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findByIdAndUpdate(
        input.bankTxId,
        { ignored: false },
        { new: true },
      );
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bank transaction not found' });
      return tx;
    }),

  /**
   * Fetch GLS deposits since the last successful run (or QUEEN_BANK_START) and
   * upsert them. Errors are recorded on the ReconcileRun and returned as
   * `{ ok: false }` — never thrown into the CRUD path. Matching is Task 7.
   */
  syncNow: adminProcedure.mutation(async () => {
    const run = await ReconcileRun.create({ startedAt: new Date() });
    try {
      const { baseUrl, pat, glsAccountId, bankStart } = readFireflyEnv();
      const lastRun = await findLastSuccessfulRun();
      const now = new Date();
      const { from, to } = computeSyncWindow({
        lastRunFinishedAt: lastRun?.finishedAt,
        bankStart,
        now,
      });
      const client = new FireflyClient({ baseUrl, pat, glsAccountId });
      const { fetched } = await syncBankTransactions({ client, from, to, now });
      run.fetched = fetched;
      run.finishedAt = new Date();
      await run.save();
      return { ok: true as const, fetched, from, to, run };
    } catch (err) {
      run.error = (err as Error).message;
      run.finishedAt = new Date();
      await run.save();
      return { ok: false as const, error: run.error };
    }
  }),
});
