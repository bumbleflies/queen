# 2026-10-22 — Receipt-first booking and learned rules

Spec: [`docs/plans/2026-10-22-receipt-first-booking.md`](../docs/plans/2026-10-22-receipt-first-booking.md).

## Problem

The inbox only read receipts for rows that had *no* rule suggestion. Rule rows arrived pre-classified
but without their document, so the booking had to be re-opened to attach the receipt. And a rule,
once written, never followed the actual bookings: every row the owner corrected stayed a manual
correction, and the receipt's figures were ignored whenever a rule existed — even when they
contradicted it.

## Solution

- **Every confirmed booking teaches a rule.** `bookBankTransaction` learns after a successful `post`,
  so single, bulk, receipt-based and automatic bookings all teach. Key order: normalised IBAN →
  counterparty name → purpose prefix (`ruleLearning.ts`, cut before a URL or a six-digit number run,
  max 40 chars). The rule that already matched the row (same `suggest()` logic) is extended instead of
  duplicated; `Supplier.origin`/`learnedAt` mark learned rules. Split bookings, incoming payments and
  collective reimbursements (receipt vendor ≠ bank counterparty) teach nothing.
- **The `rememberRule` checkbox is gone.** Remembering is the default. A non-admin booking against an
  `autoBook` rule books normally and leaves that rule untouched instead of failing with `FORBIDDEN`.
- **Learned rules only match outgoing rows.** An incoming payment is matched to an invoice, not
  classifiable by a learned expense rule; manual rules keep matching both directions.
- **Receipts are read for every open outgoing row** with a clear candidate — rule-classified or not —
  25 per run (`QUEEN_RECEIPTS_PER_RUN` overrides). New on-demand action `bookings.readReceiptsNow`,
  behind "Alle Belege jetzt lesen" in the header menu, reads the year's rows with the caller's Drive.
  Per-file readings store the Drive `link`.
- **The matched receipt set is attached on booking** (`attachMatchedReceipt`) when the caller passed no
  receipt, so rule, bulk and automatic bookings carry their documents.
- **Conflict instead of silent trust.** When a matched receipt disagrees with the rule/history
  suggestion (`suggestionConflict`: account, VAT rate, mode or split shape), the suggestion carries
  `conflict`. The row renders `Regel ≠ Beleg` and offers "Prüfen" instead of "Buchen"; `bookBulk`,
  `isAutoBookable` and therefore auto booking refuse the row; the dialog asks "Regel übernehmen" or
  "Beleg übernehmen" and books the chosen side (the receipt side can be a split).
- **Rules UI:** learned rules carry a `gelernt` badge with the date; the prefilled "Regel anlegen"
  button uses the same purpose prefix as learning.

## Files changed

- `src/server/lib/accounting/ruleLearning.ts` + tests — `learningKey`, `purposePrefix`.
- `src/server/lib/accounting/receiptReading.ts` + tests — `suggestionConflict`, conflict-aware
  `suggestForTx`.
- `src/server/lib/accounting/suggest.ts` — `Suggestion.conflict`, `SuggestSupplier.origin`, learned
  rules skip incoming rows.
- `src/server/lib/accounting/bankBooking.ts` — learning, matched-rule lookup, receipt attach.
- `src/server/lib/accounting/autoBook.ts` — conflict-aware suggestion, refuses conflicts.
- `src/server/services/receiptReader.ts` — all open outgoing rows, priority queue, cap 25,
  `receiptsPerRun()`, Drive links, `{ read, available }`.
- `src/server/routers/bookings.ts` — `readReceiptsNow`, bulk conflict guard, `rememberRule` removed.
- `src/server/routers/suppliers.ts` — `origin`/`learnedAt` in `overview`.
- `src/server/models/{Supplier,BankTransaction}.ts` — `origin`/`learnedAt`, reading `link`.
- `src/client/pages/FinancePage.tsx`, `components/BookingDialog.tsx`, `components/RulesSection.tsx`,
  `i18n/{de,en}.ts` — conflict row and side chooser, read-all action, learned badge.
- `AGENTS.md` — receipt-reading and learning invariants.

## Verification

- Unit: learning keys (IBAN/name/purpose, incoming, split, vendor contradiction), conflict detection
  (account, rate, mode, split, agreeing sides), auto-book refusal on conflict.
- Router (DB): a first booking creates a learned rule and the next row gets it; the rule that matched
  is extended, not duplicated; incoming and contradictory-vendor bookings teach nothing; the matched
  receipt set is attached with its Drive link; non-admin booking on an `autoBook` rule books and leaves
  the rule; `readReceiptsNow` reads rule rows, caps per run, skips incoming rows and matched rows and
  reports unavailability; `bookBulk` skips conflict rows with an error.
- Cron: receipt reading now includes rule rows (cap via env), ordering by priority and retry age.
- UI: conflict row shows `Regel ≠ Beleg` with "Prüfen", dialog books either side, learned badge,
  menu action reads all receipts.
- `npx oxlint`, `tsc --noEmit`, `tsc -p tsconfig.server.json --noEmit`, 618 tests green.

## Success criteria

- Every row with a receipt arrives as a complete, one-click bookable suggestion; no `rememberRule`
  tick anywhere.
- The next comparable transfer is pre-classified from what the owner confirmed last time.
- Nothing is booked silently, and a rule that contradicts its receipt needs one decision rather than
  producing a wrong posting.

## Known issues

- History suggestions are effectively superseded by learned rules; they remain as a fallback for
  archived rules and rows learning skipped.
- A learned rule is never demoted automatically. Archiving it and booking the row again teaches a new
  rule.
