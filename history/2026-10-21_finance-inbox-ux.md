# 2026-10-21 — Finanzen page: inbox you can work through

## Problem

Once booking rules existed, the Finanzen page still read badly:

- Status, direction and the two panel toggles were one row of identical chips. "Offen" and "Alle" were both highlighted, and Regeln opened above the table while Journal opened below it.
- A row's suggestion was a small grey line. The matched receipt wasn't visible at all, and checkboxes were silently disabled.
- A complete suggestion still needed the full dialog (three clicks).
- Daily work and maintenance (sync, reconcile, full reimport) shared the header.
- The status card was one dense line.
- Stornieren used `window.prompt`.
- Filters reset on reload.
- "Als Regel merken" defaulted to on.

A clickable mock (local only) was reviewed and approved before building.

## Solution

- **Tabs in the URL:** Offen, Erledigt, Ignoriert, Regeln and Journal (`?tab=…&dir=…`), each with a count. The direction filter is a small segmented switch under the tabs.
- **Summary bar:** open count, "{n} mit Vorschlag · {n} ohne Regel · {n} Rechnung zuordnen", bookings without receipt, and a ✓ or ⚠ for ledger 1800 vs. GLS.
- **Each row shows its outcome:**
  - **Green:** a complete suggestion (account, VAT, rule, matched receipt) with a one-click **Buchen** plus **Anpassen**.
  - **Amber:** "Keine Regel" with **Regel anlegen** (admin) and **Manuell buchen**.
  - **Blue:** invoice candidates with **Zuordnen**.
- **One-click Buchen** posts the suggestion together with the clear receipt match.
- **Undo instead of confirm:** single and bulk bookings show a toast with **Rückgängig** for 9 seconds. Undo goes through `bookings.unbook` with a fixed reason, so the journal keeps the entry plus a reversal (GoBD).
- **Bulk:** "Alle {n} Vorschläge buchen" works without ticking anything, and ticking narrows it to "{n} ausgewählte buchen". The toast reports how many got a receipt (`bookBulk` now returns `receipt` per row).
- **⋯ menu:** sync, reconcile, and the full reimport behind a confirmation dialog, plus the last reconcile run.
- **Erledigt:**
  - Stornieren opens a dialog that requires a reason.
  - "Beleg fehlt" offers **Beleg wählen** (a picker over `receipts.list`, saved through `setReceipt`).
- **Empty states:** "Alles gebucht ✓" when nothing is open, plus a filter-empty state with "Alle zeigen".
- **Rule dialog:** a live "Treffer in offenen Umsätzen: n" count, computed with the server's own `suggest()`.
- **Booking dialog:** "Als Regel merken" now defaults to off.
- **Server:** the new `bookings.receiptMatches({ year })` returns the clear receipt match per open row. Drive problems give `available: false` instead of an error.
- **Theme fix:** dark `.btn.honey` lost its honey background to `[data-theme='dark'] .btn`. It now keeps it, which affects every honey button in dark mode.

## Main files

- `src/client/pages/FinancePage.tsx`, `src/client/components/FinanceDialogs.tsx` (new), `src/client/components/{RulesSection,BookingDialog,Toast}.tsx`
- `src/client/index.css`, `src/client/i18n/{de,en}.ts`
- `src/server/routers/bookings.ts` (`receiptMatches`, `bookBulk` receipt flag)
- Tests: `financePage.test.tsx` (rewritten for the new flow), `bookings.test.ts`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

The local full suite needed `--no-file-parallelism` and a disk-backed `TMPDIR`. Under parallel load, `mongodb-memory-server` hit "Disk quota exceeded" on the `/tmp` tmpfs. Run serially, all 392 tests pass.

Checked in the running app (`npm run dev`) with made-up data:
- DE and EN, light and dark, and 390 px width with no horizontal overflow.
- One-click Buchen → toast → Rückgängig leaves the row open again, with entry and reversal in the journal.
- The ⋯ menu, bulk booking, the rule shortcut and the invoice row all work.

## Known issues

- Without a Drive folder, or when Drive fails, rows show no receipt line. Booking still works.
- The tabs scroll sideways on narrow screens.

## Deployment results

Pending.
