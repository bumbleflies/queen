# 2026-11-26 — Honest claim review feedback and compact actions

## Problem

A re-imported Porkbun receipt had a missing expense account, but booking only
said `Betrag oder Konto fehlt`. Worse, the row still claimed "input VAT
deductible" from the raw PDF read while the check column said the VAT rate was
unknown, and four uneven buttons filled a narrow table cell. Repeated clicks
stacked identical red toasts.

## Solution

- `bookExpenseClaim` now names the missing field(s): `Betrag fehlt …`,
  `Aufwandskonto fehlt …` or `Betrag und Aufwandskonto fehlen …`.
- Book is disabled only for those two hard blockers, with the reason in the
  button title; soft review reasons remain manually bookable.
- The VAT label uses the confidence result, so an unknown rate never shows
  "deductible".
- Actions are one primary Book (or "Korrigieren & neu buchen") plus a compact
  `Aktionen` menu holding Correct / Re-import / Ignore.
- Repeated identical toasts replace each other instead of stacking.

## Files changed

- `src/server/lib/accounting/claimBooking.ts` + test
- `src/client/components/ClaimsSection.tsx` + component test
- `src/client/components/Toast.tsx` + new test
- `src/client/i18n/{de,en}.ts`, `src/client/index.css`

## Verification commands

`npm run lint && npm run typecheck && npm run typecheck:server && npm test -- --maxWorkers=2`
— all green (110 files, 986 tests).

## Success criteria / known issues

- The error names the field; Book cannot be clicked when booking is impossible.
- The account still has to be chosen by a human — no account is guessed from a
  vendor name. The Porkbun claim remains `received` until corrected and booked.
