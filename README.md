# queen

Finance and operations app for bumbleflies. It covers:

- clients and invoices, with PDF generation and Google Drive filing
- GoBD-safe credit notes
- automatic payment reconciliation against the GLS bank feed in Firefly III
- a double-entry SKR04 ledger as the start of in-house bookkeeping

queen replaces the "Debitoren und Ausgangsrechnungen" Google Sheet. It is meant to become the invoicing backend for [leagues.finance](https://github.com/bumbleflies/leagues.finance).

**Status:** the first version runs on servyy-test; production is still gated (latest release `queen-v0.9.0`, see [CHANGELOG](CHANGELOG.md)). Accounting phase 1, the ledger, is merged. Expenses, USt-VA and Jahresabschluss come next ([spec](docs/plans/2026-10-07-accounting.md)).

## Features

| Area | What it does |
|------|--------------|
| Rechnungen | Drafts with hierarchical positions, per-line VAT (incl. 0 % with an exemption note) and negative discount lines. Issuing produces a PDF with the payment reference `Verwendungszweck: <Kd>-<Nr>` and files it to Drive in the background. Corrections are Stornorechnungen only. |
| Kunden | Customer numbers allocated by queen, default payment terms, open/overdue summary. |
| Bankabgleich | GLS deposits synced from Firefly III. Daily auto-match by Verwendungszweck at 07:30; manual assign, ignore and unassign. |
| Buchhaltung | Immutable double-entry journal (SKR04, gapless `YYYY-NNNNN`), automatic postings for invoices, credit notes and payments, an opening entry, manual entries with Storno, Saldenliste and Kontoblatt. |
| Berichte | Open items, revenue by year and by client, CSV export. |
| UI | Mobile-first, German and English, light/dark/system theme. |

## Stack

TypeScript throughout:

- **Client:** React 19, Vite, tRPC 11.
- **Server:** Express and tRPC 11 on Node 24.
- **Data:** MongoDB via Mongoose 9. It is the only data store, and it holds the ledger.
- **Jobs:** valkey and Bull run the filing queue.
- **Integrations:** pdfkit, Google Drive (googleapis), Firefly III API v1.
- **Tests:** vitest with mongodb-memory-server.
- **Deployment:** a Docker image `bumblecode/queen`, run behind Traefik, with Ofelia scheduling the daily reconcile.

## Development

```bash
cp .env.example .env   # set JWT_SECRET; leave MONGO_URI unset for an in-memory DB
npm install
npm run dev            # API on :3000, Vite client (proxies /trpc and /auth)
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

`.env.example` documents every variable: Google OAuth, the Drive folder, Firefly PAT and account, `QUEEN_BANK_START`, `ADMIN_EMAILS`, the service token, and Mongo and Redis.

## Layout

```text
src/server/   index/app/trpc, routers/, models/, lib/ (money, numbering, state machine,
              reconcile, accounting/), services/ (PDF, Drive, Firefly, auth), jobs/, cron/
src/client/   pages/, components/, lib/, i18n/ (de, en), theme/
src/shared/   zod schemas and shared types
docs/plans/   implementation plans and specs
docs/mocks/   UI design reference
history/      feature logs: what shipped, how it was verified
```

## Deployment

Images are published by release-please and the `release.yml` workflow on `queen-v*` tags. The service runs from [`dachrisch/servyy-container`](https://github.com/dachrisch/servyy-container) (`finance/docker-compose.yml`, next to Firefly, using the shared mongo and valkey). It is deployed to servyy-test first; production needs explicit approval.

## Docs

- [AGENTS.md](AGENTS.md): invariants and working rules (for humans and coding agents)
- [CONTRIBUTING.md](CONTRIBUTING.md): setup, checks, conventions
- [docs/plans/](docs/plans/): the [base plan](docs/plans/2026-10-06-queen.md), the [accounting spec](docs/plans/2026-10-07-accounting.md) and the [ledger plan](docs/plans/2026-10-07-accounting-phase1.md)
- [history/](history/README.md): shipped features

## License

[MIT](LICENSE) © bumble:code
