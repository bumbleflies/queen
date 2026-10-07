import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ACCOUNT_TYPES } from '../lib/accounting/skr04';

const accountSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, match: /^\d{4,5}$/ },
    name: { type: String, required: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    vatRate: { type: Number },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type AccountDoc = InferSchemaType<typeof accountSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Account =
  (mongoose.models.Account as mongoose.Model<AccountDoc> | undefined) ??
  mongoose.model<AccountDoc>('Account', accountSchema);
