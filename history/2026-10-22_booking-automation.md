# 2026-10-22 — Booking automation and available money

Spec: [`docs/plans/2026-10-22-booking-automation.md`](../docs/plans/2026-10-22-booking-automation.md). Plan: [`docs/plans/2026-10-22-booking-automation-plan.md`](../docs/plans/2026-10-22-booking-automation-plan.md).

## Problem

After the rules overview shipped, transactions without a rule still had to be booked by hand. These were mostly the partners' reimbursements (Spesen, domains, software) and tax-office payments. Foreign suppliers (§13b) couldn't be booked correctly at all. The owner also wanted to see how much money is really available after what is already owed to the tax office.

## Solution

Five parts:

- **A — §13b reverse charge.**
  - A new booking mode `reverseCharge`, for outgoing transactions only and always at 19 %. It books the expense at the gross amount, plus Vorsteuer 1407 and Umsatzsteuer 3837 on the same amount.
  - Accounts 1407 and 3837 are seeded at server start.
  - Available in the booking dialog, rules, JSON import/export and `suggest()`. The rules table marks the rules "§13b".
- **B — "Wie zuletzt".**
  - Without a rule, `suggestWithHistory` suggests how the same counterparty was booked before: by IBAN, otherwise by name ignoring Firefly placeholders, and keyed by direction.
  - It only suggests when the last ≤ 3 active bank bookings within 3 years agree.
  - A derived booking is only trusted if re-posting it reproduces the entry exactly, so splits never become history suggestions.
  - Rules always win over history.
- **C — Frei verfügbar.**
  - `ledger.availableCash` computes the bank balance minus open VAT (only if it is a liability), the provisions 3020/3035/3040, estimated income tax and the liabilities 3300/3500/3501.
  - The estimated income tax is rate × profit before income taxes, minus prepayments booked on 7600/7608/7610, floored at 0.
  - The rate is an admin setting (default 33 %, labelled "Schätzung").
  - The card appears on Finanzen and the dashboard. Each line links to its account ledger. The card warns while transactions are still open, and when the bank balance comes from the ledger (Firefly errors are shown).
- **D — Automatic booking.**
  - Rules can be flagged `autoBook`. The reconcile run then books matching open transactions itself (`createdBy: 'auto:reconcile'`), attaching a clear receipt match.
  - Only rule matches by IBAN or Verwendungszweck qualify, and only outgoing transactions. A transaction that was ever reversed is skipped. History and receipt suggestions are never auto-booked.
  - Results show in the ⋯ menu ("n automatisch gebucht"), and booked rows get an "automatisch" badge.
  - Only admins can change a flagged rule ("Als Regel merken" is refused for others).
  - The invariant in AGENTS.md and in the accounting specs is updated.
- **E — Reading receipts.**
  - For a transaction with a clear receipt match but no other suggestion, the PDF text (extracted with `unpdf@1.8.1`) is sent through the shared opencode server. IBANs and BICs are masked first, and only the account list is sent with it.
  - Models: active free models from the registry (with `QUEEN_OPENCODE_MODELS` preferred), then one paid fallback (`QUEEN_OPENCODE_PAID_MODEL`, default `opencode-go:deepseek-v4.1-flash`).
  - Retries follow dontforget's backoff (3 attempts, waiting 1 s then 2 s). Each request times out after 30 s, and each receipt has an overall budget of 180 s.
  - The reply is validated strictly: only known accounts, rates 0/7/19 %, lines that add up, and a total equal to the bank amount. It becomes a suggestion, including §13b and split bookings across VAT rates (`bankPostingSplit`, `book({ split })`).
  - Reading runs per row ("Beleg auslesen") and in the cron, up to 10 per run (not in "Abgleich starten").
  - Failed, no-text and amount-mismatch states show on load. Failed readings are retried on the next run or click.

## Main files

- **Server:**
  - `src/server/lib/accounting/{postingRules,history,suggest,availableCash,autoBook,receiptReading,receiptReader,bankBooking,supplierImport,skr04}.ts`
  - `src/server/services/{OpencodeClient,receiptText,receiptsDrive,driveForUser,appSettings}.ts`
  - `src/server/routers/{bookings,ledger,settings,suppliers,reconcile}.ts`, `src/server/cron/reconcile.ts`
  - Models: `Supplier`, `ReconcileRun`, `BankTransaction`
- **Client:** `src/client/pages/{FinancePage,DashboardPage,SettingsPage}.tsx`, `src/client/components/{AvailableCashCard,BookingDialog,RulesSection,LedgerViews}.tsx`, i18n de/en
- **Docs:** `AGENTS.md`, `docs/plans/2026-10-07-accounting.md`, `docs/plans/2026-10-07-accounting-phase2.md`, `.env.example`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server
TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism
```

- **Test suite:** 61 files and 542 tests pass. The suite runs serially because parallel `mongodb-memory-server` instances exhaust the `/tmp` tmpfs on the dev machine.
- **Process:** built subagent-driven, one task review per task plus a final whole-branch review. Every finding was fixed or explicitly deferred (see "Known issues").
- **Running app** (`npm run dev`, made-up data), checked in DE/EN, light/dark and at 390 px:
  - history suggestion "wie am …"
  - §13b row label
  - frei-verfügbar figures, checked by hand
  - rule dialog with mode and "Automatisch buchen"
  - Einstellungen tax-rate field

## Success criteria

- Foreign-supplier payments book as §13b with the VAT effect netting to zero.
- Recurring counterparties get one-click suggestions without writing rules.
- Flagged rules book themselves at 07:30, and a reversal stops that for the transaction.
- Receipts with mixed VAT rates become one split booking after one click.
- "Frei verfügbar" can be traced line by line to the accounts.

## Known issues

- **Receipt reading needs an API key.** It is off until queen gets its own `OPENCODE_API_KEY` (servyy-container `queen.env.j2` plus the opencode authgate key list, via Ansible). servyy-test has no authgate, so the live check is on production only.
- **Scanned receipts** (no text layer) stay manual.
- **Import edge case:** a JSON import row that only changes `defaultVatRate` on an existing §13b rule isn't merge-checked. Bookings stay correct because `suggest()` forces 19 %.
- **Auto-booking failures are counted, not explained.** The reason a row couldn't be auto-booked isn't stored. The Drive warning of a run is only in the database and the log.
- **Masking is broad on purpose:** IBAN-shaped references (e.g. "KD12-3456-7890") are masked too.

## Deployment results

Pending.
