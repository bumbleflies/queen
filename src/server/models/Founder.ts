import mongoose, { Schema, type InferSchemaType } from 'mongoose';

/**
 * A founder who pays company expenses privately and is reimbursed later.
 *
 * The registry is admin-managed: the addresses in `emails` are what map an
 * incoming `expenses@` mail to this person, and `loginEmail` is the workspace
 * account the payout deep link lands on. The IBAN is the payout target — it is
 * never a supplier rule, so the booking automation must not learn from it.
 */
const founderSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    /** Short form used in file names and purpose, e.g. "ChrisK". */
    shortName: { type: String, required: true, trim: true },
    /** Lowercase addresses that map a mail to this founder. */
    emails: { type: [String], required: true, default: [] },
    /** Workspace address used for payout mails and the login deep link. */
    loginEmail: { type: String, required: true },
    iban: { type: String, required: true },
    bic: { type: String, default: '' },
    /** SKR04 liability account; 3500 by default, 1700 once the advisor confirms. */
    liabilityAccount: { type: String, required: true, default: '3500' },
    /** Legacy number from the old sheet, for traceability only. */
    legacyCreditorNumber: { type: Number },
    active: { type: Boolean, required: true, default: true },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

founderSchema.index({ emails: 1 });
founderSchema.index({ iban: 1 });

export type FounderDoc = InferSchemaType<typeof founderSchema> & { _id: mongoose.Types.ObjectId };

export const Founder =
  (mongoose.models.Founder as mongoose.Model<FounderDoc> | undefined) ??
  mongoose.model<FounderDoc>('Founder', founderSchema);
