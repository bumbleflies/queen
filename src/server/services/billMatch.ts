import type { BillLike, TxLike } from '../lib/bills/matchBill';

/** The parsed fields of a `Bill` document (`.lean()` friendly). */
export interface BillFieldsSource {
  vendorName?: string | null;
  invoiceNumber?: string | null;
  grossCents?: number | null;
  netCents?: number | null;
  vatCents?: number | null;
  vatRate?: number | null;
  iban?: string | null;
  dueDate?: Date | null;
  reverseCharge?: boolean | null;
}

/** The parts of a `Bill` document the matcher needs (`.lean()` friendly). */
export interface BillSource {
  _id: unknown;
  receivedAt: Date;
  driveLink?: string | null;
  fileName: string;
  parse?: BillFieldsSource | null;
  /** An admin's correction; wins over `parse` field by field. */
  corrected?: BillFieldsSource | null;
}

/** What a bill says: the admin's correction where there is one, else the read. */
export interface BillFields {
  vendorName: string;
  invoiceNumber: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  vatRate: number | null;
  iban: string;
  dueDate: Date | null;
  reverseCharge: boolean;
}

export function billFieldsOf(bill: BillSource): BillFields {
  const read = bill.parse ?? {};
  const fixed = bill.corrected ?? {};
  // A corrected value wins even when it is `null`: that is an admin clearing a
  // field the read got wrong. `undefined` means the correction never touched it.
  const cents = (corrected: number | null | undefined, parsed: number | null | undefined) =>
    corrected !== undefined ? corrected : (parsed ?? null);
  const text = (corrected: string | null | undefined, parsed: string | null | undefined) =>
    corrected !== undefined ? (corrected ?? '') : (parsed ?? '');
  return {
    vendorName: text(fixed.vendorName, read.vendorName),
    invoiceNumber: text(fixed.invoiceNumber, read.invoiceNumber),
    grossCents: cents(fixed.grossCents, read.grossCents),
    netCents: cents(fixed.netCents, read.netCents),
    vatCents: cents(fixed.vatCents, read.vatCents),
    vatRate: cents(fixed.vatRate, read.vatRate),
    iban: text(fixed.iban, read.iban),
    dueDate: fixed.dueDate !== undefined ? fixed.dueDate : (read.dueDate ?? null),
    reverseCharge: fixed.reverseCharge !== undefined ? (fixed.reverseCharge ?? false) : (read.reverseCharge ?? false),
  };
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
  const fields = billFieldsOf(bill);
  return {
    grossCents: fields.grossCents,
    iban: fields.iban,
    vendorName: fields.vendorName,
    invoiceNumber: fields.invoiceNumber,
    receivedAt: bill.receivedAt,
    dueDate: fields.dueDate,
  };
}

export function txLikeOf(tx: TxSource): TxLike {
  return {
    _id: tx._id,
    date: tx.date,
    amountCents: tx.amountCents,
    direction: tx.direction,
    counterpartyName: tx.counterpartyName ?? null,
    counterpartyIban: tx.counterpartyIban ?? null,
    description: tx.description ?? null,
  };
}

export function billHintOf(bill: BillSource): BillHint {
  const fields = billFieldsOf(bill);
  return {
    id: String(bill._id),
    vendorName: fields.vendorName,
    invoiceNumber: fields.invoiceNumber,
    grossCents: fields.grossCents,
    driveLink: bill.driveLink ?? '',
    fileName: bill.fileName,
  };
}
