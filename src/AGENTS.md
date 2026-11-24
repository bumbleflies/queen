# AGENTS.md — src/

Directory-specific rules for queen's source code. Repo-wide essentials, build/test commands and the full invariant list live in the [root AGENTS.md](../AGENTS.md); working conventions (commits, PRs, releases) live in [CONTRIBUTING.md](../CONTRIBUTING.md).

## Layout

| Path | Holds |
|------|-------|
| `client/` | React `pages/`, `components/`, `lib/`, `i18n/` (`de.ts`, `en.ts`), `theme/`, `index.css` |
| `server/routers/` | One tRPC router per domain (clients, invoices, bank, bookings, bills, expenses, founders, payouts, receipts, suppliers, settings, users, reconcile, reports, accounts, ledger, admin) |
| `server/models/` | Mongoose models (Invoice, JournalEntry, BankTransaction, …) |
| `server/lib/` | Pure domain logic: `money`, `numbering`, `invoiceStateMachine`, `reconcile`, and `accounting/`, `bills/`, `expenses/`, `payments/`, `payouts/` |
| `server/services/` | Integrations: `PdfService`, `DriveService`, `FireflyClient`, `AuthService`, `OpencodeClient`, `GmailService`, `receiptText`/`receiptReader`, `billMatch` |
| `server/jobs/`, `server/cron/` | valkey/Bull jobs (`queue.ts`, `billIntake`, `expenseIntake`, `FileInvoiceJob`) and the daily reconcile/intake entrypoints |
| `server/routes/` | Non-tRPC Express routes (`auth.ts`, `exportInvoices.ts`) |
| `shared/` | zod schemas and types imported by both client and server |

Tests are colocated in a `__tests__/` folder next to the code they cover (e.g. `client/components/__tests__/`, `server/lib/accounting/__tests__/`).

## `src/client/`

- **Browser-only boundary.** Nothing reachable from `client/` may pull in a Mongoose model, a `server/services/` module, a node builtin or a node-only package. Vite externalizes builtins to `undefined` and the app then dies on its first render. Enforced by `client/__tests__/bundleBoundary.test.ts` and the `noNodeBuiltinsInClient` build guard in `vite.config.ts`. Pure helpers the client needs live in their own browser-safe module (e.g. `server/lib/accounting/normalize.ts`).
- **i18n:** every UI string goes through `t()`. `i18n/de.ts` is the source of `DictKey`; `i18n/en.ts` must declare the same keys (parity test).
- **Theming:** colours come only from CSS variables in `index.css` (light and dark); no hard-coded hex values in components.
- **UI verification:** check German and English, light and dark, and mobile width (≤ 760 px) in `npm run dev`.
- One formatter, `lib/bookingLabel.ts`, renders booking suggestions for both `BookingDialog` and `FinancePage`; keep account, VAT rate, mode and split parts distinguishable there.

## `src/server/`

- Keep domain logic in pure functions in `lib/` with colocated unit tests; routers and services stay thin.
- Router tests use `appRouter.createCaller` (see `routers/__tests__/helpers/`).
- `JournalEntry` writes go only through `lib/accounting/ledger.ts` (`post`/`postOnce`/`reverse`). Entries are never updated or deleted, and never via `collection`, `bulkWrite` or `insertMany`. Automatic postings run through `ledgerHooks.ts` inside `safeLedger` so they cannot fail invoice/bank CRUD.
- DB tests need `NODE_ENV=development` (set by `npm test`). When calling `npx vitest` directly, set it yourself or DB tests skip silently.
- The daily reconcile entrypoint is `cron/reconcile.ts`; mailbox intake is `cron/billIntake.ts` plus the jobs in `jobs/`, backed by the valkey/Bull queue in `jobs/queue.ts`.

## `src/shared/`

- Schemas and types used by both sides. Keep these browser-safe: no node builtins, models or server services here, or the client bundle boundary above breaks.
