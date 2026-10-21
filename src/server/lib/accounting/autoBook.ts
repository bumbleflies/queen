import { Supplier } from '../../models/Supplier';
import { JournalEntry } from '../../models/JournalEntry';
import { FiscalYear } from '../../models/FiscalYear';
import { listReceiptFiles } from '../../services/receiptsDrive';
import { driveForCron } from '../../services/driveForUser';
import { getReceiptsFolder } from '../../services/appSettings';
import { BookingError, bookBankTransaction } from './bankBooking';
import { openTransactions } from './bankCoverage';
import { LedgerError } from './ledger';
import { loadHistory, suggestWithHistory } from './history';
import { rankReceipts, strongReceipt, type ReceiptFile } from './receipts';
import type { Suggestion } from './suggest';

/** `createdBy` of entries the daily reconcile posted without confirmation. */
export const AUTO_BOOK_USER = 'auto:reconcile';

/**
 * Only rules an admin flagged `autoBook`, matched by IBAN or Verwendungszweck,
 * with a complete booking (VAT rate, and an account unless the mode is vatOnly).
 * Name matches and history suggestions never qualify.
 */
export function isAutoBookable(
  suggestion: Suggestion | null,
  supplier: { autoBook?: boolean | null } | null,
): boolean {
  if (!suggestion || !supplier?.autoBook) return false;
  if (suggestion.matchedBy !== 'iban' && suggestion.matchedBy !== 'purpose') return false;
  if (suggestion.vatRate === undefined || suggestion.vatRate === null) return false;
  return suggestion.mode === 'vatOnly' || !!suggestion.account;
}

/**
 * Errors that mean "someone else got there first" (booked, matched to an
 * invoice, or a concurrent run posted the same source): skipped, not a failure.
 */
export function isConcurrentBookingError(err: unknown): boolean {
  if (err instanceof BookingError) return err.code === 'ALREADY_BOOKED' || err.code === 'MATCHED';
  return err instanceof LedgerError && err.code === 'DUPLICATE';
}

/** Bank refs that already have a reversed (inactive) booking: a person undid it, so never re-book automatically. */
async function reversedRefs(refIds: string[]): Promise<Set<string>> {
  if (refIds.length === 0) return new Set();
  const entries = await JournalEntry.find({ 'source.kind': 'bank', 'source.refId': { $in: refIds }, active: false })
    .select('source.refId')
    .lean();
  return new Set(entries.flatMap((e) => (e.source?.refId ? [e.source.refId] : [])));
}

/** The current calendar year plus every fiscal year that isn't closed. */
async function bookableYears(now: Date): Promise<number[]> {
  const years = await FiscalYear.find({}).select('year status').lean();
  const closed = new Set(years.filter((y) => y.status === 'closed').map((y) => y.year));
  const all = new Set([now.getFullYear(), ...years.map((y) => y.year)]);
  return [...all].filter((y) => !closed.has(y)).sort((a, b) => a - b);
}

export interface AutoBookResult {
  booked: number;
  failed: number;
  warning?: string;
}

/**
 * Books every open outgoing bank transaction of the non-closed fiscal years
 * whose suggestion is auto-bookable (never one whose earlier booking was reversed), attaching a clearly matching receipt from Drive.
 * Drive trouble books without a receipt and sets `warning`; a failing row is
 * counted, never thrown.
 */
export async function autoBookOpen(now: Date): Promise<AutoBookResult> {
  const result: AutoBookResult = { booked: 0, failed: 0 };
  const suppliers = await Supplier.find({ archived: false });
  const flagged = new Map(suppliers.filter((s) => s.autoBook).map((s) => [String(s._id), s]));
  if (flagged.size === 0) return result;
  const history = await loadHistory(now);

  const folder = await getReceiptsFolder();
  const warnings = new Set<string>();
  let drive: ReturnType<typeof driveForCron> | null = null;
  const filesByYear = new Map<number, Promise<ReceiptFile[]>>();
  const receiptsFor = (year: number): Promise<ReceiptFile[]> => {
    if (!folder) return Promise.resolve([]);
    if (!filesByYear.has(year)) {
      drive ??= driveForCron();
      filesByYear.set(
        year,
        drive
          .then((d) => {
            if (!d) throw new Error('Drive nicht verbunden');
            return listReceiptFiles(d, folder.id, year);
          })
          .catch((err: unknown) => {
            warnings.add(`Belege ${year} nicht geladen (${(err as Error).message}) — ohne Beleg gebucht`);
            return [];
          }),
      );
    }
    return filesByYear.get(year)!;
  };

  for (const year of await bookableYears(now)) {
    // Outgoing only: an unmatched incoming payment may still belong to an invoice.
    const candidates = (await openTransactions(year)).filter((t) => t.direction === 'out');
    const reversed = await reversedRefs(candidates.map((t) => t.fireflyJournalId));
    for (const tx of candidates) {
      if (reversed.has(tx.fireflyJournalId)) continue;
      const s = suggestWithHistory(tx, suppliers, history);
      const supplier = s?.supplierId ? (flagged.get(s.supplierId) ?? null) : null;
      if (!s || s.vatRate === undefined || !isAutoBookable(s, supplier)) continue;
      try {
        const file = tx.receipt?.driveFileId
          ? null
          : strongReceipt(rankReceipts(await receiptsFor(new Date(tx.date).getFullYear()), tx, s.supplierName));
        await bookBankTransaction({
          bankTxId: String(tx._id),
          account: s.account ?? '',
          vatRate: s.vatRate,
          mode: s.mode,
          supplierId: s.supplierId,
          receipt: file ? { driveFileId: file.id, fileName: file.name, link: file.link } : undefined,
          createdBy: AUTO_BOOK_USER,
        });
        result.booked += 1;
      } catch (err) {
        if (isConcurrentBookingError(err)) continue;
        result.failed += 1;
      }
    }
  }
  if (warnings.size > 0) result.warning = [...warnings].join('; ');
  return result;
}
