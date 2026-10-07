import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { HydratedDocument } from 'mongoose';
import { router, adminProcedure } from '../trpcInit';
import { BankTransaction, type BankTransactionDoc } from '../models/BankTransaction';
import { JournalEntry } from '../models/JournalEntry';
import { Supplier } from '../models/Supplier';
import { BookingError, bookBankTransaction, unbookBankTransaction } from '../lib/accounting/bankBooking';
import { BANK_VAT_RATES, PostingError } from '../lib/accounting/postingRules';
import { LedgerError } from '../lib/accounting/ledger';
import { suggest } from '../lib/accounting/suggest';
import { FireflyClient } from '../services/FireflyClient';
import { readFireflyEnv } from '../lib/fireflyEnv';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });
const receiptInput = z.object({ driveFileId: z.string().min(1), fileName: z.string().min(1), link: z.string().min(1) });

function yearRange(year: number) {
  return { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) };
}

/** BookingError / LedgerError / PostingError → TRPCError with a German message. */
function toTrpc(err: unknown): never {
  if (err instanceof BookingError) {
    const code = err.code === 'NOT_FOUND' || err.code === 'SUPPLIER_NOT_FOUND' ? 'NOT_FOUND'
      : err.code === 'MATCHED' || err.code === 'ALREADY_BOOKED' ? 'CONFLICT' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: err.message });
  }
  if (err instanceof LedgerError || err instanceof PostingError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  throw err;
}

/** Active coverage per fireflyJournalId: 'payment' | 'bank' (+ entry). */
async function coverageMap(refIds: string[]) {
  const entries = await JournalEntry.find({
    active: true,
    $or: [
      { 'source.kind': 'bank', 'source.refId': { $in: refIds } },
      { 'source.kind': 'payment', 'source.refId': { $in: refIds.map((r) => `bank:${r}`) } },
    ],
  });
  const entryMap = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const ref = e.source?.kind === 'payment' ? String(e.source.refId).slice('bank:'.length) : String(e.source?.refId);
    entryMap.set(ref, e);
  }
  return entryMap;
}

function row(tx: HydratedDocument<BankTransactionDoc>) {
  return {
    id: String(tx._id),
    fireflyJournalId: tx.fireflyJournalId,
    date: tx.date,
    direction: (tx.direction === 'out' ? 'out' : 'in') as 'in' | 'out',
    amountCents: tx.amountCents,
    counterpartyName: tx.counterpartyName ?? null,
    counterpartyIban: tx.counterpartyIban ?? null,
    description: tx.description,
    ignored: !!tx.ignored,
    receipt: tx.receipt ?? null,
    receiptMissingReason: tx.receiptMissingReason ?? null,
  };
}

async function loadYear(year: number) {
  const txs = await BankTransaction.find({ date: yearRange(year) }).sort({ date: 1, fireflyJournalId: 1 });
  const coverage = await coverageMap(txs.map((t) => t.fireflyJournalId));
  return { txs, coverage };
}

const bookFields = {
  account: z.string(),
  vatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)),
  mode: z.enum(['normal', 'vatOnly']),
  supplierId: z.string().optional(),
  text: z.string().max(200).optional(),
  rememberRule: z.boolean().optional(),
  receipt: receiptInput.nullable().optional(),
  receiptMissingReason: z.string().max(200).nullable().optional(),
};

export const bookingsRouter = router({
  inbox: adminProcedure.input(yearInput).query(async ({ input }) => {
    const [{ txs, coverage }, suppliers] = await Promise.all([loadYear(input.year), Supplier.find({ archived: false })]);
    return txs
      .filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId))
      .map((t) => ({ ...row(t), suggestion: suggest(t, suppliers) }));
  }),

  booked: adminProcedure.input(yearInput).query(async ({ input }) => {
    const { txs, coverage } = await loadYear(input.year);
    const supplierIds = txs.flatMap((t) => (t.supplierId ? [t.supplierId] : []));
    const names = new Map((await Supplier.find({ _id: { $in: supplierIds } }).lean() as unknown as { _id: unknown; name: string }[]).map((s) => [String(s._id), s.name]));
    return txs
      .filter((t) => coverage.get(t.fireflyJournalId)?.source?.kind === 'bank')
      .map((t) => {
        const e = coverage.get(t.fireflyJournalId)!;
        return {
          ...row(t),
          entryId: String(e._id),
          entryNumber: e.entryNumber,
          lines: e.lines.map((l) => ({ account: l.account, debitCents: l.debitCents, creditCents: l.creditCents })),
          supplierName: t.supplierId ? (names.get(String(t.supplierId)) ?? null) : null,
        };
      })
      .reverse();
  }),

  stats: adminProcedure.input(yearInput).query(async ({ input }) => {
    const { txs, coverage } = await loadYear(input.year);
    const bankBooked = txs.filter((t) => coverage.get(t.fireflyJournalId)?.source?.kind === 'bank');
    return {
      open: txs.filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId)).length,
      booked: bankBooked.length,
      missingReceipts: bankBooked.filter((t) => !t.receipt?.driveFileId && !t.receiptMissingReason).length,
    };
  }),

  book: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1), ...bookFields }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { entry } = await bookBankTransaction({ ...input, createdBy: ctx.user.sub });
        return { entryNumber: entry.entryNumber, entryId: String(entry._id) };
      } catch (err) {
        toTrpc(err);
      }
    }),

  bookBulk: adminProcedure
    .input(z.object({ bankTxIds: z.array(z.string().min(1)).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const suppliers = await Supplier.find({ archived: false });
      const results: { bankTxId: string; ok: boolean; entryNumber?: string; error?: string }[] = [];
      for (const bankTxId of input.bankTxIds) {
        const tx = await BankTransaction.findById(bankTxId);
        const s = tx ? suggest(tx, suppliers) : null;
        if (!tx || !s || (s.mode === 'normal' && !s.account) || s.vatRate === undefined) {
          results.push({ bankTxId, ok: false, error: 'Kein Vorschlag — bitte einzeln buchen' });
          continue;
        }
        try {
          const { entry } = await bookBankTransaction({
            bankTxId,
            account: s.account ?? '',
            vatRate: s.vatRate,
            mode: s.mode,
            supplierId: s.supplierId,
            createdBy: ctx.user.sub,
          });
          results.push({ bankTxId, ok: true, entryNumber: entry.entryNumber });
        } catch (err) {
          results.push({ bankTxId, ok: false, error: (err as Error).message });
        }
      }
      return results;
    }),

  unbook: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1), reason: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { reversal } = await unbookBankTransaction(input.bankTxId, input.reason, ctx.user.sub);
        return { reversalNumber: reversal.entryNumber };
      } catch (err) {
        toTrpc(err);
      }
    }),

  setReceipt: adminProcedure
    .input(
      z.object({
        bankTxId: z.string().min(1),
        receipt: receiptInput.nullable(),
        receiptMissingReason: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findById(input.bankTxId);
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Banktransaktion nicht gefunden' });
      tx.receipt = input.receipt ?? undefined;
      if (input.receiptMissingReason !== undefined) tx.receiptMissingReason = input.receiptMissingReason ?? undefined;
      await tx.save();
      return row(tx);
    }),

  balanceCheck: adminProcedure.input(yearInput).query(async ({ input }) => {
    const entries = await JournalEntry.find({ fiscalYear: input.year, 'lines.account': '1800' }).select('lines');
    const ledgerCents = entries
      .flatMap((e) => e.lines)
      .filter((l) => l.account === '1800')
      .reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    const endOfYear = new Date(input.year, 11, 31);
    const asOf = new Date() < endOfYear ? new Date() : endOfYear;
    try {
      const { baseUrl, pat, glsAccountId } = readFireflyEnv();
      const bankCents = await new FireflyClient({ baseUrl, pat, glsAccountId }).fetchBalance(asOf);
      return { asOf, ledgerCents, bankCents, diffCents: ledgerCents - bankCents };
    } catch (err) {
      return { asOf, ledgerCents, bankCents: null, diffCents: null, error: (err as Error).message };
    }
  }),
});
