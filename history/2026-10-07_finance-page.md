# 2026-10-07 — Finanzen page: one nav tab, one transaction stream

Part of the accounting rollout; supersedes three nav entries (Bankabgleich `/bank`, Buchen `/bookings`, Buchhaltung `/ledger`) with a single **Finanzen** page on `/finance`.

## Problem

The three finance views overlapped in data and workflow (all operate on the same `BankTransaction` collection), split one reconciliation flow across round trips between pages, and pushed the mobile tab bar to 7 items. Two nav badges (`bank.list` unmatched vs `bookings.stats.open`) counted differently — `bank.list` was incoming-only and ignored `ignored: open` txs while the Buchen inbox kept them bookable.

## Solution

- **Server:** one state-aware stream query `bookings.stream({ year })` returns every bank tx of a year with `state: 'invoice' | 'booked' | 'open'` (precedence: invoice-matched / bank-covered > open; `ignored` stays a flag on open rows — an ignored deposit remains bookable, as codified by the old inbox test), joined with invoice summary, coverage entry and supplier suggestion. Mutations (`bank.assign/unassign/ignore/unignore/syncNow`, `bookings.*`, `ledger.*`, `reconcile.*`) are unchanged.
- **Client:** new `FinancePage` (`/finance`):
  - Status banner: reconcile run (badge, last run, counts) + Konto-1800-vs-Firefly balance/diff + open/missing-receipt counts.
  - Header: fiscal year select, Jetzt synchronisieren, Bank vollständig neu einlesen (inline confirm card), Abgleich starten, Buchung erfassen.
  - One transaction stream (latest first) with state chips (Offen/Erledigt/Ignoriert) + direction chips (Alle/Eingänge/Ausgänge); ignored rows hidden outside dedicated filters; per-state row UIs reusing the invoice-suggestion cards, `BookingDialog` and bulk confirm.
  - Journal zone (Journal/Saldenliste/Kontoblatt, entry form, backfill) on the same page behind the "Journal (SKR04)" toggle chip — extracted as components.
- **Extracted components:** `EntryForm`, `BackfillSection`, `LedgerViews` (`src/client/components/`), payment suggestion logic → `src/client/lib/paymentSuggest.ts`. `BankPage.tsx`, `BookingsPage.tsx` and `LedgerPage.tsx` deleted.
- **Nav:** one item with one badge fed by `bookings.stats.open` (both directions); mobile tab bar 7 → 5 items. Legacy routes `/bank`, `/bookings`, `/ledger` redirect to `/finance`; Dashboard KPIs, InvoiceDetail and Settings links repointed.

## Main files

- `src/server/routers/bookings.ts` (`stream`), `src/server/routers/__tests__/bookings.test.ts`
- `src/client/pages/FinancePage.tsx`, `src/client/components/{EntryForm,BackfillSection,LedgerViews}.tsx`, `src/client/lib/paymentSuggest.ts`
- `src/client/main.tsx`, `src/client/components/Navigation.tsx`, `src/client/i18n/{de,en}.ts`
- `src/client/pages/{DashboardPage,InvoiceDetailPage,SettingsPage}.tsx` (repointed links; dashboard now uses `bookings.stats`)
- Tests: `financePage.test.tsx` (stream/filters/booking/bulk/done/ignored/journal); deleted `bookings.test.tsx`, `ledger-backfill.test.tsx`, `ledger-i18n.test.tsx` (cases migrated)

## Deployment results

- Merged to `master` via PR #57; released with the next `queen-v*` tag by release-please.

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

Note: the dev host is Alpine where the shipped mongodb-memory-server binary (glibc) cannot run, so DB-backed tests skip locally; `pr-tests` CI exercises them on ubuntu.

## Success criteria

- One nav tab; `/bank`, `/bookings`, `/ledger` redirect; old bookmarks keep working.
- Every GLS transaction of the selected year appears once, in one list, with the right state and the right actions (assign invoice / book ledger / unassign / unbook / ignore / restore).
- Journal, Saldenliste, Kontoblatt, Buchung erfassen and backfill remain reachable on the same page.
- Trial balance still balances; 1800 still matches Firefly; reconcile cron untouched.

## Known issues

- The stream loads a year at once (no pagination); fine at current GLS volumes, revisit if a year exceeds a few thousand txs.
- Settings/export links keep their old wording of related features.
