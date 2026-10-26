# Receipt-first booking and learned rules — Design

> Status: decisions recorded 2026-10-22. Extends
> [`2026-10-22-booking-automation.md`](2026-10-22-booking-automation.md) (parts D and E) and
> [`2026-10-22-multi-receipt-reading.md`](2026-10-22-multi-receipt-reading.md).
> Implementation plan follows separately.

## Intent

Receipt reading works, but its result is only a suggestion for rows that have **no** rule, and a
rule is only written when someone remembers to tick a checkbox. In practice the inbox still shows
"No rule" for recurring cases — e.g. a partner reimbursement whose Verwendungszweck carries a Drive
link (`Spesen-ChrisD-202601-Rn70 … SecureGo`) — and every rule-booked row goes without an attached
receipt. The owner wants the inbox to arrive **pre-classified**: every row already has a complete
suggestion, booking is one click (or one click for the whole screen), and an action is only needed
when there is no receipt and no learned rule.

## Goals

1. Read receipts for **every** open outgoing row with a clear Drive candidate, not only for rows
   without a suggestion, and attach the matching receipt to the posting.
2. A **matched receipt set** (totals add up exactly) always classifies the row: single account or
   split, with the VAT of each receipt. The suggestion is complete, so one click books it.
3. **Every confirmed single-account booking teaches a rule** (IBAN → name → purpose prefix), so the
   next occurrence is pre-classified without any data entry.
4. Surface a **conflict** when a rule and a receipt disagree, instead of silently preferring one.
5. Split bookings (collective reimbursements) stay receipt-driven; a purpose-prefix fallback rule can
   be created in one action when no receipt set adds up.

## Non-goals

- No silent posting. Receipts and learned rules produce suggestions; posting needs a click (bulk
  included) unless an admin marked a rule `autoBook` (unchanged, Part D).
- No rule synthesis from split bookings, no rule holding a list of split parts or amounts.
- No reading of incoming transactions, no OCR, no automatic change of an existing rule from a
  receipt.
- No new tax logic; account choices remain the owner's and can be corrected per rule.

## Anti-goals (a failure even if it technically works)

- **A learned rule that hides a better receipt:** a rule must never suppress the receipt reading, and
  a disagreement must be visible before anything is posted.
- **Learning from a collective reimbursement:** an IBAN rule for a partner must not pin one receipt's
  account onto the next transfer.
- **An untraceable learning event:** every learned rule shows that it was learned, when, and can be
  edited or archived like any other rule.

## Constraints (unchanged unless stated)

- Journal writes only through `ledger.ts`; receipts and rules never post by themselves.
- Money in integer cents, VAT per line, rates 0 / 0.07 / 0.19; §13b only outgoing.
- Receipt readings remain a cache, not accounting data; `receiptMatch` is the winning set.
- Only the receipt's text layer leaves the server, IBAN/BIC masked; at most 3 receipts per
  transaction.
- UI: i18n DE/EN, CSS variables, `table.resp`, light/dark/mobile.

## Part F — receipt-first classification

### Reading queue

`readOpenReceipts` (daily reconcile) reads **all** open outgoing rows of non-closed fiscal years that
have a clear Drive candidate (`receiptCandidates` non-empty), regardless of whether a rule matches.
Order:

1. rows with no suggestion (nothing else can classify them),
2. rows with a suggestion but no attached receipt and no stored reading,
3. rows whose files previously failed, oldest attempt first.

The cap rises from 10 to **25 per run** (`QUEEN_RECEIPTS_PER_RUN` override), so a backlog of rule
rows does not starve the interesting ones. Readings stay cached per file (`ok`/`noText` final), so the
second run is nearly free. A new `bookings.readReceiptsNow({ year })` runs the same loop for one year
on demand ("alle Belege jetzt lesen").

### Suggestion precedence and conflict

The order stays **rule → history → receipt**, unchanged for rows where nothing contradicts.

- A matching receipt set is attached to the posting in every case (rule, history or receipt), so
  "Belege fehlen" drops for rule-booked rows.
- **Agreement:** the rule suggestion is kept; the receipt is attached.
- **Conflict:** totals match (the receipt really belongs to this transaction) but the account, VAT
  rate or mode differs from the rule. The row is flagged `conflict`, shows both sides
  (`Regel: 6837 · 19 % — Beleg: 6640 · 7 %`), one-click booking and bulk booking are refused for that
  row, and the dialog opens with both choices. `autoBookOpen` skips conflict rows.
- **No rule:** the receipt reading is the suggestion (today's behaviour), complete for one click.
- Receipt lines are never merged with rule lines: it is one side or the other.

The server computes this in `suggestForTx`: the rule/history suggestion is compared against
`readingToSuggestion(...)` whenever a `receiptMatch` exists, and `conflict` carries the receipt's
alternative (account, VAT rate, mode or split parts). Conflict is never inferred from a mere
candidate file — only from a matched set whose totals equal the bank amount.

### Attaching the document

`BankTransaction.receiptMatch.driveFileIds` names the files, but the posting needs
`{ driveFileId, fileName, link }`. Per-file readings therefore store the Drive `link` as well
(already known at read time). `bookBankTransaction` attaches the **first file of the matched set**
when the caller passed no receipt; that covers single, bulk, receipt-driven and auto bookings without
a further Drive call. The remaining files of a set stay part of the merged reading.

## Part G — learned rules

### What is learned

`bookBankTransaction` is the only write path, so learning happens there after a successful `post` and
covers single, bulk, receipt-based and auto bookings. A confirmed **single-account** booking creates
or extends a rule:

- key: normalised **IBAN** when the transaction has one, else the **counterparty name** as a name
  pattern, else a **purpose prefix** (the leading part of the Verwendungszweck, cut before a URL or
  a number run of six or more digits, separators trimmed, at most 40 characters — `Spesen-ChrisD-202601…`
  teaches `Spesen-ChrisD`);
- values: account, VAT rate, mode (the existing `rememberRule` semantics);
- extending an existing rule updates those three values, exactly as today. The rule that matched the
  row is found with the same `suggest()` logic, so learning extends a rule instead of duplicating it.

The `rememberRule` checkbox in the dialog is removed; remembering becomes the default and not a
choice. A non-admin booking against an `autoBook` rule still goes through, but leaves that rule
untouched (only an admin changes a rule that books automatically).

### What is not learned

- **Split bookings.** Several expense lines cannot be expressed as one rule, and remembering one
  receipt's account would repeat it on the next transfer. Collective reimbursements stay receipt-driven.
- **Bookings not attributable to the counterparty.** Learning into an IBAN rule only when there is no
  receipt suggestion or the receipt vendor agrees with the counterparty name. A partner
  reimbursement (vendor "Augustiner", counterparty "Christian Dähn") therefore teaches nothing.
- **Rows where the counterparty has a manual rule:** the manual rule is extended, not duplicated.
- **Incoming payments.** A learned rule only describes outgoing rows, so it never suggests a booking
  for an incoming payment (that belongs to an invoice); manual rules keep matching both directions.

### Fallback for reimbursements without a receipt

The existing prefilled "Regel anlegen" button on a no-suggestion row creates the purpose-prefix
fallback (`Spesen-ChrisD` → Spesen account) in one action. It is an ordinary manual rule and shows up
as such; no special code path.

### Learned rules in the UI and data

`Supplier.origin: 'manual' | 'learned'` and `learnedAt`. JSON export/import carries neither (an
imported rule is `manual`). The Regeln tab shows a `gelernt` badge and the date, with a note that
learned rules never post automatically. `autoBook` remains an explicit admin tick and keeps its
current meaning; learning never turns silent posting on.

## Part H — inbox and dialog

- **A complete suggestion per row.** Receipt suggestion: split lines or `✓ 6640 · 7 %`, plus
  `Beleg: 3 Belege · 54,60 €`. Rule suggestion: as today, plus the attached receipt or
  `Regel ≠ Beleg` with both sides.
- **One click.** The existing row "Buchen" and the subbar bulk button ("alle n Vorschläge buchen")
  are the only actions needed; the split checkbox in the dialog remains for the rare manual override.
- **Done tab.** Rows booked with a matched receipt show the receipt; learned-rule rows are
  indistinguishable from other rule bookings except for their rule's badge in the Regeln tab.
- **Menu.** "alle Belege jetzt lesen" next to sync/run actions, reporting how many were read.
- The summary line keeps counting "ohne Regel"; with learned rules and receipt reading it should
  approach zero, which is the visible measure of success.

## Rollout

One branch, PR and release, servyy-test first, production after approval:

1. schema + learning in `bookBankTransaction` (tests).
2. conflict detection in `suggestForTx`, bulk/auto guards, attach-from-match.
3. reading queue change + `readReceiptsNow` + UI.

After the servyy-test release: check `/health`, run one reconcile, confirm that rule-booked rows got
their receipt attached and that a conflicting rule+receipt row is not auto-booked.

## Verification

- Unit: learning (IBAN / name / purpose, extend, split skipped, vendor≠counterparty skipped), conflict
  detection (agreeing vs. differing account/rate/mode, no conflict without a matched set), reading
  queue (rule rows included, cap, retry order), attach-from-match.
- Router (`appRouter.createCaller`, mongodb-memory-server): bulk refuses a conflict row, `autoBookOpen`
  skips it, learning on book, `readReceiptsNow` bounded and idempotent.
- UI tests for the row states, the bulk label and the Regeln badge; DE/EN, light/dark, mobile.
- Manual: the screenshot case (partner reimbursement with a Drive link) gets a complete split
  suggestion; a second occurrence of a normal vendor books from its learned rule with the receipt
  attached.

## Decisions (2026-10-22)

1. **Trust model:** learn, then automate — but always as a complete suggestion with one click; no
   silent posting beyond existing `autoBook` rules.
2. **Learning trigger:** every confirmed single-account booking teaches; no checkbox.
3. **Reimbursements:** receipts decide the split; a purpose-prefix rule is the manual fallback.
4. **Reading scope:** all open outgoing rows with a clear candidate, 25 per run plus an on-demand
   action.
