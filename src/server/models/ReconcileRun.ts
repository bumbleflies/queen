import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const reconcileRunSchema = new Schema(
  {
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date },
    fetched: { type: Number, required: true, default: 0 },
    matched: { type: Number, required: true, default: 0 },
    partial: { type: Number, required: true, default: 0 },
    unmatched: { type: Number, required: true, default: 0 },
    error: { type: String },
  },
  { timestamps: true },
);

export type ReconcileRunDoc = InferSchemaType<typeof reconcileRunSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const ReconcileRun =
  (mongoose.models.ReconcileRun as mongoose.Model<ReconcileRunDoc> | undefined) ??
  mongoose.model<ReconcileRunDoc>('ReconcileRun', reconcileRunSchema);
