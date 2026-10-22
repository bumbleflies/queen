import { BankTransaction, type BankTransactionDoc } from '../../models/BankTransaction';
import type { SupplierDoc } from '../../models/Supplier';
import type { HydratedDocument } from 'mongoose';
import { Supplier } from '../../models/Supplier';
import { allocateSupplierNumber } from '../numbering';
import { findActiveBySource, post, reverse } from './ledger';
import { bankPosting, bankPostingSplit, type BankBookingMode, type SplitPart } from './postingRules';
import { learningKey, type RuleKey } from './ruleLearning';
import { suggest, type SuggestTx } from './suggest';

export type BookingErrorCode = 'NOT_FOUND' | 'MATCHED' | 'ALREADY_BOOKED' | 'NOT_BOOKED' | 'SUPPLIER_NOT_FOUND' | 'FORBIDDEN';

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
  }
}

/** Coverage rule: an active invoice payment or an active inbox booking. */
export async function findCoverage(
  fireflyJournalId: string,
): Promise<{ kind: 'payment' | 'bank'; entryId: string } | null> {
  const payment = await findActiveBySource('payment', `bank:${fireflyJournalId}`);
  if (payment) return { kind: 'payment', entryId: String(payment._id) };
  const bank = await findActiveBySource('bank', fireflyJournalId);
  if (bank) return { kind: 'bank', entryId: String(bank._id) };
  return null;
}

export function defaultBookingText(
  tx: { counterpartyName?: string | null; description: string },
  supplierName?: string,
): string {
  const who = supplierName ?? tx.counterpartyName ?? 'Bank';
  return `${who} · ${tx.description}`.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export interface BookBankInput {
  bankTxId: string;
  account: string;
  vatRate: number;
  mode: BankBookingMode;
  /** Several accounts / VAT rates; `account`/`vatRate`/`mode` are then ignored and no rule is remembered. */
  split?: SplitPart[];
  supplierId?: string;
  text?: string;
  receipt?: { driveFileId: string; fileName: string; link: string } | null;
  receiptMissingReason?: string | null;
  createdBy: string;
  /** The caller's role: only an admin may change a rule that books automatically. */
  role?: string;
}

export async function bookBankTransaction(input: BookBankInput) {
  const tx = await BankTransaction.findById(input.bankTxId);
  if (!tx) throw new BookingError('NOT_FOUND', 'Banktransaktion nicht gefunden');
  if (tx.matchedInvoiceId) {
    throw new BookingError('MATCHED', 'Transaktion ist einer Rechnung zugeordnet — Zahlung dort lösen');
  }
  if (await findCoverage(tx.fireflyJournalId)) {
    throw new BookingError('ALREADY_BOOKED', 'Transaktion ist bereits gebucht');
  }
  let supplier = input.supplierId ? await Supplier.findById(input.supplierId) : null;
  if (input.supplierId && !supplier) throw new BookingError('SUPPLIER_NOT_FOUND', 'Kreditor nicht gefunden');

  const direction = tx.direction === 'out' ? 'out' : 'in';
  const lines = input.split
    ? bankPostingSplit({ direction, grossCents: tx.amountCents, parts: input.split })
    : bankPosting({ direction, grossCents: tx.amountCents, account: input.account, vatRate: input.vatRate, mode: input.mode });
  const entry = await post({
    date: tx.date,
    text: input.text?.trim() || defaultBookingText(tx, supplier?.name),
    lines,
    source: { kind: 'bank', refId: tx.fireflyJournalId },
    createdBy: input.createdBy,
  });

  supplier = await learnFromBooking(tx, input, supplier, direction);
  if (supplier) tx.supplierId = supplier._id;
  if (input.receipt !== undefined) tx.receipt = input.receipt ?? undefined;
  else attachMatchedReceipt(tx);
  if (input.receiptMissingReason !== undefined) tx.receiptMissingReason = input.receiptMissingReason ?? undefined;
  await tx.save();
  return { entry, tx };
}

/**
 * Every confirmed single-account booking teaches the rule for its counterparty
 * (IBAN → name → purpose prefix), so the next row arrives pre-classified. Split
 * bookings, incoming payments and collective reimbursements (receipt vendor is
 * not the bank counterparty) teach nothing. A rule that books automatically is
 * only changed by an admin; the booking itself always goes through.
 */
async function learnFromBooking(
  tx: HydratedDocument<BookBankTx>,
  input: Pick<BookBankInput, 'account' | 'vatRate' | 'mode' | 'split' | 'role'>,
  supplier: HydratedDocument<SupplierDoc> | null,
  direction: 'in' | 'out',
): Promise<HydratedDocument<SupplierDoc> | null> {
  const key = learningKey({
    direction,
    split: !!input.split,
    receiptVendor: tx.receiptMatch?.reading?.vendor ?? tx.receiptReading?.reading?.vendor,
    counterpartyName: tx.counterpartyName,
    counterpartyIban: tx.counterpartyIban,
    description: tx.description,
  });
  if (!key) return supplier;
  const target = supplier ?? (await matchingRule(tx));
  if (target?.autoBook && input.role !== 'admin') return supplier;
  return rememberRule(key, tx, input, target);
}

type BookBankTx = {
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
  receiptMatch?: { reading?: { vendor?: string | null } | null } | null;
  receiptReading?: { reading?: { vendor?: string | null } | null } | null;
};

/** An existing active rule that would have matched this row, so learning extends instead of duplicating. */
async function matchingRule(tx: SuggestTx): Promise<HydratedDocument<SupplierDoc> | null> {
  const active = await Supplier.find({ archived: false });
  const id = suggest(tx, active)?.supplierId;
  return (id ? active.find((s) => String(s._id) === id) : null) ?? null;
}

/**
 * Attach the receipt set that matched this row (first file, link from the
 * reading) when the caller passed none. Rule, bulk and automatic bookings
 * thereby carry their document.
 */
function attachMatchedReceipt(tx: HydratedDocument<BankTransactionDoc>): void {
  if (tx.receipt?.driveFileId) return;
  const ids = tx.receiptMatch?.driveFileIds ?? [];
  const id = ids[0];
  if (!id) return;
  const file =
    (tx.receiptReadings ?? []).find((r) => r.driveFileId === id) ??
    (tx.receiptReading?.driveFileId === id ? tx.receiptReading : undefined);
  tx.receipt = {
    driveFileId: id,
    fileName: file?.fileName ?? undefined,
    link: file?.link ?? `https://drive.google.com/file/d/${id}/view`,
  };
}

/** Create or extend a supplier so the next matching transaction gets the same suggestion. */
async function rememberRule(
  key: RuleKey,
  tx: { counterpartyName?: string | null; description: string },
  input: Pick<BookBankInput, 'account' | 'vatRate' | 'mode'>,
  supplier: HydratedDocument<SupplierDoc> | null,
) {
  const s: HydratedDocument<SupplierDoc> =
    supplier ??
    new Supplier({
      kreditorNumber: await allocateSupplierNumber(),
      name: tx.counterpartyName?.trim() || key.value || tx.description.slice(0, 60),
      origin: 'learned',
      learnedAt: new Date(),
    });
  if (key.kind === 'iban') {
    if (!s.ibans.includes(key.value)) s.ibans.push(key.value);
  } else if (key.kind === 'name') {
    if (!s.namePatterns.some((p) => p.toLowerCase() === key.value.toLowerCase())) s.namePatterns.push(key.value);
  } else if (!s.purposePatterns.some((p) => p.toLowerCase() === key.value.toLowerCase())) {
    s.purposePatterns.push(key.value);
  }
  if (input.mode === 'normal' || input.mode === 'reverseCharge') s.defaultAccount = input.account;
  s.defaultVatRate = input.vatRate;
  s.defaultMode = input.mode;
  await s.save();
  return s;
}

export async function unbookBankTransaction(bankTxId: string, reason: string, createdBy: string) {
  const tx = await BankTransaction.findById(bankTxId);
  if (!tx) throw new BookingError('NOT_FOUND', 'Banktransaktion nicht gefunden');
  const coverage = await findCoverage(tx.fireflyJournalId);
  if (coverage?.kind !== 'bank') throw new BookingError('NOT_BOOKED', 'Transaktion ist nicht im Buchen-Eingang gebucht');
  const { reversal } = await reverse(coverage.entryId, { reason, createdBy });
  return { reversal };
}
