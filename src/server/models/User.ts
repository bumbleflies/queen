import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user', required: true },
    googleId: { type: String },
    // TODO: encrypt refreshToken at rest (e.g. AES-GCM with a KMS key) — plain for now. Follow-up before prod.
    refreshToken: { type: String },
    allowed: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
