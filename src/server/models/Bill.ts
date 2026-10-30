import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * A vendor invoice that arrived by e-mail. Deliberately *not* a bank
 * transaction and *not* a supplier rule: intake only stores what the PDF said
 * and files the PDF as a receipt, so nothing is booked, matched to an invoice
 * or taught as a rule before a human (or the existing booking flow) decides.
 */
const parsedBillSchema = new Schema(
  {
    vendorName: { type: String, default: '' },
    invoiceNumber: { type: String, default: '' },
    grossCents: { type: Number },
    netCents: { type: Number },
    vatCents: { type: Number },
    /** 0.19 / 0.07 / 0 only when the document states it; null when unknown. */
    vatRate: { type: Number },
    iban: { type: String, default: '' },
    dueDate: { type: Date },
    reverseCharge: { type: Boolean, default: false },
  },
  { _id: false },
);

const billSchema = new Schema(
  {
    /** Gmail message + attachment: the natural key that makes intake idempotent. */
    messageId: { type: String, required: true },
    attachmentId: { type: String, required: true },
    /** Content hash, so the same PDF forwarded twice is filed once. */
    sha256: { type: String, required: true },
    /** Mailbox the bill was read from. */
    mailbox: { type: String, required: true },
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: Date, required: true },
    /** Original attachment name, kept for traceability. */
    fileName: { type: String, required: true },
    /** The PDF as filed in `<receipts folder>/<year>/`; empty when filing failed (the row is then not written). */
    driveFileId: { type: String, required: true },
    driveLink: { type: String, default: '' },
    /** `noText` = filed but the PDF has no readable text layer (a scan). */
    status: { type: String, enum: ['parsed', 'noText', 'failed'], required: true, default: 'parsed' },
    parse: { type: parsedBillSchema },
    error: { type: String },
    /** Hidden from the list; bills are never deleted (audit trail). */
    ignored: { type: Boolean, required: true, default: false },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

billSchema.index({ messageId: 1, attachmentId: 1 }, { unique: true });
billSchema.index({ sha256: 1 });
billSchema.index({ receivedAt: -1 });

export type BillDoc = InferSchemaType<typeof billSchema> & { _id: mongoose.Types.ObjectId };

export const Bill =
  (mongoose.models.Bill as mongoose.Model<BillDoc> | undefined) ??
  mongoose.model<BillDoc>('Bill', billSchema);
