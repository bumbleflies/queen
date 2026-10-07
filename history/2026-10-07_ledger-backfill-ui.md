# 2026-10-07 — Ledger backfill UI

## Problem

`admin.ledgerBackfill` existed only as a tRPC mutation with no client UI. On production the journal stayed empty after the Sheet import (the import writes invoices without ledger postings by design, and the automatic hooks only fire on `markSent`/`cancel`/`markPaid`/assign) — the only repair path required hand-crafted API calls.

## Solution

A backfill section on the **Buchhaltung** page (`/ledger`), bound to the selected fiscal year:

- **Prüfen** runs `admin.ledgerBackfill {year, dryRun: true}` and renders counts (invoices / credit notes / payments) plus the `skipped` list with reasons. Nothing is written.
- **Fehlende einbuchen** asks for confirmation, then runs with `dryRun: false`, invalidates the ledger queries and shows a toast. The report renders the same way.

New i18n keys `ledger.backfill.*` in both `de.ts` (source) and `en.ts`.

## Main files

- `src/client/pages/LedgerPage.tsx` (`BackfillSection`)
- `src/client/i18n/{de,en}.ts`
- `src/client/__tests__/ledger-backfill.test.tsx` (new: dry-run display, confirmed apply with `dryRun: false` + invalidation, dismissed confirm sends nothing)
- `src/client/__tests__/ledger-i18n.test.tsx` (mock extended with `admin.ledgerBackfill`)

## Deployment results

- Merged to `master` (PR #46). Released in `queen-v0.15.0` (release PR #47).
- servyy-test: ansible finance converge + `docker compose pull/up queen`; container healthy, `/health` 200, served bundle contains the backfill UI.
- Production (queen.bumbleflies.de): same procedure; container healthy on the `0.15.0` image, `/health` 200, served bundle contains the backfill UI.
- Note: the compose role does not pull `:latest` on its own (`state: present` only converges); the image pull + recreate was run via ansible explicitly, queen service only.

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test   # 47 files, 329 tests
```

On an environment, in this order:

1. Enter the opening entry in the UI if not present yet (never put figures in git).
2. Prüfen per year and review the skipped list (imported-paid invoices without payment date are booked manually; Sheet cancellations without a Stornorechnung need a decision).
3. Fehlende einbuchen per year; the Saldenliste must show Soll = Haben.

## Success criteria

- A dry run never writes; the apply path always confirms first.
- Every issued invoice, credit note and payment of the year appears in the journal exactly once after apply.
- Skipped items stay visible with their reason instead of failing silently.

## Known issues

- No per-year batch run: each fiscal year is checked/applied separately.
- The section does not auto-refresh the fiscal-year dropdown after the first posting (a reload picks it up).
