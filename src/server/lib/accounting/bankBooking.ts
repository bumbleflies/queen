import { BankTransaction } from '../../models/BankTransaction';
import type { SupplierDoc } from '../../models/Supplier';
import type { HydratedDocument } from 'mongoose';
import { Supplier } from '../../models/Supplier';
import { allocateSupplierNumber } from '../numbering';
import { findActiveBySource, post, reverse } from './ledger';
import { bankPosting, type BankBookingMode } from './postingRules';
import { normalizeIban } from './suggest';

export type BookingErrorCode = 'NOT_FOUND' | 'MATCHED' | 'ALREADY_BOOKED' | 'NOT_BOOKED' | 'SUPPLIER_NOT_FOUND';

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
  supplierId?: string;
  text?: string;
  rememberRule?: boolean;
  receipt?: { driveFileId: string; fileName: string; link: string } | null;
  receiptMissingReason?: string | null;
  createdBy: string;
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

  const lines = bankPosting({
    direction: tx.direction === 'out' ? 'out' : 'in',
    grossCents: tx.amountCents,
    account: input.account,
    vatRate: input.vatRate,
    mode: input.mode,
  });
  const entry = await post({
    date: tx.date,
    text: input.text?.trim() || defaultBookingText(tx, supplier?.name),
    lines,
    source: { kind: 'bank', refId: tx.fireflyJournalId },
    createdBy: input.createdBy,
  });

  if (input.rememberRule) supplier = await rememberRule(tx, input, supplier);
  if (supplier) tx.supplierId = supplier._id;
  if (input.receipt !== undefined) tx.receipt = input.receipt ?? undefined;
  if (input.receiptMissingReason !== undefined) tx.receiptMissingReason = input.receiptMissingReason ?? undefined;
  await tx.save();
  return { entry, tx };
}

/** Create or extend a supplier so the next matching transaction gets the same suggestion. */
async function rememberRule(
  tx: { counterpartyName?: string | null; counterpartyIban?: string | null; description: string },
  input: Pick<BookBankInput, 'account' | 'vatRate' | 'mode'>,
  supplier: HydratedDocument<SupplierDoc> | null,
) {
  const s: HydratedDocument<SupplierDoc> =
    supplier ??
    new Supplier({
      kreditorNumber: await allocateSupplierNumber(),
      name: tx.counterpartyName?.trim() || tx.description.slice(0, 60),
    });
  const iban = tx.counterpartyIban ? normalizeIban(tx.counterpartyIban) : '';
  if (iban) {
    if (!s.ibans.includes(iban)) s.ibans.push(iban);
  } else if (tx.counterpartyName?.trim()) {
    if (!s.namePatterns.includes(tx.counterpartyName.trim())) s.namePatterns.push(tx.counterpartyName.trim());
  } else {
    const pattern = tx.description.slice(0, 40).trim();
    if (pattern && !s.purposePatterns.includes(pattern)) s.purposePatterns.push(pattern);
  }
  if (input.mode === 'normal') s.defaultAccount = input.account;
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
