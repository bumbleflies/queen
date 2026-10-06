import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const lineSourceSchema = new Schema(
  {
    leagueId: { type: Number },
    chosenSource: { type: String, enum: ['offer', 'live', 'custom'] },
  },
  { _id: false },
);

const invoiceLineSchema = new Schema(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    position: { type: String, required: true },
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    // Integer cents (may be negative for discount lines). Line totals derived, not stored.
    unitNetCents: { type: Number, required: true },
    vatRate: { type: Number, required: true },
    vatNote: { type: String },
    source: { type: lineSourceSchema },
  },
  { timestamps: true },
);

export type InvoiceLineDoc = InferSchemaType<typeof invoiceLineSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const InvoiceLine =
  (mongoose.models.InvoiceLine as mongoose.Model<InvoiceLineDoc> | undefined) ??
  mongoose.model<InvoiceLineDoc>('InvoiceLine', invoiceLineSchema);
