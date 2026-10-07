# 2026-10-07 — Accounting phase 1: ledger foundation

Spec: [`docs/plans/2026-10-07-accounting.md`](../docs/plans/2026-10-07-accounting.md). Plan: [`docs/plans/2026-10-07-accounting-phase1.md`](../docs/plans/2026-10-07-accounting-phase1.md). PR [#29](https://github.com/bumbleflies/queen/pull/29).

## Problem

queen knew about invoices and incoming payments. Everything else in the bookkeeping happened outside it: expenses, receipts, USt and the yearly closing. The closing (Bilanz/GuV/Kontennachweis for a Kleinstkapitalgesellschaft, SKR04) was assembled by hand from a tax tool plus a spreadsheet.

The goal is for queen to keep the books from 01.01.2026 as a double-entry ledger, and eventually to produce the prepared closing numbers and exports. That work is split into four phases; this is phase 1.

## Solution (phase 1)

- **SKR04 chart:** generic seed list in `lib/accounting/skr04.ts`. It is upserted at startup, and renamed accounts are left alone. The `accounts` router provides list, create and archive.
- **Posting rules** (`postingRules.ts`, pure functions):
  - An invoice books receivables against revenue and USt per VAT rate: 1200 against 4400/3806 (19%), 4300/3801 (7%) or 4110 (0%).
  - A credit note mirrors the original invoice's lines, so there is no one-cent drift.
  - A payment books bank against receivables (1800 against 1200).
- **Journal** (`ledger.ts`, `models/JournalEntry.ts`, `models/FiscalYear.ts`):
  - `post`, `postOnce` and `reverse` are the only write path.
  - Entry numbers are `YYYY-NNNNN`, gapless per fiscal year. Everything is validated before a number is allocated.
  - Closed fiscal years reject postings.
  - Entries cannot be changed. The model guards block updates and deletes, and a reversal is the only allowed state change (active → inactive plus `reversedBy`).
  - `reverse` can resume after a half-failure.
  - A partial unique index on active `source.kind` + `source.refId` makes automatic postings idempotent.
- **Automatic postings** (`ledgerHooks.ts`):
  - `markSent` and `cancel` post the invoice or credit note.
  - Bank assign and `markPaid` post the payment. Unassign posts a reversal.
  - A bank payment that arrives after a manual "mark paid" replaces that entry, so cash is not booked twice.
  - Each hook is wrapped in `safeLedger`, so a ledger error only logs and never breaks invoice or bank actions.
- **Backfill** (`admin.ledgerBackfill {year, dryRun=true}`):
  - Idempotently posts invoice, credit-note and payment entries that the hooks missed.
  - Lists, rather than guesses:
    - Sheet-imported paid invoices with no payment date
    - Sheet cancellations without a Stornorechnung
    - pre-year payments while no opening entry exists
- **Reports** (`balances.ts`): Summen- und Saldenliste and Kontoblatt with a running balance.
- **UI:** a new **Buchhaltung** page (`/ledger`, DE/EN) with Journal, Saldenliste, Kontoblatt and an entry form for manual entries and the opening entry (dated 01.01., one per year). Manual and opening entries can be stornoed; automatic entries are corrected at their source.
- **Timezone:** the server runs with `TZ=Europe/Berlin` (Dockerfile), so fiscal years and dates are German business dates.

## Main files

- `src/server/lib/accounting/{skr04,seedAccounts,postingRules,ledger,balances,ledgerHooks,backfill}.ts`
- `src/server/models/{Account,JournalEntry,FiscalYear}.ts`
- `src/server/routers/{accounts,ledger}.ts`
- `src/server/routers/{invoices,admin,bank}.ts` and `src/server/lib/reconcile.ts` (hooks)
- `src/client/pages/LedgerPage.tsx`
- `src/client/lib/entryForm.ts`
- `src/client/i18n/{de,en}.ts`
- `Dockerfile`, `AGENTS.md`

## Process

The work was done task by task with a fresh implementer per task and a spec-plus-quality review after each one (8 tasks).

- **Task-level rounds:** Tasks 3, 5, 6 and 7 needed fix rounds: resumable reversal, the persisted-state guard, numbering validation, clean test output, the backfill gaps, and the timezone and year reset.
- **Final review:** the whole-branch review found three integration bugs, which were all fixed and re-reviewed: cash booked twice after "mark paid", revenue booked for Sheet-cancelled invoices, and the hook and backfill treating pre-year payments differently.
- **Before the PR:** current `master` was merged in (i18n, dark mode) and the page was translated.

## Deployment results

- Merged to `master` (`67f8cc4`). Released in `queen-v0.10.0`.
- Not yet deployed to servyy-test at the time of writing.

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test   # 40 files, 281 tests at merge
NODE_ENV=development npx vitest run src/server/routers/__tests__/ledger.test.ts --silent=false   # DB tests skip without NODE_ENV
```

On servyy-test, in this order:

1. TZ check in the container: `node -e 'console.log(new Date().getTimezoneOffset())'` should print `-120` in CEST and `-60` in CET. Also check that the compose file does not override `TZ`.
2. Enter the opening entry for 2026 from the 2025 closing in the UI (Buchhaltung → Buchung erfassen → Eröffnungsbilanz). Never put these figures in git. If an account is missing from the seed (for example 3095), add it via `accounts.create`.
3. Run `admin.ledgerBackfill({ year: 2026 })` as a dry run and review `skipped`.
4. Run it with `dryRun: false`.
5. The Saldenliste must show Soll = Haben, and 1800 must be plausible against the Firefly GLS balance.

## Success criteria

- Every issued invoice, credit note and payment in 2026 appears in the journal exactly once.
- The trial balance always balances.
- No entry is ever edited or deleted.

## Known issues

- When a bank payment replaces a "mark paid" entry, the three ledger steps are not atomic. If one fails it is only logged, and backfill repairs open years only. The partial-payment variant of this path is untested.
- The hook books a payment on a pre-year invoice immediately, while backfill waits for the opening entry. Until the opening entry exists, 1200 can temporarily show a credit balance.
- FY 2025 is not seeded as `closed`. A backdated 2025 invoice would create an open FY 2025.
- Numbering can still leave a gap if the DB insert fails after a number is allocated (a lost race or a DB error).
- There is no UI for creating accounts, and some bank error messages are still English.
- The mobile layout of the Buchhaltung page has not been visually verified.

## Future enhancements (next phases, see spec)

2. **Expenses:** sync withdrawals from Firefly, suppliers (Kreditor 70000+) with booking rules, a Buchen page, and Drive receipts.
3. **USt:** VA figures per period under Sollversteuerung. Quarterly VAs are likely due for 2026, because the 2025 Zahllast exceeded the exemption threshold.
4. **Jahresabschluss:** checks, tax provisions (KSt/Soli/GewSt), the §5a GmbHG Rücklage, closing and lock, and PDF/DATEV/SuSa exports.
