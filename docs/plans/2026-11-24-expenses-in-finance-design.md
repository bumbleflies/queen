# Design: Expenses inside Finance (2026-11-24)

## Problem

Founder expenses had their own top-level nav item and page. That page repeated
Finance's page head and year picker, opened with a second tab bar, and rendered
an oversized empty card with the legal note floating at its bottom edge. The
receipts are the last intake step of the same money workflow as bank rows and
bills, so having them outside Finance made both pages harder to scan.

Approved decision: retire the standalone Expenses page; make it a tab in
Finance. `/expenses` becomes a redirect; the authenticated payout deep links
stay where they are.

## Layout

- **Nav** — remove Expenses from `NAV_ITEMS`; the desktop top bar and the mobile
  tab bar share that array. Finance keeps its badge.
- **Tab bar** — seven tabs in three groups: `Open · Done · Ignored │ Bills ·
  Expenses │ Rules · Journal`. A thin `.tab-divider` separates the groups.
- **Content** — one `ExpensesSection` component owned by the Finance page.
  Receipts/Payouts become a `.seg` pill sub-tab beside the intake actions in a
  single `.fin-subbar`. The page-head year selector drives the receipts query;
  the duplicate selector is gone.
- **Margins** — no new spacing constants: `.main` gap (20px) and `.fin-subbar`
  margin (14px) stay. The empty card becomes a ~150px `.empty-band` (icon, one
  sentence, no button — the action is already in the toolbar). The long § note
  moves into a bordered `.hint-strip` below the table.

## Data flow

`FinancePage` queries `expenses.claims.list({ year })` only to show the tab
count (open claims). `ExpensesSection` renders `ClaimsSection year={year}`,
which never owns year state. Intake, manual entry and the address-binding
toggle live in `ExpensesSection` so `ClaimsSection` is a pure table — the same
shape as `BillsSection`. Payout suggestions/cards render in the Payouts
sub-tab and are unchanged.

## Invariants kept

- Payout links remain authenticated deep links at `/expenses/payouts/:number`;
  only the list page moves.
- A claim still books nothing on intake; the toolbar only files/assigns.
- Claim corrections, reversals and rule learning are untouched.
- Every string stays in `de.ts` and `en.ts`; colours come from CSS variables.

## Tests

- `financePage.test.tsx`: the tab opens from `?tab=expenses`, shows the count,
  has no second page header, and switches to payouts.
- `expensesSection.test.tsx` (renamed from `expensesPage.test.tsx`): all
  existing claim table assertions still hold with the year passed in.
- `i18n-rollout.test.tsx`: no Expenses link in the nav, in DE or EN.
