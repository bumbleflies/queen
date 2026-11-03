# 2026-11-03 — Hourly bill intake and its confirmation mail

## Problem

Bill intake (`jobs/billIntake.ts`, shipped in #199 and hardened through #218) only ran once a day, in the same Ofelia job as the 07:30 reconcile. A vendor invoice that arrived in the morning sat in the mailbox until the next day, so it was missing from the Belege tab — and from any bank row it should have been matched to — for up to 24 hours. And nothing in the mailbox said whether the intake had seen a mail at all.

An attempt to solve both (PR #239, "hourly email intake via Bull queue + reply to bills@bumbleflies.de") was closed: it was built on the reverted #195 commit, re-introduced creating `BankTransaction`s and learned `Supplier` rules from a PDF, conflicted on `GmailService.ts` and did not typecheck.

## Solution

- **Hourly schedule instead of a Bull repeat job.** Intake is idempotent per (message, attachment) and per content hash, so running it every hour costs one Gmail list call and files nothing twice. It stays an Ofelia `job-exec` of `node dist/src/server/cron/billIntake.js` — the same entrypoint pattern the reconcile job uses; no queue, no long-lived Bull process, nothing to keep alive between runs. The schedule lives in `servyy-container` (`finance/docker-compose.yml`), not in this repo.
- **One confirmation mail per run that filed something.** `lib/bills/intakeMail.ts` composes the mail from what the run did (date, vendor, file name, gross — blank when the PDF had no readable total, never a guessed `0,00 €`), lists scans and failed reads only when there are some, and links `…/finance?tab=bills`. `intakeMail()` returns `null` for a run with no new bills, so an idle hourly run stays silent.
- **`GmailService` can send.** `buildRawMail` produces a plain-text RFC 5322 message (CRLF, base64 body wrapped at 76, RFC 2047 subject for umlauts) and deliberately omits `From`: Gmail only accepts the authenticated account or one of its aliases. `sendMail` posts it as `me`.
- **`gmail.send` joins `GOOGLE_SCOPES`.** An already-connected admin token does not carry it, so `sendMail` throws a sentence naming the missing scope and the cron only warns — the bills are filed regardless, and the next run after re-connecting sends the mail.

## Files changed

- `src/server/lib/bills/intakeMail.ts` — mail text/subject, pure (+ tests).
- `src/server/services/GmailService.ts` — `send?` on `GmailClientLike`, `buildRawMail`, `sendMail` (+ tests).
- `src/server/jobs/billIntake.ts` — `createdBills` on the result, `intakeAppUrl`, `sendIntakeConfirmation`.
- `src/server/cron/billIntake.ts` — sends the summary, warns on failure.
- `src/server/routes/auth.ts` — `gmail.send` scope.
- `AGENTS.md`, `.env.example` (`QUEEN_BILLS_MAILBOX`, `QUEEN_APP_URL`).

## Deployment results

- To be filled in after the servyy-container schedule change and the deploy.

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

## Success criteria

- A bill mailed to `bills@` is on the Belege tab within the hour, without waiting for the 07:30 run.
- A run that files a bill sends exactly one mail to the same mailbox, linking the Belege tab; a run without new bills sends nothing.
- A token without `gmail.send` still files the bills; only the mail is skipped, with a warning in the Ofelia log.
- Nothing is booked, matched to an invoice or taught as a rule from a mail.

## Known issues

- The confirmation mail needs a one-time admin re-login to grant `gmail.send`; until then the intake works and only the mail is skipped.
- One mail per run: after a long downtime the first run reports every bill it catches up on in one message.

## Future enhancements

- Reply in the bill's own thread instead of sending a new message to the mailbox.
- A per-day digest if bill volume ever makes per-run mails noisy.
