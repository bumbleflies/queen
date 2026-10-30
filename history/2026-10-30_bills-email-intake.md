# Bills email intake (Gmail → PDF → receipts folder → `Bill`)

**Shipped:** 2026-10-30 · replaces the reverted `feat: bills email intake` (0.27.0, #195)

## What it does

Vendor invoices that arrive at the `bills@bumbleflies.de` mailbox are read by a
job, and each PDF attachment is:

1. filed into the Drive receipts folder as `<receipts>/<year>/<date> <vendor> <invoice no.> <amount>.pdf`,
2. parsed (vendor, invoice number, net/VAT/gross, IBAN, due date, reverse charge),
3. stored as a `Bill` document keyed by `(messageId, attachmentId)` plus a
   content hash, so re-runs never duplicate.

The **`/bills`** page lists them with the payment each bill belongs to, and an
admin can pull the mailbox on demand ("Jetzt abrufen"); the nightly job does the
same without a click.

## Why it looks like this

The reverted attempt wrote `BankTransaction` rows for bills that had not been
paid, and created/extended supplier rules from PDF text. Both are wrong in this
repo: `BankTransaction` *is* the bank statement (the booking inbox, the auto-book
run and the cash/tax estimate all read it), and rules/`Supplier` documents are
admin-owned (`AGENTS.md`). A bill that arrived is not a payment.

So intake has exactly two write paths: a Drive file and a `Bill` document. It
never touches `BankTransaction`, `Supplier`, `Counter` or `JournalEntry`.

Matching comes from two places:

- the PDF now sits in the receipts year folder, so the existing
  `rankReceipts` → `receiptReader` pipeline proposes it when the real payment
  arrives (name includes date, amount and vendor on purpose);
- `lib/bills/matchBill.ts` pairs a bill with an existing outgoing transaction
  for the `/bills` page and the finance-inbox hint (exact amount required,
  IBAN/invoice number/vendor/date only raise the score; equal candidates mean
  "no match"). It is a suggestion and never books.

## Access

`GMAIL_SCOPES` gained `gmail.readonly`, so every admin's next sign-in grants it.
The job acts as the admin who last saved the Drive settings
(`googleAccessForCron()`, the same credential `driveForCron()` uses). A token
minted before the scope existed fails with a Google scope error, which the
"Jetzt abrufen" button reports as "bitte neu anmelden".

Mailbox: `QUEEN_BILLS_MAILBOX`, default `bills@bumbleflies.de`.

## Ops

- Entrypoint: `node dist/src/server/cron/billIntake.js` (Ofelia `job-exec`,
  after the 06:00 GLS import and before the 07:30 reconcile).
- Query window is 14 days and ingestion is idempotent, so a missed run catches
  up on the next one.
- A PDF that cannot be filed is **not** recorded: the next run retries it.
  Diffs of failures are in the run log and in the `errors` array of the result.

## Tests

- `lib/bills/__tests__/parseBill.test.ts` — German/English amounts, VAT only when
  stated, reverse charge, missing fields stay empty, no date mistaken for a total.
- `lib/bills/__tests__/matchBill.test.ts` — exact amount, no incoming payments, no
  payment before the bill, ties produce no match.
- `jobs/__tests__/billIntake.test.ts` — nested multipart + `attachments.get`,
  idempotency, content dedupe, `noText` scans, filing failure retried, **no**
  bank/supplier/ledger writes, year folder creation.
- `routers/__tests__/bills.test.ts` — bill ↔ payment pairing, admin gating,
  ignore keeps the row.
