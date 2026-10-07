# AGENTS.md — queen

Finance & ops app for bumbleflies (clients, invoices, credit notes, GLS/Firefly III auto-reconcile). Status: **planning** — source of truth is `docs/plans/2026-10-06-queen.md`. README is a one-paragraph pointer; trust the plan doc.

## Planned stack (no code yet — Task 1 scaffolds it)

TypeScript: React 19 + Vite client, Express + tRPC 11 server, Mongoose 9 (MongoDB = sole ledger), valkey + Bull, pdfkit, googleapis (Drive only), Firefly III API v1, Docker + Traefik + Ofelia. Clone dependency set from `leagues.finance/package.json` **minus `mysql2`**; vitest + `mongodb-memory-server` (`MONGO_URI` unset → in-memory).

Scaffold must include: `package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`, `src/server/{index,app,health}.ts`, `src/client/main.tsx`, `.env.example`, `renovate.json`, `.gitignore`. Verify with `npm install && npm run typecheck && npm run typecheck:server && npm test`.

## Invariants (enforce in code, do not relax)

- **GoBD:** issued invoices are never deleted/reopened. Correction = Stornorechnung (credit note, own number, negative lines, `cancels: <invoiceId>`). `draft` delete is the only delete.
- **Money = integer cents** everywhere. Parse German formats (`1.600,00 €`, `9329,6`, negative `-100,00 €`); VAT per line, half-up.
- **Numbering:** queen owns `customerNumber` + `invoiceNumber`. New = `YYYYMMDD-NN` via atomic `Counter` (`findOneAndUpdate` `$inc`); date = draft-creation date, not invoice date. Legacy imports keep arbitrary numbers with `legacy: true`.
- **State machine** (`draft → sent → paid`, `sent → canceled` via credit note only; `overdue` is computed, not stored): single `invoiceStateMachine.ts`, unit-tested; only `draft` is editable; `markSent` requires ≥1 line, gross ≠ 0.
- **Payment reference on PDFs:** `Verwendungszweck: <customerNumber>-<invoiceNumber>`. Reconcile regex must tolerate bank-inserted spaces/line breaks; customer number must match or → unmatched.
- **Standalone:** no dependency on LeagueSphere MySQL. League origins attach as optional `source` metadata, never required FKs.
- **Ledger (SKR04, double-entry):** `lib/accounting/ledger.ts` (`post`/`postOnce`/`reverse`) is the only write path for `JournalEntry`. Entries are never updated or deleted (model guards enforce it); corrections are reversals. Σ Soll = Σ Haben per entry, gapless `YYYY-NNNNN` numbers per fiscal year, no postings into a `closed` FiscalYear.
- **Automatic postings** (invoice/credit note on `markSent`/`cancel`, payment on assign/`markPaid`, reversal on unassign) go through `ledgerHooks.ts` wrapped in `safeLedger` — they never fail invoice/bank CRUD; `admin.ledgerBackfill` repairs gaps. Credit notes post from the ORIGINAL invoice's lines with `negate`.
- **No company figures in git** — opening balances and real amounts are entered in the UI only.
- **Server timezone:** the container runs with TZ=Europe/Berlin (Dockerfile); fiscal years, invoice numbers and entry dates are local German dates.

## CI / Docker publish (mirrors `bumbleflies/edu`, not leagues.finance)

- Workflows: `pr-tests` (lint + test + typechecks) on PRs/pushes/master; `docker-build-test` (build + container healthcheck) on PRs/master; `release-please.yml` (GitHub App token, auto-merge) cuts `queen-v*` tags; `release.yml` publishes `bumblecode/queen` (`:latest` + semver + sha) on those tags.
- Registry login = `DOCKERHUB_USERNAME` + `DOCKER_TOKEN` secrets. Release = `RELEASE_PLEASE_APP_ID` + `RELEASE_PLEASE_APP_PRIVATE_KEY`. Secrets live only in GitHub, never in git.
- `Dockerfile` is the one leagues.finance-derived file (Node 24 multi-stage); it runs as non-root `node` and healthchecks `/health`.

## Repo / data hygiene

- Repo `bumbleflies/queen` is **public**: no customer data in git. Fixtures anonymised, secrets in container git-crypt only.
- Service lives in `container/finance/docker-compose.yml` next to Firefly (same project → `http://firefly:8080` works). Reconcile = Ofelia `job-exec` `0 30 7 * * *` → `node dist/server/cron/reconcile.js` (after 06:00 GLS import).
- Deploy: test on **servyy-test first** (`ansible ./servyy-test.sh`), verify health + Ofelia run. **Prod needs explicit approval.** Until leagues.finance integration ships (plan Task 11), the Sheet stays source for LeagueSphere invoices — do not cut over early.
