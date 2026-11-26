# 2026-11-26 — Receipt review: parser, preview, floating menu, account hint

## Problem

A Porkbun domain receipt was read with a ZIP code (`80538`) as €80,538 VAT, no
date (`Date Paid:` did not match), no expense account, and a foreign-currency
marker. The review row offered no way to see the document, the secondary
actions expanded inside the card and pushed the table open, and there was no
help choosing an account.

## Solution

- **Parser:** VAT now requires a currency-marked or decimal amount *after* the
  label, so a trailing `VAT:` on an address line no longer reads the ZIP.
  Receipt dates accept `Date Paid:` / `Date issued:` per line, while `Due date`,
  `Zahlbar`, `Payment date` and `Updated:` are skipped.
- **Preview:** a `Vorschau` action opens a modal with the PDF served from our own
  origin through `claims.preview` (base64 from Drive). Google's viewer shows a
  cookie-consent wall inside an iframe, so the Drive URL is only a fallback link;
  manual receipts without a Drive file show a hint.
- **Actions menu:** rendered in a portal at `document.body` with fixed
  positioning, so it never clips inside the card and never resizes the table;
  closes on Escape, outside click and scroll.
- **Account hint:** `suggestReviewAccount` offers the account from earlier
  booked claims, then an admin's booking rule, then `6837` for a known digital
  vendor. It is review-only: the admin must click to apply it, and it is not
  used by intake auto-booking.

## Files changed

- `src/server/lib/bills/parseBill.ts`, `src/server/lib/expenses/claimFields.ts`
- `src/server/lib/expenses/suggestAccount.ts`, `src/server/routers/expenses.ts`
- `src/client/components/ClaimMenu.tsx` (new), `ClaimsSection.tsx`, `ClaimCorrectDialog.tsx`
- `src/client/index.css`, `src/client/i18n/{de,en}.ts`
- Tests: `parseBill.test.ts`, `claimFields.test.ts`, `suggestReviewAccount.test.ts` (new), `ClaimMenu.test.tsx` (new), `expensesSection.test.tsx`

## Verification commands

`npm run lint && npm run typecheck && npm run typecheck:server && npm test -- --maxWorkers=2`
— all green (112 files, 998 tests).

## Success criteria / known issues

- A re-import of the Porkbun receipt now stores `date = 2026-11-18`,
  `vatCents = null`, `grossCents = 510` (USD), `currency = 'other'`.
- Foreign-currency claims still need a human decision: booking posts the stated
  figure as EUR cents, so an EUR equivalent must be entered by hand if one is
  needed. No exchange rate is guessed.
