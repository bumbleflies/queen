# 2026-11-17 — Bill intake replies in each mail's own thread

## Problem

The confirmation mail introduced on 2026-11-03 was a **new** message, composed once
per run and sent only by the cron entrypoint (`cron/billIntake.ts` did the send;
`bills.intakeNow` did not). Two consequences:

- The "Jetzt abrufen" button on the Finanzen → Belege tab filed bills but never
  mailed anything, so the same job behaved differently depending on who started
  it.
- A run that caught up on several mails produced one summary with no link to the
  mails it described. In the mailbox nobody could tell which vendor mail had been
  handled, replied to or missed — and a reply to the summary had no thread.

## What changed

- **The reply is sent inside the job** (`runBillIntake`), through a new optional
  `sendReply` dependency that production wires to `GmailService.sendMail`. Cron
  and "Jetzt abrufen" now run the identical code path; `sendIntakeConfirmation`
  and its call in the cron are gone.
- **One reply per incoming mail, in that mail's own Gmail thread.** The intake
  already reads each message, so the reply carries that message's `threadId` to
  `users.messages.send` and sets `In-Reply-To`/`References` from the original
  `Message-ID`. It goes to the mailbox itself, keeps the original subject with a
  single `Re:` (never doubling `Re:`/`AW:`), and is RFC-2047 encoded when the
  subject is not plain ASCII.
- **Only a mail that produced a bill is answered.** `parsed` and `noText` count;
  `skipped` (already known) does not, so the 14-day query window, the hourly
  schedule and repeated clicks stay silent. A `failed` bill that a later run
  repairs does count. A mail whose attachments all failed sends nothing — its
  failures are listed only inside a reply that has at least one recorded bill.
- **The reply text is per mail, not per run:** vendor, invoice number and gross
  per bill (omitted when unreadable — never a guessed `0,00 €`), the year folder,
  the processing time in `Europe/Berlin`, the attachments of *that* mail that
  failed, and the `…/finance?tab=bills` link. Plain text only.
- **A send failure never fails intake.** It lands on the result as
  `notifyErrors` (plus a `notified` counter) and the cron only warns; `created`/
  `failed` and the exit code are untouched.

## Why

A confirmation is useful only where it can be read: under the mail it answers. It
also makes the "Jetzt abrufen" button honest — the admin who clicks it sees the
same mailbox result the hourly job would produce — and it removes a second
delivery path (cron-only) that could drift from the job.

No mail loop: the intake query is `has:attachment`, and the reply carries no
attachment, so a reply can never match the query. Commented in
`jobs/billIntake.ts`.

## Files changed

- `src/server/lib/bills/intakeMail.ts` — `intakeReply()` (per-message composer, subject prefix, Berlin clock) (+ rewritten test).
- `src/server/services/GmailService.ts` — `threadId`, `In-Reply-To`, `References` on `OutgoingMail`/`buildRawMail`, `threadId` passed to `messages.send` (+ tests).
- `src/server/jobs/billIntake.ts` — reply per mail inside `runBillIntake`, `sendReply`/`appUrl` deps, `notified`/`notifyErrors` on the result, `createdBills` and `sendIntakeConfirmation` removed.
- `src/server/cron/billIntake.ts` — no send of its own; logs `notified` and warns per `notifyErrors` entry.
- `src/server/routers/bills.ts` — `intakeNow` documents that it replies too (no code change needed: it runs the same job).
- `src/server/jobs/__tests__/helpers/intakeFixtures.ts` — shared Gmail/Drive fakes for the job and router tests.
- `AGENTS.md`, `docs/plans/2026-11-17_intake-threaded-reply.md`.

## Verification commands

```bash
npx vitest run src/server/lib/bills/__tests__/intakeMail.test.ts \
  src/server/services/__tests__/gmailSend.test.ts \
  src/server/jobs/__tests__/billIntakeMail.test.ts
npm run lint && npm run typecheck && npm run typecheck:server && npm run build
```

The DB-backed tests (`jobs/__tests__/billIntake.test.ts`,
`routers/__tests__/bills.test.ts`) need `mongodb-memory-server` and run in CI's
`pr-tests` job; locally they skip without a database.

## Success criteria

- A bill mailed to `bills@` is answered **once**, in that mail's thread, by both
  the hourly job and the "Jetzt abrufen" button — and the answer lists exactly
  the bills of that mail plus its own failed attachments.
- A re-run over the same mail, an idle run, and a mail whose PDFs all failed send
  nothing at all.
- A token without `gmail.send` still files every bill; the log carries
  `Bill intake confirmation not sent: …` and the process exits 0.
- Nothing is booked, matched to an invoice or taught as a rule from a mail, and
  the reply itself never becomes a bill mail.

## Known issues

- Needs the one-time `gmail.send` re-consent through Settings → **Google-Zugang**
  (the scope was added on 2026-11-03; a token minted before that cannot send).
  Until then the bills keep arriving and only the reply is missing.
- A mail with several PDFs gets one reply, not one per PDF: the thread belongs to
  the mail.

## Future enhancements

- A per-day digest if bill volume ever makes per-mail replies noisy.
- HTML mail or a label on handled mails, if the mailbox gets busy enough.
