# Inbox shows the attached receipt (bill PDF) instead of "no receipt found"

## Problem
A bank row whose linked bill had its filed PDF attached as receipt (`rematchBills`, #218) still showed "no receipt found". The receipt reading had used that PDF. The inbox hint `bookings.receiptMatches` ranked Drive file names only and ignored `tx.receipt`. Bill PDFs carry vendor file names without a date or amount, so the ranking never found them. One-click booking sent the Drive guess, and the booking dialog preselected it, both ignoring the attached file.

## Solution
- `bookings.receiptMatches` returns the row's attached receipt first. It works without a Drive listing, too (`available` still reflects Drive). Drive ranking only fills rows without one.
- The inbox row adds "(from the bill inbox)" when the receipt is the linked bill's file.
- `BookingDialog` preselects the attached receipt before the strongest Drive match.

## Files changed
- `src/server/routers/bookings.ts`, `src/server/routers/__tests__/bookings.test.ts`
- `src/client/pages/FinancePage.tsx`, `src/client/components/BookingDialog.tsx`
- `src/client/i18n/de.ts`, `src/client/i18n/en.ts`

## Verification
- `npm run lint && npm run typecheck && npm run typecheck:server && npm test` (706 tests green).
- After deploy: the inbox row with a linked bill shows "Receipt: <bill file> (from the bill inbox)".

## Known issues
- A bill parsed before #220 can show a wrong gross. Re-read it on the Bills tab after deploying ≥ 0.30.2.
