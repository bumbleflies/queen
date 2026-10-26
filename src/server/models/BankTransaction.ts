import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const readingSchema = new Schema(
  {
    vendor: { type: String, default: '' },
    country: { type: String },
    date: { type: String },
    totalCents: { type: Number, required: true },
    reverseCharge: { type: Boolean, required: true, default: false },
    lines: [
      new Schema(
        { vatRate: { type: Number, required: true }, grossCents: { type: Number, required: true }, account: { type: String, required: true } },
        { _id: false },
      ),
    ],
  },
  { _id: false },
);

/** One receipt file that was read (cache; re-read of 'failed' files is allowed). */
const receiptFileReadingSchema = new Schema(
  {
    driveFileId: { type: String, required: true },
    fileName: { type: String },
    status: { type: String, enum: ['ok', 'failed', 'noText'], required: true },
    reading: { type: readingSchema },
    /** Drive web link of the file, so a matched set can be attached to the posting. */
    link: { type: String },
    model: { type: String },
    readAt: { type: Date, required: true },
    error: { type: String },
  },
  { _id: false },
);

/** The receipts whose totals add up to the transaction, merged into one reading. */
const receiptMatchSchema = new Schema(
  {
    driveFileIds: { type: [String], required: true },
    reading: { type: readingSchema, required: true },
    model: { type: String },
    readAt: { type: Date, required: true },
  },
  { _id: false },
);

const bankTransactionSchema = new Schema(
  {
    fireflyJournalId: { type: String, required: true, unique: true },
    date: { type: Date, required: true },
    amountCents: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EUR' },
    description: { type: String, required: true, default: '' },
    counterpartyName: { type: String },
    counterpartyIban: { type: String },
    direction: { type: String, enum: ['in', 'out'], required: true, default: 'in' },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    receipt: {
      type: new Schema(
        { driveFileId: { type: String }, fileName: { type: String }, link: { type: String } },
        { _id: false },
      ),
    },
    receiptMissingReason: { type: String },
    /** Every receipt file read for this transaction (per Drive file; 'ok'/'noText' are final). */
    receiptReadings: { type: [receiptFileReadingSchema], default: [] },
    /** The set of readings whose totals add up to the transaction amount. */
    receiptMatch: { type: receiptMatchSchema },
    /** Legacy single reading (pre multi-receipt); still honoured, no longer written. */
    receiptReading: { type: receiptFileReadingSchema },
    matchedInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    matchMethod: { type: String, enum: ['reference', 'manual'] },
    ignored: { type: Boolean, required: true, default: false },
    importedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

export type BankTransactionDoc = InferSchemaType<typeof bankTransactionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const BankTransaction =
  (mongoose.models.BankTransaction as mongoose.Model<BankTransactionDoc> | undefined) ??
  mongoose.model<BankTransactionDoc>('BankTransaction', bankTransactionSchema);
