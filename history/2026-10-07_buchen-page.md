# 2026-10-07 — Buchen page: unified incoming/outgoing ledger + ledger cleanup

Spec: [`docs/plans/2026-10-07-accounting-phase2.md`](../docs/plans/2026-10-07-accounting-phase2.md), Task 6 (Buchen page; suppliers panel Task 7 stays out).

## Problem

The Bankabgleich page lists incoming payments only (`direction != 'out'`), so the far larger share of GLS traffic — withdrawals — was invisible anywhere in queen. And `admin.ledgerBackfill` needed two always-visible buttons plus a third bank-reimport button on the ledger page for what is conceptually one import.

## Solution

- **Buchen page (`/bookings`, nav entry with open-count badge):** one unified inbox of unbooked transactions per year — incoming and outgoing together, signed amounts, direction filter chips (Alle/Eingänge/Ausgänge).
  - Booking dialog per row (account datalist, VAT, normal/vatOnly, supplier, receipt, live Soll/Haben preview, remember-as-rule).
  - Bulk confirm for rows with suggestions (per-row failures don't stop the rest).
  - Booked tab with entry numbers, line summaries, receipt state and reverse-with-reason.
  - Balance banner: Konto 1800 per ledger vs GLS per Firefly + difference, open/missing-receipt counts.
  - Bankabgleich is unchanged (incoming invoice matching).
- **Ledger cleanup:** backfill is one guided flow (Prüfen → report → Einbuchen (n) appears only when something is postable). "Bank vollständig neu einlesen" moved to the Bank page (`bank.fullSync*` keys; dead `ledger.resync*` keys removed).
- **Skipped reasons Germanized** (`backfill.ts`: imported-paid now "als bezahlt importiert ohne Zahlungsdatum — Zahlung manuell buchen").

## Main files

- `src/client/pages/BookingsPage.tsx`, `src/client/components/BookingDialog.tsx`, `src/client/lib/bookingPreview.ts`
- `src/client/main.tsx` (route), `src/client/components/Navigation.tsx` (item + badge), `src/client/i18n/{de,en}.ts`
- `src/client/pages/{LedgerPage,BankPage}.tsx`, `src/server/lib/accounting/backfill.ts`
- Tests: `bookings.test.tsx`, `bookingPreview.test.ts`; updated `ledger-backfill.test.tsx`, `i18n-rollout.test.tsx`

## Deployment results

- Merged to `master` (PR #52, after merging `origin/master` for the parallel resync-dialog fix #50; resync now lives on the Bank page as an inline card dialog). Released in `queen-v0.16.0` (release PR #53).
- servyy-test: ansible finance converge + explicit queen pull/recreate (compose `state: present` doesn't pull `:latest` on its own); healthy, `/health` 200, served bundle contains the Buchen UI.
- Production: same procedure; healthy on the `0.16.0` build, `/health` 200, served bundle contains the Buchen UI.
- 2026 ledger coverage after rollout: all 9 invoice entries posted via backfill (2026-00001…00009); payments 0 (3 imported-paid without date correctly skipped, no incoming bank payments matched); outgoing await booking decisions in `/bookings`.

## Follow-up fixes

- **Firefly journal-id parsing (`v0.16.1`, PR #55):** every fetched row upserted as `unknown:N` and overwrote the last, so 26 fetched rows left 1 in the DB. Rows are now keyed by the split-level journal id. Production needed a full resync plus removal of the orphaned `unknown:0` row.
- **Recognition (`v0.17.0`, PR #57):** labeled `RNR`/`KD` references are parsed server- and client-side (labels first, so EREF digit blocks can't shadow them); Bankabgleich also suggests paid invoices without payments. Both verified on servyy-test and production (`/health` 200).

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

## Success criteria

- 2026 inbox lists every GLS transaction of the year, incoming and outgoing.
- Each books exactly once (idempotent `postOnce` + coverage map); failures are per-row and visible.
- Trial balance still balances; 1800 matches Firefly.

## Known issues

- No supplier create/edit UI (Task 7); booking works with existing suppliers or none.
- Receipt ranking needs `QUEEN_RECEIPTS_FOLDER_ID`; without it the dialog shows "Belege nicht abrufbar" and booking still works.
