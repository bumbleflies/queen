import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String },
    role: { type: String, enum: ['admin', 'user'], default: 'user', required: true },
    googleId: { type: String },
    // TODO: encrypt refreshToken at rest (e.g. AES-GCM with a KMS key) — plain for now. Follow-up before prod.
    refreshToken: { type: String },
    /** sha256 of the live one-time invite token; the plaintext is never stored. */
    inviteTokenHash: { type: String, index: true },
    inviteExpiresAt: { type: Date },
    invitedBy: { type: String },
    /** Disabled, never deleted: `createdBy` on entries must stay resolvable. */
    disabled: { type: Boolean },
    lastLoginAt: { type: Date },
    /** Bumped to kill live sessions; carried as `tv` by invite-redeemed tokens. */
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & { _id: mongoose.Types.ObjectId };

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
