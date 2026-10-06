import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const externalRefSchema = new Schema(
  {
    system: { type: String, required: true },
    associationId: { type: String, required: true },
  },
  { _id: false },
);

const clientSchema = new Schema(
  {
    customerNumber: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    invoiceAddress: { type: String, required: true },
    domain: { type: String, trim: true },
    defaultPaymentTermDays: { type: Number, required: true, default: 30 },
    email: { type: String, trim: true },
    archived: { type: Boolean, required: true, default: false },
    externalRefs: { type: [externalRefSchema], default: undefined },
  },
  { timestamps: true },
);

export type ClientDoc = InferSchemaType<typeof clientSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Client =
  (mongoose.models.Client as mongoose.Model<ClientDoc> | undefined) ??
  mongoose.model<ClientDoc>('Client', clientSchema);
