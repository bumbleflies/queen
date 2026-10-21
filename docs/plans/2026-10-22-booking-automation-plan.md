# Booking Automation (Parts A–D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- §13b reverse-charge bookings.
- "Wie zuletzt" suggestions from booking history.
- A "frei verfügbar" figure.
- Opt-in automatic booking during the daily reconcile run.

Part E (receipt reading) is planned separately once its model is chosen.

**Architecture:**
- **Pure logic:** each part adds one pure module under `src/server/lib/accounting/` with unit tests:
  - `postingRules` (new mode)
  - `history.ts`
  - `availableCash.ts`
  - `autoBook.ts`
- **Wiring:** a thin tRPC layer, and the reconcile run for automatic booking.
- **Ledger writes:** journal writes still go only through `bookBankTransaction` → `ledger.post`.
- **UI:** extends the existing Finanzen page, rule dialog, Einstellungen and dashboard.

**Tech Stack:** TypeScript, Mongoose 9, tRPC 11, zod, React 19, vitest + mongodb-memory-server.

**Spec:** `docs/plans/2026-10-22-booking-automation.md` (read first). Conventions: `docs/plans/2026-10-07-accounting-phase2.md` → "Global Constraints".

## Global Constraints

- Money is integer cents. VAT rates are 0, 0.07 and 0.19. Net = `Math.round(gross / (1 + rate))`, VAT = gross − net.
- Journal writes only through `ledger.ts`. Bank source is `{ kind: 'bank', refId: <fireflyJournalId> }`. Never use `collection`, `bulkWrite` or `insertMany` on `JournalEntry`.
- **Invariant change (Task 7):** "Nothing posts without confirmation **except rules an admin explicitly marked `autoBook`**, matched by IBAN or Verwendungszweck."
- History suggestions never auto-book. Rules always win over history.
- **§13b:** outgoing only, fixed 19 %. Vorsteuer **1407**, Umsatzsteuer **3837**.
- **"frei verfügbar":**
  - Default tax rate 0.33, shown as "Schätzung (33 %)", stored as a `Setting` and editable by admins.
  - Balances are cumulative over non-closed fiscal years. Profit covers the current fiscal year only.
- No company figures in git. Fixtures are made up.
- UI: every string through `t()` in `de.ts` + `en.ts`, colours from CSS variables, `table.resp` + `data-l`. Check in DE/EN, light/dark, ≤ 760 px.
- Local full test run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism`. Parallel runs exhaust the `/tmp` tmpfs on the dev machine.
- **Shipping:** each part (A = Tasks 1–2, B = 3–4, C = 5–6, D = 7) is its own PR and release, servyy-test first, then production. Push, PR and deploy need the user's approval.

## Review Focus

1. **Firefly placeholder counterparties** ("(unknown destination)") must never be grouped into one history key. Bank fees and their VAT would otherwise share a key → Task 3 test `ignores placeholder names`.
2. **A reversed booking must not count as history.** Only active `bank` entries count, otherwise a corrected mistake keeps being suggested → Task 3 test `skips reversed entries`.
3. **A VAT refund claim (Vorsteuer > USt) is not cash** and must not raise "frei verfügbar" → Task 5 test `does not add a VAT refund claim`.
4. **The reconcile run can execute twice** (cron + "Abgleich starten"). Auto-booking must book each transaction once → Task 7 test `second run books nothing new`.
5. **`reverseCharge` on an incoming transaction**, or with a rate other than 0.19, must fail with a clear message, not post → Task 1 tests `rejects incoming` / `forces 19 %`.

---

### Task 1: §13b posting rule and accounts

**Files:**
- Modify: `src/server/lib/accounting/postingRules.ts` (`BankBookingMode`, `bankPosting`)
- Modify: `src/server/lib/accounting/skr04.ts` (add 1407, 3837)
- Test: `src/server/lib/accounting/__tests__/postingRules.test.ts`

**Interfaces:**
- Produces: `type BankBookingMode = 'normal' | 'vatOnly' | 'reverseCharge'`; `bankPosting(input)` unchanged signature; `REVERSE_CHARGE_RATE = 0.19` exported.

- [ ] **Step 1: Write the failing tests**

```ts
describe('bankPosting reverseCharge', () => {
  it('books expense gross + 1407 and 3837 at 19 % of gross, bank gross', () => {
    const lines = bankPosting({ direction: 'out', grossCents: 16842, account: '6837', vatRate: 0.19, mode: 'reverseCharge' });
    expect(lines).toEqual(expect.arrayContaining([
      { account: '6837', debitCents: 16842, creditCents: 0 },
      { account: '1407', debitCents: 3200, creditCents: 0 },   // round(16842 × 0.19) = 3200
      { account: '3837', debitCents: 0, creditCents: 3200 },
      { account: '1800', debitCents: 0, creditCents: 16842 },
    ]));
    expect(sum(lines, 'debitCents')).toBe(sum(lines, 'creditCents'));
  });
  it('rejects incoming', () => {
    expect(() => bankPosting({ direction: 'in', grossCents: 100, account: '4400', vatRate: 0.19, mode: 'reverseCharge' }))
      .toThrow(/nur für Ausgänge/);
  });
  it('forces 19 %', () => {
    expect(() => bankPosting({ direction: 'out', grossCents: 100, account: '6837', vatRate: 0.07, mode: 'reverseCharge' }))
      .toThrow(/19 %/);
  });
  it('still requires an account', () => {
    expect(() => bankPosting({ direction: 'out', grossCents: 100, account: '', vatRate: 0.19, mode: 'reverseCharge' })).toThrow();
  });
});
```

And in the skr04 test (or the same file): `SKR04_ACCOUNTS` contains `{ number: '1407', name: 'Abziehbare Vorsteuer nach § 13b UStG 19 %', type: 'asset', vatRate: 0.19 }` and `{ number: '3837', name: 'Umsatzsteuer nach § 13b UStG 19 %', type: 'liability', vatRate: 0.19 }`.

- [ ] **Step 2: Run, expect FAIL**

Run: `NODE_ENV=development npx vitest run src/server/lib/accounting/__tests__/postingRules.test.ts`

- [ ] **Step 3: Implement**

In `bankPosting`, handle `mode === 'reverseCharge'` before the normal path. Use German `PostingError` messages: "§13b nur für Ausgänge" and "§13b immer mit 19 %". VAT = `Math.round(gross × 0.19)`. Add the two accounts to `SKR04_ACCOUNTS`; `seedAccounts` upserts them at server start.

- [ ] **Step 4: Run, expect PASS**; also run `src/server/lib/accounting/__tests__` fully.

- [ ] **Step 5: Commit** `feat(ledger): §13b reverse-charge bank posting with accounts 1407/3837`

---

### Task 2: §13b through bookings, rules and UI

**Files:**
- Modify:
  - `src/server/routers/bookings.ts` (`bookFields.mode`)
  - `src/server/routers/suppliers.ts` (`fields.defaultMode`)
  - `src/server/models/Supplier.ts` (enum)
  - `src/server/lib/accounting/supplierImport.ts` (schema, `SupplierExport.defaultMode`, `toExport`)
  - `src/server/lib/accounting/suggest.ts` (mode mapping)
  - `src/server/lib/accounting/bankBooking.ts` (`rememberRule` keeps the account for `reverseCharge`)
- Modify:
  - `src/client/components/BookingDialog.tsx`, `src/client/components/RulesSection.tsx` (mode option; the account field is enabled for `reverseCharge`, and VAT is fixed at 19 %, shown disabled)
  - `src/client/pages/FinancePage.tsx` (`StreamSuggestion.mode`, outcome label)
  - `src/client/i18n/{de,en}.ts`
- Test: `src/server/routers/__tests__/bookings.test.ts`, `src/server/routers/__tests__/suppliers.test.ts`, `src/client/__tests__/financePage.test.tsx`

**Interfaces:**
- Consumes: Task 1 `BankBookingMode`.
- Produces: i18n keys `bookings.dialog.mode.reverseCharge` ("§13b Reverse Charge" / "§13b reverse charge") and `finance.outcome.reverseCharge` ("§13b"). The mode is accepted end to end as `'reverseCharge'`.

- [ ] **Step 1: Write failing tests**
  - `bookings.test.ts`, test `book reverseCharge posts 1407/3837 and keeps 1800 at gross`: book an outgoing 16842 tx with `{ account: '6837', vatRate: 0.19, mode: 'reverseCharge' }`. Then the trial balance shows 1800 = −16842, 1407 = 3200, 3837 = −3200, 6837 = 16842.
  - `bookings.test.ts`, test `reverseCharge on an incoming tx is a BAD_REQUEST`.
  - `suppliers.test.ts`, test `importJson round-trips defaultMode reverseCharge`: export shows `defaultMode: 'reverseCharge'`, and a re-import is `unchanged`.
  - `financePage.test.tsx`: a stream row with suggestion `mode: 'reverseCharge', account: '6837'` shows `✓ 6837 Lizenzen · §13b`, and one-click Buchen sends `mode: 'reverseCharge'`.
- [ ] **Step 2: Run the three files, expect FAIL**
- [ ] **Step 3: Implement**
  - Widen the zod enums and the Mongoose enum to `['normal', 'vatOnly', 'reverseCharge']`.
  - `suggest()` passes `defaultMode` through when it is one of the three, otherwise `'normal'`.
  - `rememberRule` sets `defaultAccount` for both `normal` and `reverseCharge`.
  - Dialog preview needs no change: `previewBankPosting` calls `bankPosting`.
- [ ] **Step 4: Run, expect PASS**, then lint and both typechecks.
- [ ] **Step 5: Commit** `feat(bookings): §13b mode in booking dialog, rules and import`. **Part A is done:** history log `history/2026-10-22_reverse-charge.md`, then PR and release after approval.

---

### Task 3: history derivation and suggestion fallback (server)

**Files:**
- Create: `src/server/lib/accounting/history.ts`
- Modify:
  - `src/server/lib/accounting/suggest.ts` (`Suggestion` type)
  - `src/server/routers/bookings.ts` (`stream`, `inbox`, `bookBulk`, `receiptMatches` use the fallback)
- Test: `src/server/lib/accounting/__tests__/history.test.ts`, `src/server/routers/__tests__/bookings.test.ts`

**Interfaces:**
- Consumes: Task 1 mode names; `normalizeIban` from `suggest.ts`.
- Produces:
  - `Suggestion` gains `matchedBy: 'iban' | 'purpose' | 'name' | 'history'` and `lastBookedAt?: Date`. `supplierId` and `kreditorNumber` become optional (absent for history). `supplierName` holds the counterparty name for history.
  - `deriveBooking(lines: PostingLine[]): { account: string; vatRate: number; mode: BankBookingMode } | null`
  - `historyKey(tx: { counterpartyIban?: string | null; counterpartyName?: string | null }): string | null`. The key is `iban:<normalised>`, else `name:<lowercased trimmed>`. It returns `null` for empty names or names starting with `(`.
  - `async loadHistory(): Promise<Map<string, { account: string; vatRate: number; mode: BankBookingMode; date: Date }[]>>`. It returns the newest 3 per key, from active entries with `source.kind: 'bank'` joined to their `BankTransaction` by `fireflyJournalId`.
  - `historySuggestion(tx, history): Suggestion | null`. It returns a suggestion only if 1–3 entries exist and all agree on account, vatRate and mode.
  - `suggestWithHistory(tx, suppliers, history) = suggest(tx, suppliers) ?? historySuggestion(tx, history)`, used by every router call site.

- [ ] **Step 1: Write failing unit tests** (`history.test.ts`):
  - `deriveBooking: normal 19 %`: lines 6837 10000 / 1406 1900 / 1800 −11900 → `{ account: '6837', vatRate: 0.19, mode: 'normal' }`.
  - `deriveBooking: vatOnly`: 1406 / 1800 only → `{ account: '', vatRate: 0.19, mode: 'vatOnly' }`.
  - `deriveBooking: reverseCharge`: lines including 1407/3837 → mode `'reverseCharge'`, account 6837.
  - `deriveBooking: 0 %`: 7610 / 1800 → vatRate 0.
  - `historyKey ignores placeholder names`: `{ counterpartyName: '(unknown destination)' }` → `null`; IBAN `'de02 1203…'` → `'iban:DE021203…'`.
  - `historySuggestion requires agreement`: two entries 6837 and one 6640 → `null`; three 6837 → a suggestion with `matchedBy: 'history'` and `lastBookedAt` = the newest date.
- [ ] **Step 2: Write failing router tests** (`bookings.test.ts`):
  - `stream suggests from history when no rule matches`: book tx A (IBAN X) to 6837. A new tx B with IBAN X gets `suggestion.matchedBy === 'history'` and `account === '6837'`.
  - `skips reversed entries`: book A, then unbook it → B gets no suggestion.
  - `rules win over history`: a rule for B's IBAN → `matchedBy === 'iban'`.
  - `bookBulk books history suggestions without supplierId`.
- [ ] **Step 3: Run, expect FAIL**
- [ ] **Step 4: Implement** `history.ts`, and switch the router call sites to `suggestWithHistory`. `loadHistory` is called once per request.
- [ ] **Step 5: Run, expect PASS**, then the full server suite.
- [ ] **Step 6: Commit** `feat(bookings): suggest from booking history when no rule matches`

---

### Task 4: history suggestions in the UI

**Files:**
- Modify:
  - `src/client/pages/FinancePage.tsx` (outcome label; `StreamSuggestion`: `supplierId?`, `kreditorNumber?`, `matchedBy`, `lastBookedAt?`)
  - `src/client/components/BookingDialog.tsx` (`InboxRowLike.suggestion.supplierId` optional)
  - `src/client/i18n/{de,en}.ts`
- Test: `src/client/__tests__/financePage.test.tsx`

**Interfaces:**
- Consumes: Task 3 `Suggestion` (`matchedBy`, `lastBookedAt`, optional `supplierId`).
- Produces: i18n `finance.outcome.history` = "wie am {date}" / "as on {date}".

- [ ] **Step 1: Failing test** `history suggestion shows "wie am" and books with one click`: a row with suggestion `{ matchedBy: 'history', account: '6837', vatRate: 0.19, mode: 'normal', supplierName: 'Alex Muster', lastBookedAt: '2026-09-03' }` shows `wie am 03.09.2026` and not `Regel …`. Buchen sends no `supplierId`.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** the label switch in `outcome()`. Only rows with a rule suggestion keep `Regel {name}`.
- [ ] **Step 4: Run, expect PASS**, plus lint and typecheck. Check the page in the running app with made-up data.
- [ ] **Step 5: Commit** `feat(finance): show history suggestions`. **Part B is done:** history log, then PR and release after approval.

---

### Task 5: available cash — computation, setting, endpoint

**Files:**
- Create: `src/server/lib/accounting/availableCash.ts`
- Modify:
  - `src/server/services/appSettings.ts` (`getTaxEstimateRate(): Promise<number>`, `setTaxEstimateRate(rate, updatedBy)`; `Setting` key `'tax'`, default 0.33)
  - `src/server/routers/settings.ts` (`getTaxRate` query, `setTaxRate` adminProcedure mutation, rate between 0 and 0.6)
  - `src/server/routers/ledger.ts` (`availableCash`)
- Test: `src/server/lib/accounting/__tests__/availableCash.test.ts`, `src/server/routers/__tests__/ledger.test.ts`

**Interfaces:**
- Produces:
  - `computeAvailableCash(input: { bankCents: number; balances: Map<string, number>; currentYearBalances: Map<string, number>; taxRate: number }): AvailableCash`. Balances are signed debit − credit per account. `balances` is cumulative over non-closed years; `currentYearBalances` covers the current fiscal year.
  - `AvailableCash = { bankCents; vatCents; provisionsCents; estimatedTaxCents; liabilitiesCents; availableCents; profitCents; taxRate }`. All deduction amounts are ≥ 0, in cents.
  - Constants exported: `VAT_ACCOUNTS = ['1401','1406','1407','3801','3806','3837','3820','3840','3841']`, `PROVISION_ACCOUNTS = ['3020','3035','3040']`, `LIABILITY_ACCOUNTS = ['3300','3500','3501']`, `INCOME_TAX_ACCOUNTS = ['7600','7608','7610','7641']`.
  - tRPC `ledger.availableCash({ year })` → `AvailableCash & { bankSource: 'firefly' | 'ledger'; asOf: Date; openCount: number }`.
- **Rules:**
  - VAT = max(0, −Σ balances of the VAT accounts).
  - Provisions and liabilities = max(0, −Σ balances).
  - Profit = −Σ current-year balances of accounts starting with 4, minus Σ of accounts starting with 6 or 7 that are not in `INCOME_TAX_ACCOUNTS`.
  - Estimated tax = max(0, round(rate × max(0, profit)) − Σ current-year debit balances of 7600/7608/7610).
  - Available = bank − VAT − provisions − estimated tax − liabilities. It may be negative.

- [ ] **Step 1: Failing unit tests:**
  - `subtracts VAT payable`: 3806 −1900, 1406 +300 → `vatCents` 1600.
  - `does not add a VAT refund claim`: 1406 +500 → `vatCents` 0, `availableCents` = bank.
  - `estimates tax on profit and nets prepayments`: 4400 −100000, 6837 +20000, 7610 +5000, rate 0.33 → profit 80000, estimate 26400 − 5000 = 21400.
  - `floors the estimate at 0`: a loss → 0.
  - `liabilities and provisions`: 3500 −21800, 3040 −2100 → 21800 and 2100.
- [ ] **Step 2: Failing router tests:**
  - `availableCash falls back to ledger 1800 when Firefly env is missing`: `bankSource: 'ledger'`.
  - `uses the tax rate setting`: after `settings.setTaxRate({ rate: 0.3 })`, `taxRate` is 0.3.
  - `setTaxRate is admin-only`: FORBIDDEN for role user.
- [ ] **Step 3: Run, expect FAIL**
- [ ] **Step 4: Implement.** Balances come from `trialBalance(entries)` over entries of fiscal years with status ≠ `closed`. The bank figure uses `FireflyClient.fetchBalance(today)` like `bookings.balanceCheck`, otherwise ledger 1800. `openCount` = the `bookings.stats` open count for the current year.
- [ ] **Step 5: Run, expect PASS**
- [ ] **Step 6: Commit** `feat(ledger): available cash after taxes and liabilities`

---

### Task 6: available cash in the UI

**Files:**
- Create: `src/client/components/AvailableCashCard.tsx`
- Modify:
  - `src/client/pages/FinancePage.tsx` (card above the summary bar)
  - `src/client/pages/DashboardPage.tsx` (rail card using the same component in `compact` mode)
  - `src/client/pages/SettingsPage.tsx` (admin field "Steuersatz für Schätzung (%)" with a hint to confirm it with the tax advisor)
  - `src/client/components/LedgerViews.tsx` (accept `initialView` / `initialAccount` props)
  - `src/client/i18n/{de,en}.ts`
- Test: `src/client/__tests__/availableCash.test.tsx` (new), `src/client/__tests__/financePage.test.tsx`

**Interfaces:**
- Consumes: Task 5 `ledger.availableCash`, `settings.getTaxRate`, `settings.setTaxRate`.
- Produces: `<AvailableCashCard year={number} compact?: boolean />`. Each deduction line links to `/finance?tab=journal&account=<first account of the group>`. FinancePage passes `account` from the URL into `LedgerViews` as `initialAccount` and `initialView='account'`.

- [ ] **Step 1: Failing tests:**
  - `shows each line and the result`: mocked data → texts "Kontostand", "− Umsatzsteuer (offen)", "= frei verfügbar" with formatted amounts.
  - `marks the estimate`: "Schätzung (33 %)".
  - `warns when transactions are open`: `openCount: 4` → "4 Umsätze noch nicht gebucht — Betrag vorläufig".
  - `says when the bank figure is from the ledger`: `bankSource: 'ledger'` → "laut Buchhaltung".
  - FinancePage: `/finance?tab=journal&account=3806` opens the account ledger on 3806.
- [ ] **Step 2: Run, expect FAIL**
- [ ] **Step 3: Implement** the card, the dashboard placement and the settings field (admin only; percent in the UI, fraction in the API). Each line carries a `title` with its formula and accounts, e.g. "Saldo 3806/3801/3837 − 1406/1401/1407 …".
- [ ] **Step 4: Run, expect PASS**, plus lint and both typechecks. Check in the running app: DE/EN, light/dark, 390 px.
- [ ] **Step 5: Commit** `feat(finance): frei verfügbar card, dashboard tile and tax-rate setting`. **Part C is done:** history log, then PR and release after approval.

---

### Task 7: automatic booking by rule

**Files:**
- Create: `src/server/lib/accounting/autoBook.ts`
- Modify:
  - `src/server/models/Supplier.ts` (`autoBook: Boolean, default false`)
  - `src/server/routers/suppliers.ts` (`fields.autoBook` optional)
  - `src/server/lib/accounting/supplierImport.ts` (schema, export, `patchOf`)
- Modify:
  - `src/server/models/ReconcileRun.ts` (`autoBooked: Number default 0`, `autoBookFailed: Number default 0`, `autoBookWarning: String`)
  - `src/server/cron/reconcile.ts` (call after `reconcilePendingTransactions`)
  - `src/server/routers/bookings.ts` (stream rows expose `entry.auto: boolean` = `createdBy === 'auto:reconcile'`)
- Modify:
  - `src/client/components/RulesSection.tsx` (checkbox "Automatisch buchen (täglich 07:30)" with the hint "nur bei Erkennung über IBAN oder Verwendungszweck"; table badge "auto")
  - `src/client/pages/FinancePage.tsx` (⋯ menu meta: "· {n} automatisch gebucht"; Erledigt badge "automatisch")
  - `src/client/i18n/{de,en}.ts`
- Modify (docs, same commit):
  - `AGENTS.md` (Invariants → automatic postings: the changed sentence from Global Constraints)
  - `docs/plans/2026-10-07-accounting-phase2.md` (Global Constraints → "Nothing posts without confirmation" amended with a pointer to this spec)
- Test: `src/server/lib/accounting/__tests__/autoBook.test.ts`, `src/server/routers/__tests__/reconcile.test.ts`, `src/server/routers/__tests__/suppliers.test.ts`, `src/client/__tests__/rulesSection.test.tsx`

**Interfaces:**
- Consumes: Task 3 `suggestWithHistory` (to get the suggestion; only rule matches qualify), `bookBankTransaction`, receipt helpers (`listReceiptFiles`, `rankReceipts`, `strongReceipt`, `driveForUser`), `getReceiptsFolder`.
- Produces:
  - `isAutoBookable(suggestion: Suggestion | null, supplier: { autoBook?: boolean | null } | null): boolean`. True only if `matchedBy` is `'iban'` or `'purpose'`, the supplier has `autoBook`, `vatRate` is set, and the mode is `vatOnly` or an account is set.
  - `async autoBookOpen(now: Date): Promise<{ booked: number; failed: number; warning?: string }>`.
    - It books the open transactions (via `openTransactions`) of every fiscal year that isn't `closed`, with `createdBy: 'auto:reconcile'`.
    - It attaches a `strongReceipt`, using Drive as the user in `Setting{ key: 'drive' }.updatedBy`. On a Drive failure: no receipt, plus a `warning`.
    - Per-row failures are counted, never thrown.

- [ ] **Step 1: Failing unit tests** (`autoBook.test.ts`, for `isAutoBookable`):
  - true for `{ matchedBy: 'iban', account: '6837', vatRate: 0.19, mode: 'normal' }` with `autoBook: true`
  - false for `matchedBy: 'name'`
  - false for `'history'`
  - false without the flag
  - false for `mode: 'normal'` without an account
  - true for `vatOnly` without an account
- [ ] **Step 2: Failing integration tests** (`reconcile.test.ts`, via `runReconcile({ skipSync: true })`):
  - `auto-books flagged IBAN rules and records the count`: one flagged rule, two matching open txs plus one name-matched tx → `run.autoBooked === 2`, two entries with `createdBy: 'auto:reconcile'`, and the name-matched tx stays open.
  - `second run books nothing new`: a second `runReconcile` → `autoBooked === 0`, still exactly two bank entries.
  - `skips closed fiscal years`: a tx dated in a `closed` year stays open.
  - `Drive failure books without receipt and warns`: `listReceiptFiles` rejects → booked, `autoBookWarning` set.
- [ ] **Step 3: Failing tests for the surface:**
  - `suppliers.test.ts`: `importJson round-trips autoBook`.
  - `rulesSection.test.tsx`: saving with "Automatisch buchen" checked sends `autoBook: true`.
- [ ] **Step 4: Run, expect FAIL**
- [ ] **Step 5: Implement** `autoBook.ts`, the model fields, the reconcile hook (after invoice matching; inside the existing try, but auto-book errors never set `run.error`), the UI and the docs update.
- [ ] **Step 6: Run the full suite** (serial command from Global Constraints), lint and both typechecks; then UI check in the running app.
- [ ] **Step 7: Commit** `feat(bookings): opt-in automatic booking for IBAN/purpose rules in the daily reconcile`. **Part D is done:** history log, then PR and release after approval. On servyy-test, verify one Ofelia run with a flagged rule on test data.
