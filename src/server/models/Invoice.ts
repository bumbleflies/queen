import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const totalsSchema = new Schema(
  {
    netCents: { type: Number, required: true, default: 0 },
    vatCents: { type: Number, required: true, default: 0 },
    grossCents: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const paymentSchema = new Schema(
  {
    bankTxId: { type: String, required: true },
    amountCents: { type: Number, required: true },
    date: { type: Date, required: true },
    counterpartyIban: { type: String },
    reference: { type: String },
  },
  { _id: false },
);

const driveMetadataSchema = new Schema(
  {
    fileId: { type: String },
    folderId: { type: String },
    link: { type: String },
    fileName: { type: String },
    filedAt: { type: Date },
    failureReason: { type: String },
  },
  { _id: false },
);

const sourceSchema = new Schema(
  {
    system: { type: String },
    offerId: { type: String },
    seasonId: { type: Number },
    associationId: { type: String },
  },
  { _id: false },
);

const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    legacy: { type: Boolean, required: true, default: false },
    kind: { type: String, enum: ['invoice', 'credit_note'], required: true, default: 'invoice' },
    cancels: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true },
    customerNumber: { type: Number, required: true },
    invoiceAddress: { type: String, required: true },
    title: { type: String, required: true },
    invoiceDate: { type: Date },
    servicePeriod: { type: String, required: true },
    paymentTermDays: { type: Number, required: true },
    dueDate: { type: Date },
    currency: { type: String, required: true, default: 'EUR' },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'canceled'],
      required: true,
      default: 'draft',
    },
    sentAt: { type: Date },
    paidAt: { type: Date },
    canceledAt: { type: Date },
    totals: { type: totalsSchema, required: true, default: () => ({}) },
    payments: { type: [paymentSchema], required: true, default: [] },
    reconcileState: {
      type: String,
      enum: ['unmatched', 'partial', 'matched', 'overpaid'],
      required: true,
      default: 'unmatched',
    },
    // Imported from the Sheet as paid: payment date/transaction unknown (paidAt stays empty).
    importedPaid: { type: Boolean, default: false },
    filingUserId: { type: String },
    driveMetadata: { type: driveMetadataSchema },
    source: { type: sourceSchema },
    footerNotes: { type: [String], default: [] },
  },
  { timestamps: true },
);

export type InvoiceDoc = InferSchemaType<typeof invoiceSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Invoice =
  (mongoose.models.Invoice as mongoose.Model<InvoiceDoc> | undefined) ??
  mongoose.model<InvoiceDoc>('Invoice', invoiceSchema);
