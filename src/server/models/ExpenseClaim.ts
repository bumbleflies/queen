import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * The fields of a receipt that matter for an expense claim. Shared by the PDF
 * read (`parse`) and an admin's correction (`corrected`) so both carry exactly
 * the same shape — the correction wins field by field (`claimFieldsOf`).
 */
const claimPaymentFields = () => ({
  date: { type: Date },
  vendorName: { type: String, default: '' },
  invoiceNumber: { type: String, default: '' },
  grossCents: { type: Number },
  netCents: { type: Number },
  vatCents: { type: Number },
  vatRate: { type: Number },
  /** Vendor IBAN from the document; matches an earlier claim's account suggestion. */
  iban: { type: String, default: '' },
  account: { type: String },
  reverseCharge: { type: Boolean, default: false },
  /** True only when the PDF names bumbleflies as recipient; drives Vorsteuer. */
  addressedToCompany: { type: Boolean, default: false },
  currency: { type: String, default: 'EUR' },
});

const claimParseSchema = new Schema(claimPaymentFields(), { _id: false });
/**
 * A correction stores only the fields an admin actually changed — no defaults,
 * so an untouched field keeps whatever the PDF read said (`claimFieldsOf`).
 */
const claimCorrectionFields = () => ({
  date: { type: Date },
  vendorName: { type: String },
  invoiceNumber: { type: String },
  grossCents: { type: Number },
  netCents: { type: Number },
  vatCents: { type: Number },
  vatRate: { type: Number },
  account: { type: String },
  reverseCharge: { type: Boolean },
  addressedToCompany: { type: Boolean },
  currency: { type: String },
});
const claimCorrectionSchema = new Schema(
  { ...claimCorrectionFields(), correctedAt: { type: Date, required: true }, correctedBy: { type: String, required: true } },
  { _id: false },
);

/**
 * A privately paid receipt a founder forwarded to `expenses@`, waiting to be
 * booked and later reimbursed. Deliberately *not* a payment: a claim that
 * arrived books nothing, and the settlement is only posted from the matched
 * bank transaction.
 */
const expenseClaimSchema = new Schema(
  {
    messageId: { type: String, required: true },
    attachmentId: { type: String, required: true },
    sha256: { type: String, required: true },
    mailbox: { type: String, required: true },
    from: { type: String, default: '' },
    subject: { type: String, default: '' },
    receivedAt: { type: Date, required: true },
    fileName: { type: String, required: true },
    driveFileId: { type: String, default: '' },
    driveLink: { type: String, default: '' },
    founderId: { type: Schema.Types.ObjectId, ref: 'Founder' },
    status: {
      type: String,
      enum: ['received', 'booked', 'payoutPending', 'settled', 'ignored'],
      required: true,
      default: 'received',
    },
    /** `YYYY-MM` of the receipt date: the period the expense belongs to. */
    period: { type: String, required: true },
    parse: { type: claimParseSchema },
    corrected: { type: claimCorrectionSchema },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedEntryIds: { type: [Schema.Types.ObjectId], default: [] },
    payoutId: { type: Schema.Types.ObjectId, ref: 'Payout' },
    error: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

expenseClaimSchema.index({ messageId: 1, attachmentId: 1 }, { unique: true });
expenseClaimSchema.index({ sha256: 1 });
expenseClaimSchema.index({ receivedAt: -1 });
expenseClaimSchema.index({ founderId: 1, status: 1 });
expenseClaimSchema.index({ payoutId: 1 });

export type ExpenseClaimDoc = InferSchemaType<typeof expenseClaimSchema> & { _id: mongoose.Types.ObjectId };
export const ExpenseClaim =
  (mongoose.models.ExpenseClaim as mongoose.Model<ExpenseClaimDoc> | undefined) ??
  mongoose.model<ExpenseClaimDoc>('ExpenseClaim', expenseClaimSchema);
