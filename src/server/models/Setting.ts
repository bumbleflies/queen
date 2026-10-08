import mongoose from 'mongoose';

export interface DriveSettingValue {
  invoicesFolderId?: string | null;
  invoicesFolderName?: string | null;
  receiptsFolderId?: string | null;
  receiptsFolderName?: string | null;
  [key: string]: unknown;
}

const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: {} },
  updatedBy: { type: String },
  updatedAt: { type: Date, default: () => new Date() },
});

export const Setting = mongoose.model('Setting', settingSchema);
