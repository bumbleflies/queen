import mongoose, { Schema, type Document } from 'mongoose';

export interface EmailBill {
  id: string;
  emailSource: string;
  messageId: string;
  subject: string;
  date: Date;
  vendor: string;
  vendorName: string;
  invoiceNumber: string;
  amountCents: number;
  vatCents: number;
  iban: string;
  dueDate: string;
  description: string;
  fileId: string;
  status: 'draft' | 'reviewed' | 'posted';
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const EmailBillSchema = new Schema(
  {
    id: { type: String, required: true, unique: true },
    emailSource: { type: String, required: true },
    messageId: { type: String, required: true },
    subject: { type: String, required: true },
    date: { type: Date, required: true },
    vendor: { type: String, required: true },
    vendorName: { type: String, required: true },
    invoiceNumber: { type: String, required: true },
    amountCents: { type: Number, required: true },
    vatCents: { type: Number, required: true },
    iban: { type: String, required: true },
    dueDate: { type: String },
    description: { type: String },
    fileId: { type: String },
    status: { type: String, enum: ['draft', 'reviewed', 'posted'], default: 'draft' },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export type EmailBillDoc = Document & EmailBill & { _id: mongoose.Types.ObjectId };

export const EmailBillModel = (
  mongoose.models.EmailBill as mongoose.Model<EmailBillDoc> | undefined
) ?? mongoose.model<EmailBillDoc>('EmailBill', EmailBillSchema);

export default EmailBillModel;
