import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const supplierSchema = new Schema(
  {
    kreditorNumber: { type: Number, required: true, unique: true, min: 70000, max: 99999 },
    name: { type: String, required: true },
    ibans: { type: [String], required: true, default: [] },
    namePatterns: { type: [String], required: true, default: [] },
    purposePatterns: { type: [String], required: true, default: [] },
    defaultAccount: { type: String },
    defaultVatRate: { type: Number },
    defaultMode: { type: String, enum: ['normal', 'vatOnly'], required: true, default: 'normal' },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type SupplierDoc = InferSchemaType<typeof supplierSchema> & { _id: mongoose.Types.ObjectId };

export const Supplier =
  (mongoose.models.Supplier as mongoose.Model<SupplierDoc> | undefined) ??
  mongoose.model<SupplierDoc>('Supplier', supplierSchema);
