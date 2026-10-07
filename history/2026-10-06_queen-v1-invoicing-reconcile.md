# 2026-10-06/07 — First version: invoicing, Drive filing, bank reconcile

Plan: [`docs/plans/2026-10-06-queen.md`](../docs/plans/2026-10-06-queen.md). UI reference: [`docs/mocks/`](../docs/mocks/).

## Problem

The "Debitoren und Ausgangsrechnungen" Google Sheet held all bumbleflies invoicing: consulting, trainings and LeagueSphere licences. It had several weaknesses:

- Customer and invoice numbers were allocated by hand, and leagues.finance allocated them as well, so collisions were possible.
- There was no GoBD-safe correction path.
- PDFs were filed to Drive by hand.
- Payments were matched against the GLS account statement by hand.

## Solution

queen is a standalone TypeScript app. MongoDB is its ledger and it has no dependency on LeagueSphere MySQL.

- **Auth:** Google OAuth with a client restricted to bumbleflies accounts. Admins come from `ADMIN_EMAILS`. Sessions use JWTs in the `queen_token` cookie. A service bearer token covers machine calls.
- **Clients and invoices:** full CRUD with a single state machine (`draft → sent → paid`, `sent → canceled` only through a Stornorechnung). Numbers are allocated by queen with an atomic `Counter`: `YYYYMMDD-NN` for invoices and sequential customer numbers. Money is held in integer cents, with VAT computed per line and rounded half-up.
- **PDF and Drive filing:** pdfkit generates the invoice PDF. Filing to the Drive invoices folder runs on a Bull/valkey queue. Every PDF prints the payment reference `Verwendungszweck: <customerNumber>-<invoiceNumber>`.
- **Bank sync and reconcile:**
  - GLS deposits come from Firefly III (`/api/v1/accounts/{id}/transactions`).
  - Payments are matched automatically by Verwendungszweck. The matcher tolerates spaces inserted by the bank and requires the customer number to match.
  - The Bankabgleich page offers manual assign, ignore and unassign.
  - A daily Ofelia job runs `node dist/src/server/cron/reconcile.js` at 07:30, after the 06:00 GLS import.
- **Sheet migration:**
  - `admin.importSheet` takes CSV exports of the three Sheet tabs. It runs as a dry run by default and produces a parity report.
  - `admin.linkDriveFiles` attaches PDFs that were already filed (it also finds them in year subfolders and with a "Gebucht - " prefix).
- **UI:** React 19 and Vite, with a mobile-first top bar shell (a bottom tab bar below 760 px).
  - Pages: Dashboard, Rechnungen, Kunden, Bankabgleich, Berichte and Einstellungen.
  - Reports cover open items, revenue by year and by client, and a CSV export.
  - The UI is bilingual (DE/EN, stored in `queen-lang`) and has dark mode (system default plus a toggle, stored in `queen-theme`).
  - It also has an Open Graph card and a favicon.
- **CI/CD:** the workflows mirror `bumbleflies/edu`: PR tests, a Docker build plus healthcheck, release-please (`queen-v*` tags) and a publish to `bumblecode/queen`.

## Main files

- `src/server/{index,app,trpc,trpcInit,health}.ts`
- `src/server/routers/*`
- `src/server/models/*`
- `src/server/lib/{money,numbering,invoiceStateMachine,reconcile,bankSync,sheetImport,applySheetImport}.ts`
- `src/server/services/{PdfService,DriveService,FireflyClient,AuthService}.ts`
- `src/server/jobs/*`
- `src/server/cron/reconcile.ts`
- `src/client/pages/*`
- `src/client/components/*`
- `src/client/i18n/*`
- `src/client/theme/*`
- `Dockerfile`, `entrypoint.sh`, `.github/workflows/*`

## Deployment results

- The image `bumblecode/queen` is published on each `queen-v*` release. The latest release at the time of writing is `queen-v0.9.0`.
- Deployed to **servyy-test** through `dachrisch/servyy-container` (`finance/docker-compose.yml`, which uses shared mongo and valkey).
- **Production is still gated off.** Outstanding before prod:
  - add the OAuth redirect URI for `queen.bumbleflies.de`
  - set the GLS account id and the Drive invoices folder id
  - add the `queen` mongo db to the backup timers

## Verification commands

```bash
npm install
npm run lint && npm run typecheck && npm run typecheck:server && npm test
# servyy-test
cd servyy-container/ansible && ./servyy-test.sh --tags user.docker.shared,user.docker.finance,user.docker.env.finance
# on the host: docker ps | grep finance.queen ; curl -fsS https://<test-host>/health
# manual reconcile: docker exec <queen container> node dist/src/server/cron/reconcile.js
```

## Success criteria

- Invoices are created, issued, filed and paid in queen, with no Sheet edits needed for consulting and training invoices.
- Payments are matched automatically the morning after they arrive in GLS.
- Sheet history is imported, and the parity report agrees with the Sheet.

## Known issues

- leagues.finance still writes LeagueSphere invoices to the Sheet. The `ext.*` service API (base plan Task 11) is not built yet, so the cutover (Task 12) has not happened. Do not cut over early.

## Future enhancements

- leagues.finance → queen integration (`ext.clients.upsertByExternalRef`, `ext.invoices.create`).
- Accounting: ledger, expenses, USt and Jahresabschluss. See [`2026-10-07_accounting-ledger-phase1.md`](2026-10-07_accounting-ledger-phase1.md).
