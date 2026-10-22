# 2026-10-22 — Multi-receipt reading

Spec for reading a bank transaction that is backed by **several receipts**. Extends
[`2026-10-22-booking-automation.md`](2026-10-22-booking-automation.md) (part E).

## Problem

A transaction like "2x Spesen — Chris — Augustiner — 08/2026, 54,60 €" has two PDFs in the
Drive folder (`… 08/2026.pdf` and `… 08_2/2026.pdf`), 25,20 € each. The reader picks a single
"strong" candidate, reads it, and then rejects the suggestion because the receipt total is not
the bank amount. The row shows the mismatch hint and nothing can be booked from the receipts,
even though the two files together are exactly the transaction.

## Design

**Candidates.** `receiptCandidates(tx, files, supplierName, max = 3)`: the attached receipt first
(when there is one), then the ranked Drive candidates that pass the existing `strongReceipt`
threshold (score ≥ 5), de-duplicated by Drive id, capped at 3. Ranking is unchanged
(`rankReceipts`: Verwendungszweck, amount tokens, date, name tokens).

**Siblings.** The score alone cannot find the second file: in the real case the transaction
description names `… 08/2026.pdf` (Verwendungszweck +5) while `… 08_2/2026.pdf` scores 1 (only
the supplier token). So the candidate set is widened by **sibling names**: the seed's file name
lower-cased with a copy marker (`_2`, `-2`, … directly after the month) removed. That is exactly
the `08/2026` + `08_2/2026` pattern, and `09/2026` stays a different month, so it cannot pull in
another expense.

**Combination.** Pure `matchReceiptSet(entries, amountCents, hints)` over the readings that
were parsed successfully. A set qualifies when

- its `totalCents` add up **exactly** to the transaction amount,
- every reading has the same `reverseCharge` flag (mixed VAT treatment is ambiguous),
- vendors agree with each other **or** with a hint (transaction counterparty / suggestion
  supplier), compared case- and punctuation-insensitively; an empty vendor is "unknown" and
  does not block.

Smallest set wins, ties go to the higher-ranked files. Lines are merged per `account + vatRate`
(`mergeReceiptReadings`), so the booking is still one entry with the VAT of each receipt.

**Storage.** `BankTransaction.receiptReadings[]` holds one entry per file read (`driveFileId`,
`fileName`, `status`, `reading`, `model`, `readAt`, `error`) and `receiptMatch` holds the
winning set (`driveFileIds[]`, merged `reading`, `model`, `readAt`). Readings are a cache, not
accounting data: the old singular `receiptReading` stays in the schema, is no longer written,
and is still honoured for rows that have not been re-read yet. A changed attachment invalidates
`receiptMatch` in the router, exactly as it invalidates the old reading today.

**Flow.** `readTxReceipts()` replaces `readTxReceipt()`: per file, an `ok`/`noText` reading is
reused unless `force`, `failed` files are re-read; after each new reading the combination is
re-evaluated and the loop stops as soon as a set matches. The nightly reconcile keeps its
10-transactions-per-run cap and selects rows without a match whose candidates are not all
final. Only the PDF text layer plus the account list is sent (unchanged, masked).

**UI.** Matched: "aus 2 Belegen gelesen: Augustiner Keller" (singular keeps today's wording).
Not matched but read: "2 Belege gelesen: 25,20 € + 25,20 € = 50,40 € — Betrag passt nicht zum
Umsatz (54,60 €)"; a single file keeps the current sentence. Both strings in `de.ts` and
`en.ts`. Never auto-booked — receipts remain a suggestion only.

## Implementation tasks

1. `lib/accounting/receiptReading.ts`: `mergeReceiptReadings`, `normalizeVendor`,
   `matchReceiptSet` (+ unit tests, TDD).
2. `lib/accounting/receipts.ts`: `receiptCandidates` (+ unit tests).
3. `models/BankTransaction.ts`: `receiptReadings[]`, `receiptMatch`; legacy field kept.
4. `services/receiptReader.ts`: `readTxReceipts`, cron selection, persistence.
5. `routers/bookings.ts`: `readingState` returns the per-file list and the matched reading;
   `readReceipt` uses the new reader.
6. `client/pages/FinancePage.tsx` + `i18n/{de,en}.ts`: multi-file labels; tests.
7. `AGENTS.md` invariant + `history/` entry.
