import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { HydratedDocument } from 'mongoose';
import { router, authedProcedure } from '../trpcInit';
import { BankTransaction, type BankTransactionDoc } from '../models/BankTransaction';
import { JournalEntry } from '../models/JournalEntry';
import { Invoice } from '../models/Invoice';
import { Supplier } from '../models/Supplier';
import { BookingError, bookBankTransaction, unbookBankTransaction } from '../lib/accounting/bankBooking';
import { BANK_VAT_RATES, PostingError } from '../lib/accounting/postingRules';
import { LedgerError } from '../lib/accounting/ledger';
import { loadHistory } from '../lib/accounting/history';
import { cachedReading, suggestForTx, type ReceiptReading } from '../lib/accounting/receiptReading';
import type { Suggestion } from '../lib/accounting/suggest';
import { loadYear, openTransactions } from '../lib/accounting/bankCoverage';
import { AUTO_BOOK_USER } from '../lib/accounting/autoBook';
import { rankReceipts, strongReceipt, type ReceiptFile } from '../lib/accounting/receipts';
import { listReceiptFiles, type DriveFilesLike } from '../services/receiptsDrive';
import { driveForUser } from '../services/driveForUser';
import { getReceiptsFolder } from '../services/appSettings';
import { opencodeFromEnv } from '../services/OpencodeClient';
import { readTxReceipt, receiptFileFor, receiptPromptAccounts, type ReadStatus } from '../services/receiptReader';
import { FireflyClient } from '../services/FireflyClient';
import { readFireflyEnv } from '../lib/fireflyEnv';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });
const receiptInput = z.object({ driveFileId: z.string().min(1), fileName: z.string().min(1), link: z.string().min(1) });

/** BookingError / LedgerError / PostingError → TRPCError with a German message. */
function toTrpc(err: unknown): never {
  if (err instanceof BookingError) {
    const code = err.code === 'NOT_FOUND' || err.code === 'SUPPLIER_NOT_FOUND' ? 'NOT_FOUND'
      : err.code === 'MATCHED' || err.code === 'ALREADY_BOOKED' ? 'CONFLICT'
        : err.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: err.message });
  }
  if (err instanceof LedgerError || err instanceof PostingError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  throw err;
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

/**
 * The stored reading of the row's receipt (the attached one, else the Drive
 * match it was read from), so the client can explain a reading that gave no
 * suggestion (amount mismatch, failed, no text). Null when never read or read
 * for a file that is no longer attached.
 */
function readingState(tx: HydratedDocument<BankTransactionDoc>): { status: ReadStatus; reading?: ReceiptReading } | null {
  const cache = tx.receiptReading;
  const status = cache?.status;
  if (status !== 'ok' && status !== 'failed' && status !== 'noText') return null;
  if (tx.receipt?.driveFileId && cache?.driveFileId !== tx.receipt.driveFileId) return null;
  const reading = cachedReading(cache);
  return reading ? { status, reading } : { status };
}

const splitPart = z.object({
  account: z.string().min(1),
  vatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)),
  grossCents: z.number().int().positive(),
  mode: z.enum(['normal', 'reverseCharge']),
});

const bookFields = {
  account: z.string(),
  vatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)),
  mode: z.enum(['normal', 'vatOnly', 'reverseCharge']),
  split: z.array(splitPart).min(2).optional(),
  supplierId: z.string().optional(),
  text: z.string().max(200).optional(),
  rememberRule: z.boolean().optional(),
  receipt: receiptInput.nullable().optional(),
  receiptMissingReason: z.string().max(200).nullable().optional(),
};

export const bookingsRouter = router({
  /** Every bank tx of a year once, with its merged Finance view state. */
  stream: authedProcedure.input(yearInput).query(async ({ input }) => {
    const [{ txs, coverage }, suppliers, history] = await Promise.all([loadYear(input.year), Supplier.find({ archived: false }), loadHistory()]);
    const matchedIds = txs.flatMap((t) => (t.matchedInvoiceId ? [t.matchedInvoiceId] : []));
    const invoiceMap = new Map(
      (await Invoice.find({ _id: { $in: matchedIds } }).select('invoiceNumber status').lean() as unknown as { _id: unknown; invoiceNumber: string; status: string }[]).map(
        (i) => [String(i._id), { invoiceNumber: i.invoiceNumber, status: i.status }],
      ),
    );
    const supplierIds = txs.flatMap((t) => (t.supplierId ? [t.supplierId] : []));
    const names = new Map((await Supplier.find({ _id: { $in: supplierIds } }).lean() as unknown as { _id: unknown; name: string }[]).map((s) => [String(s._id), s.name]));

    return txs
      .map((t) => {
        const covered = coverage.get(t.fireflyJournalId);
        if (t.matchedInvoiceId) {
          return {
            ...row(t),
            state: 'invoice' as const,
            invoice: t.matchedInvoiceId ? invoiceMap.get(String(t.matchedInvoiceId)) ?? null : null,
          };
        }
        if (covered?.source?.kind === 'bank') {
          return {
            ...row(t),
            state: 'booked' as const,
            entry: {
              entryId: String(covered._id),
              entryNumber: covered.entryNumber,
              auto: covered.createdBy === AUTO_BOOK_USER,
              lines: covered.lines.map((l) => ({ account: l.account, debitCents: l.debitCents, creditCents: l.creditCents })),
            },
            supplierName: t.supplierId ? (names.get(String(t.supplierId)) ?? null) : null,
          };
        }
        return { ...row(t), state: 'open' as const, suggestion: suggestForTx(t, suppliers, history), receiptReading: readingState(t) };
      })
      .reverse();
  }),

  inbox: authedProcedure.input(yearInput).query(async ({ input }) => {
    const [{ txs, coverage }, suppliers, history] = await Promise.all([loadYear(input.year), Supplier.find({ archived: false }), loadHistory()]);
    return txs
      .filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId))
      .map((t) => ({ ...row(t), suggestion: suggestForTx(t, suppliers, history), receiptReading: readingState(t) }));
  }),

  /** Clear receipt match per open row (inbox hint). Drive trouble → `available: false`, never an error. */
  receiptMatches: authedProcedure.input(yearInput).query(async ({ input, ctx }) => {
    const readingAvailable = opencodeFromEnv() !== null;
    const none = { available: false, readingAvailable, matches: {} as Record<string, ReceiptFile> };
    const folder = await getReceiptsFolder();
    if (!folder) return none;
    let files: ReceiptFile[];
    try {
      files = await listReceiptFiles(await driveForUser(ctx.user.sub), folder.id, input.year);
    } catch {
      return none;
    }
    const [open, suppliers, history] = await Promise.all([openTransactions(input.year), Supplier.find({ archived: false }), loadHistory()]);
    const matches: Record<string, ReceiptFile> = {};
    for (const tx of open) {
      const best = strongReceipt(rankReceipts(files, tx, suggestForTx(tx, suppliers, history)?.supplierName));
      if (best) matches[String(tx._id)] = { id: best.id, name: best.name, link: best.link };
    }
    return { available: true, readingAvailable, matches };
  }),

  /**
   * Reads the row's receipt (attached, else the clearly matching Drive file)
   * with opencode and stores the result; `force` re-reads, 'failed' is always
   * re-read. Never books. Returns the row's effective suggestion (rule →
   * history → reading) and the reading itself.
   * Without OPENCODE_API_KEY or Drive: 'unavailable'; no receipt: 'noReceipt'.
   */
  readReceipt: authedProcedure
    .input(z.object({ bankTxId: z.string().min(1), force: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      const result = (
        status: ReadStatus | 'unavailable' | 'noReceipt',
        suggestion: Suggestion | null = null,
        reading: ReceiptReading | null = null,
      ) => ({ status, suggestion, reading });
      const client = opencodeFromEnv();
      if (!client) return result('unavailable');
      const tx = await BankTransaction.findById(input.bankTxId);
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Banktransaktion nicht gefunden' });
      const [suppliers, history] = await Promise.all([Supplier.find({ archived: false }), loadHistory()]);
      let drive: DriveFilesLike;
      let files: ReceiptFile[] = [];
      try {
        drive = await driveForUser(ctx.user.sub);
        const folder = tx.receipt?.driveFileId ? null : await getReceiptsFolder();
        if (folder) files = await listReceiptFiles(drive, folder.id, new Date(tx.date).getFullYear());
      } catch {
        return result('unavailable', suggestForTx(tx, suppliers, history));
      }
      const file = receiptFileFor(tx, files, suggestForTx(tx, suppliers, history)?.supplierName);
      if (!file) return result('noReceipt', suggestForTx(tx, suppliers, history));
      const { status, reading } = await readTxReceipt(tx, file, { drive, client, accounts: await receiptPromptAccounts() }, input.force);
      // readTxReceipt updated tx.receiptReading, so this is rule → history → the new reading
      return result(status, suggestForTx(tx, suppliers, history), reading);
    }),

  booked: authedProcedure.input(yearInput).query(async ({ input }) => {
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

  stats: authedProcedure.input(yearInput).query(async ({ input }) => {
    const { txs, coverage } = await loadYear(input.year);
    const bankBooked = txs.filter((t) => coverage.get(t.fireflyJournalId)?.source?.kind === 'bank');
    return {
      open: txs.filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId)).length,
      booked: bankBooked.length,
      missingReceipts: bankBooked.filter((t) => !t.receipt?.driveFileId && !t.receiptMissingReason).length,
    };
  }),

  book: authedProcedure
    .input(z.object({ bankTxId: z.string().min(1), ...bookFields }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { entry } = await bookBankTransaction({ ...input, createdBy: ctx.user.sub, role: ctx.user.role });
        return { entryNumber: entry.entryNumber, entryId: String(entry._id) };
      } catch (err) {
        toTrpc(err);
      }
    }),

  bookBulk: authedProcedure
    .input(z.object({ bankTxIds: z.array(z.string().min(1)).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const [suppliers, history] = await Promise.all([Supplier.find({ archived: false }), loadHistory()]);
      const folder = await getReceiptsFolder();
      // Receipt files per year; Drive trouble only means no automatic receipt.
      const filesByYear = new Map<number, Promise<ReceiptFile[]>>();
      const receiptsFor = (year: number) => {
        if (!folder) return Promise.resolve([]);
        if (!filesByYear.has(year)) {
          filesByYear.set(year, driveForUser(ctx.user.sub).then((d) => listReceiptFiles(d, folder.id, year)).catch(() => []));
        }
        return filesByYear.get(year)!;
      };
      const results: { bankTxId: string; ok: boolean; entryNumber?: string; receipt?: boolean; error?: string }[] = [];
      for (const bankTxId of input.bankTxIds) {
        const tx = await BankTransaction.findById(bankTxId);
        const s = tx ? suggestForTx(tx, suppliers, history) : null;
        if (!tx || !s || (!s.split && ((s.mode === 'normal' && !s.account) || s.vatRate === undefined))) {
          results.push({ bankTxId, ok: false, error: 'Kein Vorschlag — bitte einzeln buchen' });
          continue;
        }
        const file = tx.receipt?.driveFileId
          ? null
          : strongReceipt(rankReceipts(await receiptsFor(new Date(tx.date).getFullYear()), tx, s.supplierName));
        try {
          const { entry } = await bookBankTransaction({
            bankTxId,
            account: s.account ?? '',
            vatRate: s.vatRate ?? 0,
            mode: s.mode,
            split: s.split,
            supplierId: s.supplierId,
            receipt: file ? { driveFileId: file.id, fileName: file.name, link: file.link } : undefined,
            createdBy: ctx.user.sub,
          });
          results.push({ bankTxId, ok: true, entryNumber: entry.entryNumber, receipt: !!tx.receipt?.driveFileId || !!file });
        } catch (err) {
          results.push({ bankTxId, ok: false, error: (err as Error).message });
        }
      }
      return results;
    }),

  unbook: authedProcedure
    .input(z.object({ bankTxId: z.string().min(1), reason: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { reversal } = await unbookBankTransaction(input.bankTxId, input.reason, ctx.user.sub);
        return { reversalNumber: reversal.entryNumber };
      } catch (err) {
        toTrpc(err);
      }
    }),

  setReceipt: authedProcedure
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

  balanceCheck: authedProcedure.input(yearInput).query(async ({ input }) => {
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
