# Booking automation and available money — Design

> Status: all decisions recorded 2026-10-22. Parts A–D are planned in `2026-10-22-booking-automation-plan.md`; Part E gets its own plan after D.

## Intent

The Finanzen inbox works, but every transaction that no rule covers still has to be booked by hand. In practice these are reimbursements to the two partners (Spesen, domains, software subscriptions) and tax office payments. They are rare per counterparty and vary in content, so writing a rule per case doesn't help. The owner wants these booked **without manual entry**, and wants to see at a glance **how much money is really available**: the bank balance minus what is already owed to the tax office by law.

## Goals

1. Foreign suppliers (Miro, GoDaddy, Google) can be booked correctly as **§13b reverse charge**.
2. A transaction with no rule still gets a one-click suggestion from **how the same counterparty was booked before**.
3. Selected rules book **automatically** during the daily reconcile run, with no click.
4. A **"frei verfügbar"** figure: bank balance minus open VAT, tax provisions, estimated tax on this year's profit and open liabilities. Every part can be traced to its accounts.
5. A transaction with a matched receipt but no other suggestion gets one **read from the receipt**, including mixed VAT rates and §13b detection. It goes through the shared opencode server (Part E).

## Non-goals

- No full tax return or DATEV export.
- No cash-flow forecast (future invoices, planned payments).
- No legal or tax advice inside the app. Account choices remain the owner's; queen only remembers and repeats them.
- Previous-year taxes that are neither provisioned (3020/3035/3040) nor booked are not estimated.

## Anti-goals (a failure even if it technically works)

- **Silent wrong bookings:** an automatic booking the owner didn't opt into, or that can't be spotted and reversed in one click.
- **An untraceable "frei verfügbar" number:** a figure that can't be explained line by line, back to the accounts.
- **A broken GoBD invariant:** journal entries are still never edited or deleted. Corrections stay reversals.

## Constraints (unchanged from the accounting spec unless stated)

- Money in integer cents. VAT rates 0, 0.07 and 0.19. Net = `round(gross / (1 + rate))`.
- Journal writes only through `ledger.ts` (`post`, `postOnce`, `reverse`). Bank source is `{ kind: 'bank', refId: <fireflyJournalId> }`.
- **Changed invariant:** "Nothing posts without confirmation" becomes "Nothing posts without confirmation **except rules an admin explicitly marked `autoBook`**". `AGENTS.md` and the accounting spec must be updated in the same change.
- Company figures (rate, amounts) are entered in the UI only, never in git.
- UI: i18n DE/EN, CSS variables only, `table.resp`, checked in light/dark/mobile.

## Part A — §13b reverse charge mode

**Booking mode** `reverseCharge` next to `normal` and `vatOnly`, for **outgoing transactions only**, at a fixed 19 %:

| Line | Soll | Haben |
|---|---|---|
| Expense account | gross | |
| 1407 Abziehbare Vorsteuer nach § 13b UStG 19 % | 19 % × gross | |
| 3837 Umsatzsteuer nach § 13b UStG 19 % | | 19 % × gross |
| 1800 Bank | | gross |

- The bank amount is the net price because no VAT was paid. Vorsteuer and Umsatzsteuer cancel out for the VAT payable.
- **New SKR04 accounts:** 1407 and 3837. `seedAccounts` adds missing accounts at server start, so production gets them with the next release.
- **Where the mode is available:** booking dialog, rule dialog, JSON import/export and `suggest()`. The preview shows all four lines.
- **Incoming transactions** with `reverseCharge` are rejected with a German error.
- *Builder's call:* whether the VAT figure rounds per line (it's a single line, so it's half-up on 19 % × gross).

## Part B — "Wie zuletzt" suggestions from history

If no rule matches an open transaction, `suggest()` falls back to history:

1. Find the **last three** active bank entries whose transaction has the same normalised `counterpartyIban`. If there's no IBAN, use the same `counterpartyName`, case-insensitive, ignoring Firefly placeholders like "(unknown destination)".
2. Derive `{ account, vatRate, mode }` from each entry's lines:
   - The account is the line that is neither bank nor VAT.
   - The rate is the VAT/net ratio, snapped to an allowed rate.
   - The mode is `vatOnly` if there is no expense line, `reverseCharge` if 1407/3837 are present, otherwise `normal`.
3. **Only suggest when all found entries agree.** If they differ (Finanzamt KöSt vs. USt, Spesen vs. domains), there's no history suggestion and the row keeps "Keine Regel". This prevents repeating the wrong account for mixed counterparties.
4. The suggestion carries `matchedBy: 'history'` and the date of the last booking. The UI shows "✓ 6837 … · wie am 03.09.2026" instead of "Regel …".
   - One-click Buchen and bulk booking accept it.
   - **Auto-booking never uses history suggestions.**
5. Rules always win over history.

*Builder's call:* how to query this efficiently. Per inbox load, build one map from counterparty to its last three bookings for the year range shown, rather than querying per row.

## Part C — "frei verfügbar"

A card in the Finanzen summary, and a tile on the dashboard:

```
Kontostand GLS                         from Firefly (fallback: ledger 1800), date shown
− Umsatzsteuer (offen)                 net balance of 1401/1406/1407 vs. 3801/3806/3837/3820/3840/3841;
                                       only subtracted if it is a liability (a refund claim is not cash)
− Steuerrückstellungen                 credit balances 3020, 3035, 3040
− geschätzte Steuer lfd. Jahr          rate × max(0, profit before income taxes this fiscal year)
                                       − income-tax prepayments already booked this year (7600, 7608, 7610), floored at 0
− offene Verbindlichkeiten             credit balances 3300, 3500, 3501
= frei verfügbar
```

- **Period:** account balances are cumulative over every fiscal year that isn't closed, up to today, because opening entries carry closed years forward. The profit estimate covers the current fiscal year only.
- **Profit before income taxes:** revenue accounts (4xxx) minus expense accounts (6xxx, 7xxx), **excluding** 7600, 7608, 7610 and 7641. Non-deductible shares (e.g. 30 % of Bewirtung) are ignored; it's an estimate and labelled as such.
- **Rate:** set in Einstellungen (admin), stored as a `Setting`. The default is **33 %** (KöSt 15 % + Soli 5.5 % of that = 15.825 %, plus GewSt 3.5 % × Munich's Hebesatz 490 % = 17.15 %; total 32.975 %). The owner doesn't know the right figure yet, so the card labels it "Schätzung (33 %)", and the settings field links a note to confirm it with the tax advisor.
- **Traceability:** each line links to its Kontoblatt (account ledger) or to the ledger filtered to its accounts. A tooltip states the formula.
- **Honesty about gaps:** if the inbox still has open transactions, the card says "n Umsätze noch nicht gebucht — Betrag vorläufig". If the bank balance is unavailable, the card shows the ledger figure and says so.
- **Server:** a new `ledger.availableCash({ year })` returns every component in cents plus the inputs (rate, profit, open count). The pure computation lives in `lib/accounting/availableCash.ts` with unit tests.

## Part D — automatic booking by rule

- **Rule flag:** suppliers get `autoBook: boolean`, default `false`, editable by admins in the rule dialog and via JSON import/export.
- **When:** at the end of `runReconcile` (the Ofelia cron at 07:30 and `reconcile.runNow`), after sync and invoice matching.
- **What:** open transactions of non-closed fiscal years whose **rule** suggestion is complete, whose rule has `autoBook`, and which the rule matched **by IBAN or Verwendungszweck**. Name-pattern matches never auto-book (decided 2026-10-22). The rule dialog explains this next to the checkbox. They are booked exactly like bulk booking, including attaching a clear receipt match.
- **Drive access in the cron:** the user who last saved the Drive folder setting (`Setting.updatedBy`). If that fails, the row is booked without a receipt and the run records a warning.
- **Traceability:**
  - `createdBy: 'auto:reconcile'` on the entry.
  - `ReconcileRun.autoBooked` count, shown in the ⋯ menu ("07:30 · 3 automatisch gebucht").
  - An "automatisch" badge on those rows in Erledigt. Reversing works as for any booking.
- **Safety:**
  - Auto-booking is per rule and off by default.
  - History suggestions and rules without account or VAT never auto-book.
  - Failures don't fail the reconcile run; they're counted and shown.

## Part E — reading receipts (via the opencode server, free models)

- **When:** for an open transaction with a clear receipt match but no rule or history suggestion, a "Beleg auslesen" action, or optionally an automatic run during reconcile.
- **What it does:** sends the receipt's **text** to an LLM through the shared opencode server and asks for:
  - vendor and country
  - invoice date and total
  - VAT lines by rate
  - whether it's reverse charge
  - the best-fitting account from queen's account list
- **What the owner sees:** the result becomes a suggestion with `matchedBy: 'receipt'`. It is never auto-booked, and the extracted figures are shown next to the suggestion so they can be checked.
- **Mixed VAT rates** (e.g. a 2026 restaurant bill with 7 % food and 19 % drinks) need **split bookings**: one bank transaction posted to several account/VAT lines. That's a new posting shape (`bankPosting` with several lines) and a sub-feature of this part.
- **Transport:** there is no Anthropic API key. queen uses the opencode server (`opencode.web`, code.lehel.xyz) like job-search and devhub do:
  - A new `X-Api-Key` for queen goes through the `opencode-authgate` forwardAuth route.
  - The flow is `POST /api/session` → `POST /api/session/:id/prompt` → poll `GET /api/session/:id/message`, plus `GET /api/model` for the registry.
  - Reuse the contract of `job-search/packages/api/src/ai/opencode.ts`: polling, unavailable retries, model registry.
  - The key is provisioned through Ansible in servyy-container (`templates/finance/queen.env.j2` plus the authgate key list), git-crypt only.
  - servyy-test has no `opencode-authgate`, so the integration can only be verified on production. Unit tests mock the HTTP contract.
- **Input:** text only. The current models are text models, so queen extracts the PDF's text layer server-side and sends that. Receipts without a text layer (scans, photos) get no suggestion and stay manual.
- **Data minimisation:** IBANs and BICs are masked in the text before sending. The prompt includes only the account numbers and names, not balances or other transactions.
- **Models (decided 2026-10-22):** free models, with the backoff dontforget uses (`dontforget/src/search/opencodeClient.ts`):
  - An ordered list of free models. Each model gets up to **3 attempts**, waiting `1000 ms × 2^(attempt−1)` (1 s, then 2 s) between them.
  - Replies are polled every 1 s with a **120 s** timeout.
  - When a model has used its attempts, the next model is tried; the last error is thrown when all are exhausted.
  - **The list comes from the live registry** `GET /api/model`: models that are active, enabled and cost 0. Preferred ids come first, configured in env `QUEEN_OPENCODE_MODELS`, comma-separated `provider:id`. dontforget hard-codes its list and broke when `mimo-v2.5-free` was retired.
  - **No paid fallback.** If every free model fails, the row simply gets no receipt suggestion. It shows "Beleg konnte nicht gelesen werden", and the next attempt happens on the next run or click.
  - IBAN/BIC masking stays.
- **Privacy:** the owner agreed (2026-10-22) to receipts being read by an LLM, including free-tier models whose providers may use inputs for training. IBAN/BIC masking reduces what leaves the server.

## Order and shipping

Each part is its own branch, PR and release; servyy-test first, then production.

1. **A §13b mode:** small. Prerequisite for correct foreign-supplier bookings in B, D and E.
2. **B history suggestions:** small to medium.
3. **C frei verfügbar:** medium; independent of A and B.
4. **D auto-booking:** small to medium. Changes the invariant, so it ships with the docs update.
5. **E receipt reading plus split bookings:** largest; only after the decision below.

## Decisions (2026-10-22)

1. **Receipt reading:** yes, through the opencode server instead of a direct API key, using free models with dontforget's backoff (Part E).
2. **Tax rate:** unknown. The default is 33 %, shown as an estimate and editable in Einstellungen; confirm with the tax advisor.
3. **Auto-booking scope:** only rules matched by IBAN or Verwendungszweck.

## Verification

- Unit tests for:
  - the §13b posting (balanced; the four lines)
  - the history derivation (agreeing vs. disagreeing entries, placeholders)
  - the `availableCash` arithmetic (refund claim not subtracted, prepayments, floor at 0)
  - auto-booking selection (flag off, history, incomplete rule, closed year)
- Router tests through `appRouter.createCaller` with mongodb-memory-server.
- UI checked in DE/EN, light/dark and mobile.
- On servyy-test after release: `/health`, one Ofelia reconcile run with an `autoBook` rule on test data.
