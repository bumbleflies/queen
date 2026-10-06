import mongoose, { Schema } from 'mongoose';

export interface CounterDoc {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterDoc>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter =
  (mongoose.models.Counter as mongoose.Model<CounterDoc> | undefined) ??
  mongoose.model<CounterDoc>('Counter', counterSchema);
