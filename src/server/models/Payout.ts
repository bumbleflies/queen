import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/** Lifecycle of a founder reimbursement. `overdue` does not exist: the bank row decides. */
export const PAYOUT_STATUSES = ['draft', 'released', 'executed', 'settled', 'canceled'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * One reimbursement of booked founder claims. `number` is the human reference
 * on the QR and in the bank purpose; `reference` is the same string, kept as its
 * own field because that is what the settlement matcher reads off the bank row.
 *
 * A payout never books an expense. The liability was booked when the claims were
 * booked; only the matched bank transaction settles it (`expense_payout` entry).
 */
const payoutSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    reference: { type: String, required: true },
    founderId: { type: Schema.Types.ObjectId, ref: 'Founder', required: true },
    claimIds: { type: [Schema.Types.ObjectId], ref: 'ExpenseClaim', required: true, default: [] },
    amountCents: { type: Number, required: true },
    purpose: { type: String, required: true },
    status: { type: String, enum: PAYOUT_STATUSES, required: true, default: 'draft' },
    releasedBy: { type: String },
    releasedAt: { type: Date },
    executedBy: { type: String },
    executedAt: { type: Date },
    /** The bank row that settled it; proof the transfer actually left. */
    transactionId: { type: Schema.Types.ObjectId, ref: 'BankTransaction' },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

payoutSchema.index({ founderId: 1, status: 1 });
payoutSchema.index({ claimIds: 1 });

export type PayoutDoc = InferSchemaType<typeof payoutSchema> & { _id: mongoose.Types.ObjectId };

export const Payout =
  (mongoose.models.Payout as mongoose.Model<PayoutDoc> | undefined) ??
  mongoose.model<PayoutDoc>('Payout', payoutSchema);
