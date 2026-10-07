import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Account } from '../models/Account';
import { FiscalYear } from '../models/FiscalYear';
import { JournalEntry } from '../models/JournalEntry';
import { LedgerError, post, reverse } from '../lib/accounting/ledger';
import { accountLedger, trialBalance } from '../lib/accounting/balances';

const REVERSIBLE_KINDS = new Set(['manual', 'opening']);

const lineInput = z.object({
  account: z.string().regex(/^\d{4,5}$/),
  debitCents: z.number().int().min(0),
  creditCents: z.number().int().min(0),
});

/** LedgerError → TRPCError so the UI gets a readable message and status. */
async function mapLedgerErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LedgerError) {
      const code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' =
        err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code === 'DUPLICATE' ? 'CONFLICT' : 'BAD_REQUEST';
      throw new TRPCError({ code, message: err.message });
    }
    throw err;
  }
}

const yearInput = z.number().int().min(2000).max(2100);

export const ledgerRouter = router({
  fiscalYears: adminProcedure.query(async () => FiscalYear.find({}).sort({ year: -1 })),

  list: adminProcedure
    .input(z.object({ year: yearInput, account: z.string().optional() }))
    .query(async ({ input }) =>
      JournalEntry.find({
        fiscalYear: input.year,
        ...(input.account ? { 'lines.account': input.account } : {}),
      }).sort({ entryNumber: 1 }),
    ),

  get: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const entry = await JournalEntry.findById(input.id);
    if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
    return entry;
  }),

  trialBalance: adminProcedure.input(z.object({ year: yearInput })).query(async ({ input }) => {
    const [entries, accounts] = await Promise.all([
      JournalEntry.find({ fiscalYear: input.year }).select('lines'),
      Account.find({}).select('number name'),
    ]);
    const names = new Map(accounts.map((a) => [a.number, a.name]));
    const tb = trialBalance(entries);
    return { ...tb, rows: tb.rows.map((r) => ({ ...r, name: names.get(r.account) ?? '' })) };
  }),

  accountLedger: adminProcedure
    .input(z.object({ year: yearInput, account: z.string().min(1) }))
    .query(async ({ input }) => {
      const entries = await JournalEntry.find({
        fiscalYear: input.year,
        'lines.account': input.account,
      });
      return accountLedger(input.account, entries);
    }),

  postManual: adminProcedure
    .input(
      z.object({
        kind: z.enum(['manual', 'opening']),
        date: z.coerce.date(),
        text: z.string().min(1),
        lines: z.array(lineInput).min(2),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      mapLedgerErrors(() => {
        const year = input.date.getFullYear();
        const opening = input.kind === 'opening';
        return post({
          date: opening ? new Date(year, 0, 1) : input.date,
          text: input.text,
          lines: input.lines,
          source: opening ? { kind: 'opening', refId: `opening:${year}` } : { kind: 'manual' },
          createdBy: ctx.user.sub,
        });
      }),
    ),

  reverse: adminProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const entry = await JournalEntry.findById(input.id);
      if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
      if (!REVERSIBLE_KINDS.has(entry.source?.kind ?? '')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Automatic entries are corrected at their source (Storno, Zahlung lösen)',
        });
      }
      return mapLedgerErrors(() =>
        reverse(input.id, { reason: input.reason, createdBy: ctx.user.sub }),
      );
    }),
});
