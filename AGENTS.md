# AGENTS.md — queen

Finance & ops app for bumbleflies: clients, invoices, credit notes, Drive filing, GLS/Firefly III auto-reconcile, and a double-entry SKR04 ledger.

**Status:** the first version is live on servyy-test (releases `queen-v0.2.0`–`0.10.0`). Production is live at `https://queen.bumbleflies.de` since 2026-10-06 and needs explicit approval per deploy. Accounting phase 1 (the ledger) shipped in `queen-v0.10.0`.

**Where to read:**
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to work (commands, checks, branching, releases).
- This file: what must stay true.
- [`docs/plans/`](docs/plans/): intent. These are the [base plan](docs/plans/2026-10-06-queen.md), the [accounting spec](docs/plans/2026-10-07-accounting.md) and the [ledger plan](docs/plans/2026-10-07-accounting-phase1.md).
- [`history/`](history/README.md): what actually shipped. Add a log for every shipped feature.

## Stack & layout

TypeScript throughout:

- **Client:** React 19, Vite, tRPC 11.
- **Server:** Express and tRPC 11 on Node 24.
- **Data:** Mongoose 9 (MongoDB is the only store).
- **Jobs:** valkey and Bull run the filing queue.
- **Integrations:** pdfkit, googleapis (Drive only), Firefly III API v1.
- **Deployment:** Docker, with Traefik and Ofelia.
- **Tests:** vitest with `mongodb-memory-server`. Leave `MONGO_URI` unset to get an in-memory DB.

| Path | Holds |
|------|-------|
| `src/server/routers/` | `clients`, `invoices`, `bank`, `bookings`, `suppliers`, `reconcile`, `reports`, `accounts`, `ledger`, `admin` (`importSheet`, `linkDriveFiles`, `ledgerBackfill`) |
| `src/server/lib/` | Pure domain logic: `money`, `numbering`, `invoiceStateMachine`, `reconcile`, `bankSync`, `sheetImport`, `accounting/` (`skr04`, `postingRules`, `ledger`, `balances`, `ledgerHooks`, `backfill`, `suggest`, `bankCoverage`, `supplierImport`, `autoBook`, `receiptReading`) |
| `src/server/services/` | `PdfService`, `DriveService`, `FireflyClient`, `AuthService`, `OpencodeClient`, `receiptText`, `receiptReader` |
| `src/server/jobs/`, `src/server/cron/reconcile.ts` | Filing queue, and the daily reconcile entrypoint |
| `src/client/` | `pages/`, `components/`, `lib/`, `i18n/` (`de.ts` is the source of `DictKey`; `en.ts` must have the same keys), `theme/` |

**Checks:** `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.
- `npm test` sets `NODE_ENV=development`. Without it, DB tests skip silently, so set it yourself when calling `npx vitest` directly.
- The build emits `dist/src/server/…` because `tsconfig.server.json` has `rootDir: "."`.

**Base plan progress:**
- Tasks 1–10 are done: scaffold, auth, money/numbering/state machine, CRUD, PDF+Drive, Firefly sync, reconcile, UI, Docker/CI/servyy-test, Sheet import.
- Open: Task 11 (leagues.finance → queen `ext.*` API, not built yet) and Task 12 (cutover).

## Invariants (enforce in code, do not relax)

- **Sign-in:** Google OAuth for `@bumbleflies.de`, plus one-time invite links for people without a Google account (`users.invite`). The link's plaintext exists only in the response that created it; only `sha256` is stored. TTL 168 h (`INVITE_TTL_HOURS`), single use via one atomic `findOneAndUpdate`. Invited sessions carry a `tv` (tokenVersion) claim, last 30 days, and are checked against the user document on every request — `users.setDisabled` bumps `tokenVersion` and therefore ends them immediately. Google sessions stay 12 h with no per-request DB read. Users are disabled, never deleted: `createdBy` must stay resolvable.
- **Drive for users without a Google token:** `driveForActor()` borrows the admin who last saved the Drive settings (the `driveForCron()` credential). It never falls back when the user's own token fails. `settings.browseDriveFolders` is admin-only for the same reason — the fallback token can see that admin's whole Drive.
- **GoBD:** issued invoices are never deleted/reopened. Correction = Stornorechnung (credit note, own number, negative lines, `cancels: <invoiceId>`). `draft` delete is the only delete.
- **Money = integer cents** everywhere. Parse German formats (`1.600,00 €`, `9329,6`, negative `-100,00 €`); VAT per line, half-up.
- **Numbering:** queen owns `customerNumber` + `invoiceNumber`. New = `YYYYMMDD-NN` via atomic `Counter` (`findOneAndUpdate` `$inc`); date = draft-creation date, not invoice date. Legacy imports keep arbitrary numbers with `legacy: true`.
- **State machine** (`draft → sent → paid`, `sent → canceled` via credit note only; `overdue` is computed, not stored): single `invoiceStateMachine.ts`, unit-tested; only `draft` is editable; `markSent` requires ≥1 line, gross ≠ 0.
- **Payment reference on PDFs:** `Verwendungszweck: <customerNumber>-<invoiceNumber>`. Reconcile regex must tolerate bank-inserted spaces/line breaks; customer number must match or → unmatched.
- **Unassigned payments (imported paid):** an invoice imported from the Sheet as paid has no `payments` entry, so `lib/invoiceOpen.ts` (`paymentMissing` / `matchableInvoiceFilter`) keeps it offerable in the bank inbox — for the earliest non-closed fiscal year only — while `reports.openItems` reports it as `paymentMissing` outside `totalOpenCents`/`totalOverdueCents` (the money arrived; only the bank payment is unknown). Manual syncs (`bank.syncNow`) match in the same run, not just the nightly job.
- **Standalone:** no dependency on LeagueSphere MySQL. League origins attach as optional `source` metadata, never required FKs.
- **Ledger (SKR04, double-entry):** `lib/accounting/ledger.ts` (`post`/`postOnce`/`reverse`) is the only write path for `JournalEntry`. Entries are never updated or deleted (query/document operations on the model are guarded; never use collection/`bulkWrite`/`insertMany` APIs on `JournalEntry`); corrections are reversals. `source.refId` conventions: `bank:<fireflyJournalId>`, `markPaid:<invoiceId>`, `opening:<year>`; a reversal entry references the original entry's `_id`. Σ Soll = Σ Haben per entry, gapless `YYYY-NNNNN` numbers per fiscal year, no postings into a `closed` FiscalYear.
- **Automatic postings** (invoice/credit note on `markSent`/`cancel`, payment on assign/`markPaid`, reversal on unassign) go through `ledgerHooks.ts` wrapped in `safeLedger` — they never fail invoice/bank CRUD; `admin.ledgerBackfill` repairs gaps. Credit notes post from the ORIGINAL invoice's lines with `negate`.
- **Bank bookings need confirmation:** nothing posts without confirmation except rules an admin explicitly marked `autoBook`, matched by IBAN or Verwendungszweck. Auto-booking runs in the daily reconcile job (`cron/reconcile.ts`, not via `ledgerHooks`/`safeLedger`): `lib/accounting/autoBook.ts` → `bookBankTransaction` with `createdBy: 'auto:reconcile'`. It books outgoing transactions only, skips transactions whose bank booking was ever reversed, never books name matches, history suggestions or receipt readings, skips a row whose matched receipt contradicts the rule (`suggestion.conflict`), and its failures never set `ReconcileRun.error`. See [the booking automation spec](docs/plans/2026-10-22-booking-automation.md).
- **Receipt reading (opencode):** only the PDF's text layer is sent, with IBANs/BICs masked (`maskBankData`), plus account numbers and names — never balances or other transactions. Readings are stored per Drive file on `BankTransaction.receiptReadings` ('ok'/'noText' are final, 'failed' is retried; non-PDF files are 'noText') with the Drive `link`, so a matched set can be attached to the posting. One transaction may be backed by several receipts: the attached file, the clear Drive match and its siblings (same name with a `_2` copy marker) are read, and `receiptMatch` holds the smallest set whose totals add up exactly, with agreeing vendors and one VAT treatment (`matchReceiptSet`). Readings are only a suggestion (order: rule → history → receipt); they are never auto-booked. Every open outgoing row with a clear candidate is read, rule-classified or not: 25 per run (`QUEEN_RECEIPTS_PER_RUN` overrides) plus the on-demand `bookings.readReceiptsNow` behind "Alle Belege jetzt lesen". When a matched receipt contradicts the rule/history suggestion, the suggestion carries `conflict`: the row shows `Regel ≠ Beleg`, one-click, bulk and auto booking refuse it, and the dialog asks which side to book. Reading never fails the reconcile run; without `OPENCODE_API_KEY` it is disabled, not an error.
- **Every booking teaches a rule:** `bookBankTransaction` creates or extends the rule for the counterparty after a successful posting — key IBAN → name → purpose prefix (`ruleLearning.ts`), values account/VAT/mode. The rule that matched the row (same `suggest()` logic) is extended, never duplicated; `Supplier.origin` is `learned` (with `learnedAt`) or `manual`. Split bookings, incoming payments and collective reimbursements (receipt vendor ≠ bank counterparty) teach nothing; a non-admin booking against an `autoBook` rule books but leaves that rule unchanged. The old `rememberRule` checkbox is gone.
- **Booking rules** (suppliers with IBAN / Verwendungszweck / name patterns) feed the inbox suggestion via `suggest.ts` (IBAN → purpose → name, lowest Kreditornummer wins). Only admins create, edit, archive or import them (`suppliers.importJson` matches by Kreditornummer, then name, and writes nothing on any error); suppliers are archived, never deleted.
- **No company figures in git** — opening balances and real amounts are entered in the UI only.
- **Server timezone:** the container runs with TZ=Europe/Berlin (Dockerfile); fiscal years, invoice numbers and entry dates are local German dates.

## CI / Docker publish (mirrors `bumbleflies/edu`, not leagues.finance)

- Workflows: `pr-tests` (lint + test + typechecks) on PRs/pushes; `build-publish` (build + container healthcheck, push only when `publish: true`) on PRs (dry-run), master pushes (publish) and tags; `release-please.yml` (GitHub App token, auto-merge) cuts `queen-v*` tags; `release.yml` publishes `bumblecode/queen` (`:latest` + semver + sha) on those tags.
- Registry login = `DOCKERHUB_USERNAME` + `DOCKER_TOKEN` secrets. Release = `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY`. Secrets live only in GitHub, never in git.
- `Dockerfile` is the one leagues.finance-derived file (Node 24 multi-stage); it runs as non-root `node` and healthchecks `/health`.

## Repo / data hygiene

- Repo `bumbleflies/queen` is **public**: no customer data in git. Fixtures anonymised, secrets in container git-crypt only.
- The service lives in [`dachrisch/servyy-container`](https://github.com/dachrisch/servyy-container) `finance/docker-compose.yml`, next to Firefly (`http://finance.firefly:8080`).
  - It uses the shared `mongo` (db `queen`) and `redis` (db `1`) from `shared/docker-compose.yml`.
  - Env comes from the Ansible template `templates/finance/queen.env.j2`.
  - Reconcile is an Ofelia `job-exec` at `0 30 7 * * *` running `node dist/src/server/cron/reconcile.js`, after the 06:00 GLS import.
- **Deploy to servyy-test first** (`ansible ./servyy-test.sh`), then verify health and the Ofelia run. **Prod needs explicit approval** — queen runs in production at `https://queen.bumbleflies.de` (live since 2026-10-06, see `servyy-container/history/2026-10-06_queen-prod-enablement.md`), so every deploy needs that approval rather than a gate switch.
- Until the leagues.finance integration ships (plan Task 11), the Sheet stays the source for LeagueSphere invoices. Do not cut over early.
- **Ledger go-live order on an environment:**
  1. Check that the container honours TZ (`getTimezoneOffset()` is `-60` or `-120`).
  2. Enter the opening entry in the UI.
  3. Run `admin.ledgerBackfill` as a dry run and review `skipped`.
  4. Run it for real.
