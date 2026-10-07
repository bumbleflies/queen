import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const SOURCE_KINDS = [
  'opening',
  'invoice',
  'credit_note',
  'payment',
  'bank',
  'manual',
  'vat_close',
  'tax_provision',
  'appropriation',
  'closing',
  'reversal',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const IMMUTABLE = 'Journal entries are immutable; use reverse()';
// The only fields reverse() may change on a posted entry.
const MUTABLE_AFTER_POST = new Set(['active', 'reversedBy', 'updatedAt']);

const lineSchema = new Schema(
  {
    account: { type: String, required: true },
    debitCents: { type: Number, required: true, default: 0 },
    creditCents: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const journalEntrySchema = new Schema(
  {
    entryNumber: { type: String, required: true, unique: true },
    date: { type: Date, required: true },
    fiscalYear: { type: Number, required: true, index: true },
    text: { type: String, required: true },
    lines: { type: [lineSchema], required: true },
    source: {
      kind: { type: String, enum: SOURCE_KINDS, required: true },
      refId: { type: String },
    },
    // false once reversed; only active entries count for idempotency.
    active: { type: Boolean, required: true, default: true },
    reverses: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

journalEntrySchema.index({ 'lines.account': 1, fiscalYear: 1 });
journalEntrySchema.index(
  { 'source.kind': 1, 'source.refId': 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, 'source.refId': { $exists: true } },
  },
);

journalEntrySchema.pre('save', function () {
  if (this.isNew) return;
  const changed = this.modifiedPaths().filter((p) => !MUTABLE_AFTER_POST.has(p));
  if (changed.length > 0) throw new Error(`${IMMUTABLE} (tried to change ${changed.join(', ')})`);
});

for (const op of [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const) {
  journalEntrySchema.pre(op, () => {
    throw new Error(IMMUTABLE);
  });
}

export type JournalEntryDoc = InferSchemaType<typeof journalEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const JournalEntry =
  (mongoose.models.JournalEntry as mongoose.Model<JournalEntryDoc> | undefined) ??
  mongoose.model<JournalEntryDoc>('JournalEntry', journalEntrySchema);
