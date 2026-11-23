# 2026-11-23 — Founder expenses: payout, QR and settlement

Release: pending (stacked on `feat/founder-expenses-ledger`)

## Problem

Founder reimbursements were tracked outside queen. The private receipt and the
bank transfer that repaid it were not linked, so the liability stayed open and
the money could be booked twice.

## What shipped

- **Increment 1/2 (base branch):** founder registry with login address and
  payout target, `expenses@` mailbox intake with PDF filing, claim confidence,
  booking against the founder liability with reversal-based corrections,
  auto-booking under the configured limit, and the claim review UI with a
  return-to-after-login deep link.
- **Increment 3 (this branch):**
  - `Payout` model and gapless per-year `SP-<year>-<NNNN>` numbering.
  - Payout router: preview, create (one draft per founder, additive), get,
    release, markExecuted, cancel, qr, list. `get`/`qr` are admin-only and no
    payload is returned before release.
  - Payout page and Expenses tab. The draft shows **Freigeben**; release posts
    a German reply mail into the newest claim's thread with the authenticated
    deep link. After login the page shows the GiroCode QR and copyable fields;
    settled and canceled payouts show no QR. **Als überwiesen** is only a
    fallback for a late bank row.
  - Settlement matcher: reference → payout target + exact amount → legacy
    Spesen purpose. Ties, amount mismatches and dividend-like purposes never
    match. The daily reconcile settles before invoice matching and auto-booking;
    warnings land on `ReconcileRun.payoutWarning`.
  - Founder payout targets never teach a rule, are never auto-booked, and show
    a `founderHint` instead of an expense suggestion in the Finance inbox.
  - Invariants in `AGENTS.md`, a design summary in `docs/plans/`, and this log.
- **Increment 4 (this branch):** the two missing admin UIs — a founder registry
  in Settings (create/edit, intake addresses, archive/restore) and payout
  suggestions on the Expenses → Auszahlungen tab (one preview per active
  founder, create a draft and open it). No founder data is hard-coded; DE/EN
  keys and client tests cover both flows.

## Field finding (GLS GiroCode)

The GLS app was checked on 2026-11-23 with `lib/payments/epcQr.ts`. The EPC069-12
v2 layout keeps field 9 (purpose code) and field 10 (structured reference)
**empty**; the free-text Verwendungszweck belongs in **field 11**. With the
purpose in field 9 the app silently dropped it. Every field, including the
last, is LF-terminated. The browser renders the payload with `qrcode` — the
server returns only the string.

## Mailbox

Incoming receipts go to the `expenses@bumbleflies.de` Google group. The group
and its member addresses are administered in Google Workspace and mirrored in
the admin-managed founder registry (`Founder.emails`); actual addresses are not
recorded in this public repository. The claim confirmation and the payout
release mail are replies in the sender's own Gmail thread, sent to the mailbox
itself with the Google credential of the admin who saved the Drive settings.
A sender without a login match still gets a reply — the claim link then simply
requires a Workspace login.

## Liability account

`Founder.liabilityAccount` defaults to **3500** (other liabilities). **1700**
(liabilities to shareholders) is available but is only switched once the tax
advisor confirms the mapping. No real amounts, IBANs or names are stored here.

## Files changed

- `src/server/models/Payout.ts`, `src/server/lib/payouts/{numbering,payoutMail}.ts`
- `src/server/routers/payouts.ts`, `src/server/trpc.ts`
- `src/server/lib/accounting/{payoutMatch,bankBooking,ruleLearning,autoBook}.ts`
- `src/server/cron/reconcile.ts`, `src/server/routers/bookings.ts`
- `src/server/models/{BankTransaction,ReconcileRun}.ts`
- `src/client/pages/{PayoutPage,ExpensesPage}.tsx`, `src/client/components/PayoutCard.tsx`,
  `src/client/main.tsx`, i18n dictionaries, `package.json` (`qrcode`)
- `src/client/components/{FoundersSection,PayoutSuggestions}.tsx`, `SettingsPage.tsx`
  and client tests for both admin flows
- tests for numbering, payout router, payout mail, matching and the founder guard
- `AGENTS.md`, `docs/plans/2026-11-23-founder-expenses.md`

## Verification commands

```bash
npm run lint
npm run typecheck
npm run typecheck:server
npm test
npm run build
```

CI is the full test gate; the local machine has no database, so DB-backed tests
skip locally and run in CI.

## Success criteria

- A claim that arrived books nothing until `bookExpenseClaim`.
- A confident claim under the configured limit auto-books and is reversible.
- A released payout produces one threaded mail and an authenticated QR page.
- The matched bank row settles the liability and marks all claims settled.
- A dividend row and a founder payout target never produce a booking rule.

## Known issues / future enhancements

- One bank transaction has a single receipt slot; with several claims in a
  payout only the first claim's PDF is attached directly, the rest stay linked
  on their claims.
- The available-cash figure does not change on settlement: cash and liability
  fall by the same amount. This is deliberate.
- Production rollout still needs explicit approval per deploy and the manual
  checklist on servyy-test.
