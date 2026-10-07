# AGENTS.md — queen

Finance & ops app for bumbleflies: clients, invoices, credit notes, Drive filing, GLS/Firefly III auto-reconcile, and a double-entry SKR04 ledger.

**Status:** the first version is live on servyy-test (releases `queen-v0.2.0`–`0.10.0`). Production is gated. Accounting phase 1 (the ledger) shipped in `queen-v0.10.0`.

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
| `src/server/routers/` | `clients`, `invoices`, `bank`, `reconcile`, `reports`, `accounts`, `ledger`, `admin` (`importSheet`, `linkDriveFiles`, `ledgerBackfill`) |
| `src/server/lib/` | Pure domain logic: `money`, `numbering`, `invoiceStateMachine`, `reconcile`, `bankSync`, `sheetImport`, `accounting/` (`skr04`, `postingRules`, `ledger`, `balances`, `ledgerHooks`, `backfill`) |
| `src/server/services/` | `PdfService`, `DriveService`, `FireflyClient`, `AuthService` |
| `src/server/jobs/`, `src/server/cron/reconcile.ts` | Filing queue, and the daily reconcile entrypoint |
| `src/client/` | `pages/`, `components/`, `lib/`, `i18n/` (`de.ts` is the source of `DictKey`; `en.ts` must have the same keys), `theme/` |

**Checks:** `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.
- `npm test` sets `NODE_ENV=development`. Without it, DB tests skip silently, so set it yourself when calling `npx vitest` directly.
- The build emits `dist/src/server/…` because `tsconfig.server.json` has `rootDir: "."`.

**Base plan progress:**
- Tasks 1–10 are done: scaffold, auth, money/numbering/state machine, CRUD, PDF+Drive, Firefly sync, reconcile, UI, Docker/CI/servyy-test, Sheet import.
- Open: Task 11 (leagues.finance → queen `ext.*` API, not built yet) and Task 12 (cutover).

## Invariants (enforce in code, do not relax)

- **GoBD:** issued invoices are never deleted/reopened. Correction = Stornorechnung (credit note, own number, negative lines, `cancels: <invoiceId>`). `draft` delete is the only delete.
- **Money = integer cents** everywhere. Parse German formats (`1.600,00 €`, `9329,6`, negative `-100,00 €`); VAT per line, half-up.
- **Numbering:** queen owns `customerNumber` + `invoiceNumber`. New = `YYYYMMDD-NN` via atomic `Counter` (`findOneAndUpdate` `$inc`); date = draft-creation date, not invoice date. Legacy imports keep arbitrary numbers with `legacy: true`.
- **State machine** (`draft → sent → paid`, `sent → canceled` via credit note only; `overdue` is computed, not stored): single `invoiceStateMachine.ts`, unit-tested; only `draft` is editable; `markSent` requires ≥1 line, gross ≠ 0.
- **Payment reference on PDFs:** `Verwendungszweck: <customerNumber>-<invoiceNumber>`. Reconcile regex must tolerate bank-inserted spaces/line breaks; customer number must match or → unmatched.
- **Standalone:** no dependency on LeagueSphere MySQL. League origins attach as optional `source` metadata, never required FKs.
- **Ledger (SKR04, double-entry):** `lib/accounting/ledger.ts` (`post`/`postOnce`/`reverse`) is the only write path for `JournalEntry`. Entries are never updated or deleted (query/document operations on the model are guarded; never use collection/`bulkWrite`/`insertMany` APIs on `JournalEntry`); corrections are reversals. `source.refId` conventions: `bank:<fireflyJournalId>`, `markPaid:<invoiceId>`, `opening:<year>`; a reversal entry references the original entry's `_id`. Σ Soll = Σ Haben per entry, gapless `YYYY-NNNNN` numbers per fiscal year, no postings into a `closed` FiscalYear.
- **Automatic postings** (invoice/credit note on `markSent`/`cancel`, payment on assign/`markPaid`, reversal on unassign) go through `ledgerHooks.ts` wrapped in `safeLedger` — they never fail invoice/bank CRUD; `admin.ledgerBackfill` repairs gaps. Credit notes post from the ORIGINAL invoice's lines with `negate`.
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
- **Deploy to servyy-test first** (`ansible ./servyy-test.sh`), then verify health and the Ofelia run. **Prod needs explicit approval**; prod is still gated off in `finance_services`.
- Until the leagues.finance integration ships (plan Task 11), the Sheet stays the source for LeagueSphere invoices. Do not cut over early.
- **Ledger go-live order on an environment:**
  1. Check that the container honours TZ (`getTimezoneOffset()` is `-60` or `-120`).
  2. Enter the opening entry in the UI.
  3. Run `admin.ledgerBackfill` as a dry run and review `skipped`.
  4. Run it for real.
