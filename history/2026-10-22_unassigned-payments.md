# 2026-10-22 — Invoices imported as paid, but without a bank payment

## Problem

A LeagueSphere customer paid an invoice issued in the Sheet — the transfer showed
up in the GLS stream with a correct `Kundennr-Rechnungsnr` reference, but the
Finanzen inbox showed it as "Keine Regel" and offered no way to match it.

Three things combined:

1. **The row had never been matched.** A manual full resync (`bank.syncNow`) imported
   it (68 bookings) but never ran matching; that only happened in the nightly
   `0 30 7 * * *` job or via "Abgleich starten". The sync run even recorded a
   `ReconcileRun` with `fetched: 68` — looking like a reconcile that had found
   nothing.
2. **The invoice was invisible to the inbox.** It was imported from the Sheet as
   paid (`importedPaid: true`, `status: 'paid'`, no `payments` entry). The inbox
   builds its invoice candidates from `reports.openItems`, which returned
   `status: 'sent'` only — so the invoice could not be suggested, although the
   server's `reconcileBankTransaction` would have matched it (it accepts `paid`).
3. **The message blamed the reference.** `suggestionsFor` only replaced its default
   reason when a candidate invoice was found, so a *correctly parsed* reference
   read "Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt."

The worst part was the offered action: "Manuell buchen" on an incoming row posts
Bank ↔ Erlöse. That would have double-booked the revenue against the already
posted invoice entry and left the receivable open for good. `admin.ledgerBackfill`
already reported the situation as "als bezahlt importiert ohne Zahlungsdatum —
Zahlung manuell buchen"; there was just no way to do it from the inbox.

## Solution

**The invoices are matchable everywhere** (`src/server/lib/invoiceOpen.ts`):

- `paymentMissing(inv)` — imported as paid, no payment recorded, not a credit note.
- `matchableInvoiceFilter(from)` — `sent` invoices plus those `paymentMissing` ones
  whose `invoiceDate` is inside the earliest **non-closed fiscal year**. Older
  receivables are covered by the opening entry and must not be posted into a closed
  year, so they stay out (on the live data that turned 12 candidates into 1).
  No fiscal year configured → 1 January of the current year; all years closed →
  nothing to match.

`reports.openItems` now returns those rows with `paymentMissing: true` and
`overdue: false`, and keeps their money out of `totalOpenCents` /
`totalOverdueCents`: the money arrived, only its bank payment is unknown, so they
are not receivables. They have their own `countPaymentMissing` /
`totalPaymentMissingCents`.

Where they show up:

- **Inbox** — a normal invoice suggestion with **Zuordnen**, labelled
  "als bezahlt importiert · Bankzahlung nicht zugeordnet" (DE/EN).
- **Berichte** — the row keeps the list, gets a "Zahlung nicht zugeordnet" badge and
  a line under the total: "nicht in den offenen Posten: {amount} ohne
  Zahlungszuordnung ({n})".
- **Dashboard** — filtered out of the open-items table, the aging chart and the
  expected-receipts chart; instead a "Zu erledigen" task names them and links to
  Berichte.
- **Rechnungsdetail** — a hint chip plus **Zahlung zuordnen** (previously `paid` was
  read-only), and `invoiceActionKeys(status, kind, paymentMissing)`.

`bank.syncNow` now runs `reconcilePendingTransactions()` after the import and stores
`matched`/`partial`/`unmatched` on the run, so a manual sync (or full resync) can no
longer leave referenced payments dangling until the next morning; the toast reports
how many were assigned.

The misleading reason is gone: a parsed reference without a matching invoice reads
"Verwendungszweck {nr} erkannt, aber keine passende Rechnung gefunden."

The dead duplicate `src/client/lib/suggestions.ts` (an older copy of
`paymentSuggest.ts`, only referenced by its own test) was removed and its cases
moved to `paymentSuggest.test.ts`.

## Main files

- `src/server/lib/invoiceOpen.ts` (new), `src/server/routers/reports.ts`,
  `src/server/routers/bank.ts` (`syncNow`)
- `src/client/lib/paymentSuggest.ts`, `src/client/lib/dashboard.ts`,
  `src/client/lib/format.ts` (`paymentMissing`), `src/client/components/InvoiceActions.tsx`
- `src/client/pages/{FinancePage,ReportsPage,DashboardPage,InvoiceDetailPage}.tsx`
- `src/client/i18n/{de,en}.ts`
- Tests: `__tests__/reports.test.ts` (new), `bank.test.ts` (syncNow matching),
  `paymentSuggest.test.ts` (new), `dashboard.test.ts`, `invoiceActions.test.tsx`,
  `financePage.test.tsx`, `format.test.ts`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

`npm test` in the dev container cannot start `mongodb-memory-server` (Alpine), so the
DB suites skip and `ledger.test.ts` times out in `beforeEach`. Verified against a
throwaway `mongo:8` container (temporary, dropped afterwards) with
`MONGO_URI=… --no-file-parallelism`: 62/63 files, 565/566 tests pass; the single
failure (`settings.test.ts`) is cross-file state of the shared database and passes
alone on a fresh database.

## Success criteria

- An incoming payment whose reference points at an invoice imported as paid is
  offered as a suggestion and matched in one click (or by the next reconcile).
- No invoice from a closed fiscal year is offered, and none from before the opening
  entry.
- "Offene Posten", "Überfällig" and the aging chart do not contain unassigned
  payments.
- A manual sync matches in the same run.

## Known issues

- The detail page still shows the "bezahlt" status chip next to the hint — the
  invoice *is* paid; only the payment record is missing.
- There is no "undo imported-paid" action for a Sheet row that was wrong.

## Future enhancements

- Let "Zahlung zuordnen" on the detail page preselect the invoice in the inbox
  (`/finance?invoice=<id>`).
- Offer a bulk "alle Rechnungen zuordnen" for the inbox.

## Deployment results

Pending (servyy-test first).
