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

## Follow-up 0.28.1 (same day, from the first live click)

Two bugs the first production click exposed:

1. **The cron entrypoint never ran.** `isCliEntrypoint` was hard-coded to
   `cron/reconcile`, so `node dist/src/server/cron/billIntake.js` printed nothing
   and exited 0 — the feature was inert again, in the same way as the PR it
   replaced. `isCliEntrypoint(argv1, script)` now takes the job name, and a test
   pins that a job does not fire for another job's file.
2. **A 5xx never reaches the browser as JSON.** Traefik replaces 5xx bodies with
   its HTML error page, so the thrown `BAD_GATEWAY` surfaced as
   `Unexpected token '<', "<!DOCTYPE "`. Expected failures are now returned
   (`{ ok: false, error }`) with HTTP 200 and a sentence that says what to do;
   that is also how the real cause became visible: the Gmail API was not enabled
   in the Google Cloud project of the shared OAuth client.

Verified: `node dist/src/server/cron/billIntake.js` now prints the configuration
error and exits, and `bills.intakeNow` answers with the API-disabled hint.

## Follow-up 0.28.2 (2026-10-31, from the first real fetch)

Enabling the Gmail API made the fetch reach Drive, and all uploads failed with
`part.body.pipe is not a function` — a **pre-existing regression from the
`googleapis` 189 bump** (#194, in 0.27.0), not something the intake introduced.

`uploadInvoicePdf` passed the PDF as a `Buffer`. With `media` **and**
`requestBody` googleapis-common builds a `multipart/related` body and calls
`part.body.pipe(...)`, so a Buffer throws before any request is sent
(reproduced locally without network). It never showed up because prod had
issued no invoice since the bump — `uploadInvoicePdf` had never actually
succeeded there (`invoices` with `driveMetadata.filedAt`: none), so
"Ausstellen & ablegen" was broken as well. Fixed by streaming
(`Readable.from([buffer])`) and typing the media body as `Readable`; a test pins
the contract by piping the body back and comparing bytes.

## Follow-up 0.28.3 (2026-10-31, second real fetch)

Uploads worked, one bill filed, one failed:

```
Bill intake: 26-B001-103855369-98848178.PDF: The user has not granted the app
391372270100 write access to the file 1in5M3AZVMXdDu4dpGgrgENVNc-pETbHt.
Bill intake done: messages=6 attachments=2 created=1 skipped=0 noText=1 failed=1
```

The app's OAuth scope is `drive.file`, which grants write access only to files
**the app created**. That PDF was filed by hand in August (owner: a colleague,
in `überwiesen/2026/`), so `uploadInvoicePdf`'s name collision → `files.update`
was refused. The file was the same document, already in the right place.

`uploadInvoicePdf` now takes `ifExists: 'replace' | 'skip'`: invoice filing keeps
`replace` (the app created those PDFs), bill intake passes `skip` and returns the
existing file — no write, no duplicate, and a vendor PDF is never overwritten.
For the remaining `replace` case a foreign file now produces a sentence an admin
can act on instead of Google's bare message.

## Follow-up 0.28.4 (2026-10-31, first parsed bill)

The intake filed its first bill and stored it as `noText` with

```
error: Please provide binary data as `Uint8Array`, rather than `Buffer`.
```

pdf.js (via `unpdf`) refuses a Node Buffer **by name**. Gmail attachments are
Buffers, so `extractPdfText` threw on **every** e-mailed bill — the intake filed
them all and parsed none, which would have made amount/vendor matching
impossible. It now normalises the input to a plain `Uint8Array`, and a test pins
it with a real Buffer from pdfkit.

Related: a thrown extraction is now `failed`, not `noText`. `noText` is final (a
scan), `failed` means "we do not know yet" and is retried on the next run
(updated in place — a bill is still never deleted), so a fix like this one
repairs the bills it broke instead of leaving them as scans forever.

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
