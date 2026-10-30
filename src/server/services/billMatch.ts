import type { BillLike, TxLike } from '../lib/bills/matchBill';

/** The parts of a `Bill` document the matcher needs (`.lean()` friendly). */
export interface BillSource {
  _id: unknown;
  receivedAt: Date;
  driveLink?: string | null;
  fileName: string;
  parse?: {
    vendorName?: string | null;
    invoiceNumber?: string | null;
    grossCents?: number | null;
    iban?: string | null;
    dueDate?: Date | null;
  } | null;
}

export interface TxSource {
  _id: unknown;
  date: Date;
  amountCents: number;
  direction: string;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description?: string | null;
}

/** What the finance inbox shows about a bill that arrived by e-mail. */
export interface BillHint {
  id: string;
  vendorName: string;
  invoiceNumber: string;
  grossCents: number | null;
  driveLink: string;
  fileName: string;
}

export function billLikeOf(bill: BillSource): BillLike {
  return {
    grossCents: bill.parse?.grossCents ?? null,
    iban: bill.parse?.iban ?? '',
    vendorName: bill.parse?.vendorName ?? '',
    invoiceNumber: bill.parse?.invoiceNumber ?? '',
    receivedAt: bill.receivedAt,
    dueDate: bill.parse?.dueDate ?? null,
  };
}

export function txLikeOf(tx: Omit<TxSource, '_id'>): TxLike {
  return {
    date: tx.date,
    amountCents: tx.amountCents,
    direction: tx.direction,
    counterpartyName: tx.counterpartyName ?? null,
    counterpartyIban: tx.counterpartyIban ?? null,
    description: tx.description ?? null,
  };
}

export function billHintOf(bill: BillSource): BillHint {
  return {
    id: String(bill._id),
    vendorName: bill.parse?.vendorName ?? '',
    invoiceNumber: bill.parse?.invoiceNumber ?? '',
    grossCents: bill.parse?.grossCents ?? null,
    driveLink: bill.driveLink ?? '',
    fileName: bill.fileName,
  };
}
