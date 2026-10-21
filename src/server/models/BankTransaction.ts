import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const receiptReadingSchema = new Schema(
  {
    driveFileId: { type: String, required: true },
    status: { type: String, enum: ['ok', 'failed', 'noText'], required: true },
    reading: {
      type: new Schema(
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
      ),
    },
    model: { type: String },
    readAt: { type: Date, required: true },
    error: { type: String },
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
    /** Cached opencode reading of the receipt (per Drive file; re-read only when forced). */
    receiptReading: { type: receiptReadingSchema },
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
