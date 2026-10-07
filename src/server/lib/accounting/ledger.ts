import type { Types } from "mongoose";
import { Account } from "../../models/Account";
import { Counter } from "../../models/Counter";
import { FiscalYear } from "../../models/FiscalYear";
import { JournalEntry, type SourceKind } from "../../models/JournalEntry";
import { reversalLines, type PostingLine } from "./postingRules";

export type LedgerErrorCode =
  | "EMPTY"
  | "INVALID_AMOUNT"
  | "UNBALANCED"
  | "UNKNOWN_ACCOUNT"
  | "YEAR_CLOSED"
  | "DUPLICATE"
  | "NOT_FOUND"
  | "ALREADY_REVERSED"
  | "NOT_REVERSIBLE"
  | "INVALID_ENTRY";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

export interface EntryDraft {
  date: Date;
  text: string;
  lines: PostingLine[];
  source: { kind: SourceKind; refId?: string };
  createdBy: string;
  reverses?: Types.ObjectId;
}

/** Structural checks: ≥ 2 one-sided non-negative integer lines, Σdebit = Σcredit. */
export function validateLines(lines: PostingLine[]): void {
  if (lines.length < 2)
    throw new LedgerError("EMPTY", "An entry needs at least two lines");
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const ints =
      Number.isInteger(l.debitCents) && Number.isInteger(l.creditCents);
    if (!ints || l.debitCents < 0 || l.creditCents < 0) {
      throw new LedgerError(
        "INVALID_AMOUNT",
        `Line ${l.account}: amounts must be non-negative cents`,
      );
    }
    if (l.debitCents > 0 === l.creditCents > 0) {
      throw new LedgerError(
        "INVALID_AMOUNT",
        `Line ${l.account}: exactly one side must be > 0`,
      );
    }
    debit += l.debitCents;
    credit += l.creditCents;
  }
  if (debit !== credit) {
    throw new LedgerError("UNBALANCED", `Soll ${debit} ≠ Haben ${credit}`);
  }
}

export async function ensureFiscalYear(year: number) {
  const fy = await FiscalYear.findOneAndUpdate(
    { year },
    { $setOnInsert: { year } },
    { upsert: true, returnDocument: "after" },
  );
  return fy!;
}

export async function findActiveBySource(kind: SourceKind, refId: string) {
  return JournalEntry.findOne({
    "source.kind": kind,
    "source.refId": refId,
    active: true,
  });
}

async function allocateEntryNumber(year: number): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `journal:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return `${year}-${String(doc?.seq ?? 1).padStart(5, "0")}`;
}

/**
 * The only way to write a journal entry. All checks run BEFORE the number is
 * allocated so rejected drafts never leave a gap. (A concurrent duplicate that
 * loses the unique-index race after allocation can still leave one; queen has
 * a single operator, so this is accepted and documented.)
 */
export async function post(draft: EntryDraft) {
  validateLines(draft.lines);
  if (!draft.text?.trim() || !draft.createdBy?.trim()) {
    throw new LedgerError(
      "INVALID_ENTRY",
      "text and createdBy must be non-empty",
    );
  }
  if (draft.source.refId !== undefined && !draft.source.refId.trim()) {
    throw new LedgerError(
      "INVALID_ENTRY",
      "source.refId must be non-empty when given",
    );
  }

  const numbers = [...new Set(draft.lines.map((l) => l.account))];
  const found = await Account.find({
    number: { $in: numbers },
    archived: false,
  }).select("number");
  const known = new Set(found.map((a) => a.number));
  const missing = numbers.filter((n) => !known.has(n));
  if (missing.length > 0) {
    throw new LedgerError(
      "UNKNOWN_ACCOUNT",
      `Unknown or archived account(s): ${missing.join(", ")}`,
    );
  }

  const year = draft.date.getFullYear();
  const fy = await ensureFiscalYear(year);
  if (fy.status === "closed") {
    throw new LedgerError("YEAR_CLOSED", `Fiscal year ${year} is closed`);
  }

  if (
    draft.source.refId &&
    (await findActiveBySource(draft.source.kind, draft.source.refId))
  ) {
    throw new LedgerError(
      "DUPLICATE",
      `Already posted: ${draft.source.kind} ${draft.source.refId}`,
    );
  }

  const entryNumber = await allocateEntryNumber(year);
  try {
    return await JournalEntry.create({
      ...draft,
      fiscalYear: year,
      entryNumber,
      active: true,
    });
  } catch (err) {
    const e = err as { code?: number; keyPattern?: Record<string, unknown> };
    if (e.code === 11000 && e.keyPattern && "source.kind" in e.keyPattern) {
      throw new LedgerError(
        "DUPLICATE",
        `Already posted: ${draft.source.kind} ${draft.source.refId}`,
      );
    }
    throw err;
  }
}

/** Idempotent post for automatic sources: returns the active entry if one exists. */
export async function postOnce(draft: EntryDraft) {
  if (draft.source.refId) {
    const existing = await findActiveBySource(
      draft.source.kind,
      draft.source.refId,
    );
    if (existing) return { entry: existing, created: false };
  }
  try {
    return { entry: await post(draft), created: true };
  } catch (err) {
    if (
      err instanceof LedgerError &&
      err.code === "DUPLICATE" &&
      draft.source.refId
    ) {
      const existing = await findActiveBySource(
        draft.source.kind,
        draft.source.refId,
      );
      if (existing) return { entry: existing, created: false };
    }
    throw err;
  }
}

/** GoBD correction: post the mirror entry and retire the original. */
export async function reverse(
  entryId: string,
  opts: { reason: string; createdBy: string; date?: Date },
) {
  const original = await JournalEntry.findById(entryId);
  if (!original) throw new LedgerError("NOT_FOUND", "Journal entry not found");
  if (original.source?.kind === "reversal") {
    throw new LedgerError(
      "NOT_REVERSIBLE",
      "A reversal cannot be reversed; post the entry again",
    );
  }
  if (!original.active || original.reversedBy) {
    throw new LedgerError(
      "ALREADY_REVERSED",
      `${original.entryNumber} is already reversed`,
    );
  }

  const existing = await findActiveBySource("reversal", String(original._id));
  const reversal =
    existing ??
    (await post({
      date: opts.date ?? new Date(),
      text: `Storno ${original.entryNumber}: ${opts.reason}`,
      lines: reversalLines(original.lines),
      source: { kind: "reversal", refId: String(original._id) },
      createdBy: opts.createdBy,
      reverses: original._id,
    }));

  original.active = false;
  original.reversedBy = reversal._id;
  await original.save();
  return { original, reversal };
}
