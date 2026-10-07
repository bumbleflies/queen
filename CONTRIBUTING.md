# queen Contributor Guide

This guide is the **central source of truth** for everyone working on queen: contributors, developers and coding agents. [`AGENTS.md`](AGENTS.md) holds the domain invariants that code must enforce. This guide covers how to work.

## 📁 Essential Documentation

- **[README](README.md)**: what queen does, the stack, and the repo layout.
- **[AGENTS.md](AGENTS.md)**: invariants (GoBD, money, numbering, state machine, ledger), CI and data hygiene.
- **[Plans & specs](docs/plans/)**: the [base plan](docs/plans/2026-10-06-queen.md), the [accounting spec](docs/plans/2026-10-07-accounting.md) and the [ledger plan](docs/plans/2026-10-07-accounting-phase1.md).
- **[UI mocks](docs/mocks/README.md)**: the layout, copy and states reference.
- **[Feature history](history/README.md)**: what shipped and how it was verified.

## 📂 Project Structure Overview

- `src/server/routers/`: tRPC routers (`clients`, `invoices`, `bank`, `reconcile`, `reports`, `accounts`, `ledger`, `admin`).
- `src/server/models/`: Mongoose models (Invoice, Client, BankTransaction, JournalEntry, FiscalYear, Account, Counter, …).
- `src/server/lib/`: pure domain logic: money, numbering, the invoice state machine, reconcile, Sheet import, and `accounting/` (posting rules, ledger, balances, hooks, backfill).
- `src/server/services/`: PDF, Google Drive, Firefly III, auth.
- `src/server/jobs/`, `src/server/cron/`: the Bull filing queue and the daily reconcile entrypoint.
- `src/client/`: React pages, components, `i18n/` (de, en) and `theme/` (light/dark/system).
- `src/shared/`: zod schemas and types shared by the client and server.

## 🏗 Build, Lint & Test Commands

```bash
cp .env.example .env     # JWT_SECRET is required; leave MONGO_URI unset → in-memory MongoDB
npm install
npm run dev              # API :3000 (tsx watch) + Vite client (proxies /trpc and /auth)
npm run lint             # oxlint
npm run typecheck        # client + shared
npm run typecheck:server
npm test                 # NODE_ENV=development vitest run
npm run build            # vite build + server tsc → dist/src/server/…
```

With no `MONGO_URI` set, the server starts `mongodb-memory-server` and seeds the SKR04 accounts. Login uses Google OAuth. For local UI work only, sign a short-lived JWT with your local `JWT_SECRET` (`{ sub, email, role: 'admin' }`) and set it as the `queen_token` cookie.

## ✅ Code Quality Requirements (MANDATORY)

**All code MUST meet these requirements before it is pushed:**

| Requirement | Rule | Enforcement |
|---|---|---|
| **Tests** | Every change comes with tests (vitest); DB tests use mongodb-memory-server | CI (`pr-tests`) blocks merge |
| **Lint** | `npm run lint` with zero errors | CI blocks merge |
| **Types** | Both typechecks pass; no `any` in new code | CI blocks merge |
| **Build & container** | Docker build plus `/health` check pass | CI (`docker-build-test`) blocks merge |
| **Clean test output** | No unexpected `[ledger] … failed` lines or stray warnings (`--silent=false`) | Code review |
| **i18n** | Every UI string goes through `t()` and has keys in both `de.ts` and `en.ts` | Parity test |
| **Theming** | Colours come only from CSS variables in `index.css` (light and dark) | Code review |
| **No sensitive data** | No customer data, company figures or secrets in code, tests, fixtures or docs (the repo is public) | Code review |

## 🎨 Core Development Workflow

### 1. Test-Driven Development (TDD)

Follow **RED → GREEN → REFACTOR**.

- Keep domain logic in pure functions under `src/server/lib/` with unit tests: money, numbering, the state machine, posting rules and balances.
- Router tests use `appRouter.createCaller`. See `src/server/routers/__tests__/helpers/ledgerFixtures.ts`.
- ⚠️ DB tests **skip silently** without `NODE_ENV=development`. Always set it when calling `npx vitest` directly.

### 2. Domain rules you must not break

The full list is in [AGENTS.md](AGENTS.md). In short:

- **Money is integer cents.** VAT is computed per line and rounded half-up.
- **GoBD:**
  - Issued invoices are never deleted or reopened; corrections are Stornorechnungen.
  - Journal entries are never updated or deleted; corrections are reversals through `lib/accounting/ledger.ts`.
  - Never use `collection`, `bulkWrite` or `insertMany` on `JournalEntry`.
- **Ledger side effects never break CRUD.** Hooks run inside `safeLedger`, and `admin.ledgerBackfill` repairs gaps.
- **Dates** are German business dates. The container runs with `TZ=Europe/Berlin`, and the client builds `<input type="date">` values as local dates.

### 3. Git & Branching Protocol

- **No direct commits to `master`.** Always use a feature branch.
- **Conventional Commits:** `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, …
- **Pull requests** go to `bumbleflies/queen` and must fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md):
  `gh pr create --repo bumbleflies/queen --base master --title "…" --body-file …`
- **Code style:** single quotes and the existing line wrapping. There is no Prettier config, so don't reformat files you aren't changing.

### 4. Verification & Completion: MANDATORY CHECKS

Before reporting a task as finished:

1. **Full suite is green:**
   ```bash
   npm run lint && npm run typecheck && npm run typecheck:server && npm test
   ```
2. **UI changes are checked in the running app** (`npm run dev`): German and English, light and dark, and mobile width (≤ 760 px).
3. **servyy-test validation** for anything that ships. Deploy through `dachrisch/servyy-container` (`ansible ./servyy-test.sh …`), then verify `/health` and, where relevant, the Ofelia reconcile job.
4. **Production needs explicit approval.** Never edit production hosts by hand; every infra change goes through Ansible.

## 🛠 Maintenance

### Version Management (release-please)

queen uses **release-please**. Don't edit versions by hand; just merge PRs that use Conventional Commits:

- `fix:` → patch, `feat:` → minor, and `BREAKING CHANGE:` in the commit body → major.
- release-please opens a release PR (version bump plus `CHANGELOG.md`). Merging it tags `queen-vX.Y.Z`, and `release.yml` publishes `bumblecode/queen` (`:latest`, semver, sha).
- **Never merge the release-please branch into a feature branch.** Only release-please may change `.release-please-manifest.json` and `CHANGELOG.md`.

### Feature Documentation

Every shipped feature gets a log in [`history/`](history/README.md) named `YYYY-MM-DD_feature-name.md`. It records the problem, the solution, the files changed, deployment results, verification commands, success criteria, known issues and future enhancements. Larger features start with a spec and a plan in `docs/plans/`.

### Issues

Use the [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) and [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) forms. Redact customer data from logs and screenshots.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
