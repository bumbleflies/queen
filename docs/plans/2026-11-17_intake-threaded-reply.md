# Plan: bill intake answers each mail in its own thread

Date: 2026-11-17. Status: shipped with the change described here.
Predecessor: [`2026-11-03_bill-intake-hourly-mail.md`](../../history/2026-11-03_bill-intake-hourly-mail.md),
whose "Future enhancements" this plan executes.

## Problem

The bill mailbox receives vendor invoices; intake files them and needs to tell us
it did. The 2026-11-03 solution sends one summary **per run**, as a **new**
message, from the cron entrypoint only. So a clicked "Jetzt abrufen" filed bills
silently, and a summary covering several mails could not be traced back to the
mails it described — nobody in the mailbox could see which mail had been handled.

## Decisions

1. **The reply is part of the job, not of the entrypoint.** `runBillIntake` sends
   it through a `sendReply` dependency (production: `GmailService.sendMail`). The
   hourly cron and `bills.intakeNow` therefore cannot diverge; the old
   `sendIntakeConfirmation` helper is removed.
2. **One reply per incoming mail, in that mail's Gmail thread.** The reply carries
   the message's `threadId` and the original `Message-ID` as `In-Reply-To` and
   `References`, goes to the mailbox itself, keeps the subject with a single
   `Re:` and no `From` (Gmail fills in the authenticated account).
3. **Only a mail that produced a bill is answered.** `parsed` and `noText` count;
   `skipped` does not, so the 14-day window, the hourly schedule and repeated
   clicks stay silent. A repaired `failed` bill counts. A mail whose attachments
   all failed gets no reply; its failures are listed inside a reply that has at
   least one recorded bill.
4. **The reply text is per mail:** vendor, invoice number, gross (omitted when
   unreadable), the year folder, the processing time in `Europe/Berlin`, the
   failed attachments of that mail, and the `…/finance?tab=bills` link. Plain
   text only, German, no guessed amounts.
5. **A send failure is a warning.** It lands on the result (`notifyErrors`,
   `notified`), never in `failed`, never in the exit code: the bills are filed.
6. **No mail loop.** The intake query is `has:attachment` and a reply carries no
   attachment, so the reply cannot be ingested as a bill mail.
7. **No new dependency.** `buildRawMail` already produces RFC 5322 messages, so
   `nodemailer` stays unused for this.

## Out of scope

- No per-day digest (only worth it if per-mail replies become noisy).
- No HTML mail and no template engine.
- No Gmail labels, no filters, no "seen"/"unread" handling in the mailbox.
- No reply for a mail whose bills were all already known or all failed.

## Verification

Unit tests for the composer and the mail builder, DB tests for the job and the
router (one reply per mail, silence on a re-run, repairs, a throwing send), plus
`npm run lint`, both typechecks and `npm run build`. Locally the DB tests skip
without a database; CI's `pr-tests` runs them.
