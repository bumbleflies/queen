import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const fiscalYearSchema = new Schema(
  {
    year: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['open', 'closing', 'closed'], required: true, default: 'open' },
    vatMethod: { type: String, enum: ['soll'], required: true, default: 'soll' },
    vatPeriod: {
      type: String,
      enum: ['quarter', 'month', 'year'],
      required: true,
      default: 'quarter',
    },
    hebesatz: { type: Number, required: true, default: 490 },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

export type FiscalYearDoc = InferSchemaType<typeof fiscalYearSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const FiscalYear =
  (mongoose.models.FiscalYear as mongoose.Model<FiscalYearDoc> | undefined) ??
  mongoose.model<FiscalYearDoc>('FiscalYear', fiscalYearSchema);
