# 2026-10-22 — Multi-receipt reading

Spec: [`docs/plans/2026-10-22-multi-receipt-reading.md`](../docs/plans/2026-10-22-multi-receipt-reading.md).

## Problem

"2x Spesen — Chris — Augustiner — 08/2026" (54,60 €) has two receipts in the Drive folder:
`… 08/2026.pdf` and `… 08_2/2026.pdf`, 25,20 € each. The reader read one file and rejected the
suggestion, because a single receipt is not the bank amount. The row showed the amount-mismatch
hint forever and nothing could be booked from the receipts.

The second file is invisible to the ranking: the transaction's Verwendungszweck names
`… 08/2026.pdf` (+5), while `… 08_2/2026.pdf` only matches the supplier token (+1). No score
threshold can find it.

## Solution

- **Candidates** (`receiptCandidates`): attached receipt → clear Drive match (score ≥ 5) → its
  siblings (same file name with a `_2`/`-2` copy marker removed) → further clear matches, at most 3.
- **Combination** (`matchReceiptSet`): the smallest set whose totals add up exactly to the bank
  amount, with the same `reverseCharge` flag and vendors that agree with each other or with the
  transaction (normalised; empty vendor = unknown). Lines merge per account + VAT rate, so the
  booking stays one entry.
- **Storage**: `BankTransaction.receiptReadings[]` (per file) plus `receiptMatch` (the winning set).
  The legacy `receiptReading` is still honoured and removed on the next read.
- **Flow**: `readTxReceipts` reuses final readings, re-reads failed ones and stops as soon as a set
  matches. The daily reconcile still reads 10 transactions per run, retrying failed files first.
- **UI**: "aus 2 Belegen gelesen: …" when matched; when not, the row lists every receipt and the
  delta ("2 Belege gelesen: 25,20 € + 25,20 € = 50,40 € — Betrag passt nicht zum Umsatz (54,60 €)").

## Files changed

- `src/server/lib/accounting/receiptReading.ts` — `normalizeVendor`, `mergeReceiptReadings`,
  `matchReceiptSet`, `files` on the suggestion reading.
- `src/server/lib/accounting/receipts.ts` — `siblingKey`, `receiptCandidates`.
- `src/server/models/BankTransaction.ts` — `receiptReadings[]`, `receiptMatch`, legacy field.
- `src/server/services/receiptReader.ts` — `readTxReceipts`, cron selection, per-file cache.
- `src/server/routers/bookings.ts` — per-file reading state, multi candidates.
- `src/client/pages/FinancePage.tsx`, `BookingDialog.tsx`, `i18n/{de,en}.ts` — labels.
- `AGENTS.md` — receipt-reading invariant.

## Verification

- Unit: candidate seeding/siblings/cap, merge, subset search (1–3 files, vendor mismatch, mixed
  reverse charge, non-matching sums, smallest set).
- Router: two siblings 25,20 € + 25,20 € on a 50,40 € transaction → matched suggestion with
  `files: 2`, two reads only (the September sibling untouched), stored match; the 54,60 € case
  with two 25,20 € receipts → no suggestion, but both files listed in the row state.
- Cron: legacy failed readings are still retried with their old timestamp; sibling pairs are read.
- UI: "aus 2 Belegen gelesen: …" and the multi-file mismatch sentence.
- Full suite: 567 tests green, lint + both typechecks + build.
