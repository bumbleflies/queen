import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const bankTransactionSchema = new Schema(
  {
    fireflyJournalId: { type: String, required: true, unique: true },
    date: { type: Date, required: true },
    amountCents: { type: Number, required: true },
    currency: { type: String, required: true, default: 'EUR' },
    description: { type: String, required: true, default: '' },
    counterpartyName: { type: String },
    counterpartyIban: { type: String },
    matchedInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    matchMethod: { type: String, enum: ['reference', 'manual'] },
    ignored: { type: Boolean, required: true, default: false },
    importedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true },
);

bankTransactionSchema.index({ fireflyJournalId: 1 }, { unique: true });

export type BankTransactionDoc = InferSchemaType<typeof bankTransactionSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const BankTransaction =
  (mongoose.models.BankTransaction as mongoose.Model<BankTransactionDoc> | undefined) ??
  mongoose.model<BankTransactionDoc>('BankTransaction', bankTransactionSchema);
