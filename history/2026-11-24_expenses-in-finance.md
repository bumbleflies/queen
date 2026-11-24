# 2026-11-24 — Expenses inside Finance

**Problem:** Founder expenses had a separate top-level page that repeated
Finance's header and year picker, added a second tab bar and rendered a tall,
mostly empty card with the legal note floating at its bottom edge.

**Solution:** Expenses is now the seventh tab of Finance, grouped with Bills.
The standalone nav item is gone; `/expenses` redirects to
`/finance?tab=expenses`. The Finance year picker drives the receipts table.
Receipts/Payouts are pill sub-tabs beside the intake actions in one toolbar row,
the empty state is a compact band and the § note sits in a bordered strip below
the table. Payout deep links are unchanged and still require login.

**Files changed:** `src/client/components/Navigation.tsx`, `src/client/main.tsx`,
`src/client/pages/FinancePage.tsx`, `src/client/components/ExpensesSection.tsx`
(new), `src/client/components/ClaimsSection.tsx`, `src/client/index.css`,
`src/client/i18n/{de,en}.ts`, client test suites,
`docs/plans/2026-11-24-expenses-in-finance-design.md`.

**Deployment results:** pending — feature branch, not yet deployed.

**Verification commands:** `npm run lint`, `npm run typecheck`,
`npm run typecheck:server`, `npm test -- --maxWorkers=2`. Checked in the browser
at desktop and mobile widths, DE and EN, light and dark.

**Success criteria:** no Expenses item in either nav; `/expenses` lands on the
Finance tab; one year picker; no duplicated page header; no oversized empty
card; payout deep links still open on `/expenses/payouts/:number`.

**Known issues:** none.

**Future enhancements:** fold "claims needing review" into the Finance badge
alongside open bank rows, if the combined number proves useful.
