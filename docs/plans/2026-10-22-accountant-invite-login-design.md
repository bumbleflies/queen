# Accountant sign-in — Design

> Status: implemented 2026-10-22 in `feat/accountant-invite-login`; see
> [`history/2026-10-22_accountant-invite-login.md`](../../history/2026-10-22_accountant-invite-login.md).
> Plan: `2026-10-22-accountant-invite-login-plan.md`.

## Intent

Only people with a `@bumbleflies.de` Google account can sign in to queen today. The
accountant has no such account, so she cannot reach the books at all — no ledger, no
booking inbox, no year-end reports. She needs her **own** login, so that `createdBy`
on journal entries and bookings names her rather than whoever lent her a session.

The alternative — a Workspace seat or a second Google OAuth project — is blocked for
reasons recorded below, which is why this design does not use Google at all for her.

## Current state (verified 2026-10-22)

- **One sign-in path:** `src/server/routes/auth.ts` registers `passport-google-oauth20`
  only; `/auth/google` → `/auth/google/callback` → `queen_token` cookie (12 h JWT).
  `LoginPage.tsx` renders a single Google button.
- **The access boundary is the Google consent screen, not queen's code.**
  `upsertUserFromProfile()` accepts any profile that completes consent;
  `AuthService.matchesEntry()` only decides admin vs user. If that consent screen is
  ever External + Published, any Google account can sign in as `role: 'user'` — which
  already permits `bookings.book`, `invoices.cancel` and `ledger.postManual`.
  **This is an independent risk, unrelated to the accountant, and must be confirmed
  in the Google Console (project 391372270100 → OAuth consent screen).**
- **queen reuses the leagues.finance OAuth client**
  (`ansible/.../finance/queen.env.j2`: `GOOGLE_CLIENT_ID={{ leagues_finance.google_client_id }}`).
  The redirect URI is now registered: `GET https://queen.bumbleflies.de/auth/google`
  reaches Google's sign-in page without `redirect_uri_mismatch`.
- **Prod is live**, not gated as `AGENTS.md` claims: `https://queen.bumbleflies.de/health`
  returns 200 and `/` serves the client bundle (see
  `servyy-container/history/2026-10-06_queen-prod-enablement.md`).
- **Drive is per-user:** `driveForUser(ctx.user.sub)` needs `User.refreshToken`; without
  it, folder picker, receipt listing and PDF filing throw. `driveForCron()` already
  contains the "act as the admin who saved the Drive settings" fallback.

## Goals

1. The accountant signs in to queen with her own identity, without a Google account.
2. Every booking, invoice action and journal entry she makes carries her `_id` in
   `createdBy`.
3. Her access can be withdrawn in one action, taking effect immediately.
4. The existing Google login keeps working exactly as it does today.
5. She can do her actual work: booking, receipt review, ledger, reports.

## Non-goals

- Email + password, password reset, TOTP/2FA.
- SMTP/email delivery of invite links.
- Self-service signup or self-service "request access".
- A read-only `viewer` role (see D6 — separate increment if wanted).
- A second Google Cloud project or Workspace seats.
- Changing anything about the Google login path for existing users.

## Anti-goals (a failure even if it technically works)

- **An unrevokable session.** A disabled accountant who can still post journal entries
  for weeks defeats the point of disabling her.
- **Unattributable postings.** Any path where her actions land under another user's
  `_id` (in particular: silently impersonating the Drive-settings admin for *writes*
  she initiates would blur attribution — Drive is a file store, the ledger is not;
  see D5).
- **A token that leaks into logs.** Proxy logs, referers and browser history are the
  realistic leak paths; a 7-day credential must not sit in any of them.
- **A silently broken Drive path.** "No refresh token" must surface as a clear German
  message, never as a 500 or an empty receipt list.

## Decisions

### D1 — The accountant gets a queen-owned login, not a Google one

Rationale: the OAuth consent screen's user type is **per Google Cloud project**. The
accountant cannot be admitted as an isolated exception in project 391372270100 without
either an Internal-visible Workspace account or an External consent screen — and
External + published drags `drive.readonly` (a sensitive scope) into Google's
verification process, which is weeks of calendar time, not hours of work. A separate
signed link inside queen is days of work and does not touch the client used by
leagues.finance and bumbleflies/live.

### D2 — One-time signed invite link, hash-only storage, 7-day default TTL

An admin issues a link; the link is valid **168 h (7 days)** by default, overridable
with `INVITE_TTL_HOURS` (env) so it can be raised to 30 days without a deploy.

Storage: `sha256(token)` only. The plaintext token exists in the HTTP response that
created it and nowhere else — not in the DB, not in the log. A DB dump therefore
yields no working links.

Single use: redeeming `$unset`s the invite fields in the same operation that mints the
session, so a second click lands on the "already used" page.

### D3 — Long session for invited users, checked per request via `tokenVersion`

A 7-day link with a 12-hour session would mean she asks for a new link at every
sitting, which is worse than a password. Therefore:

- `User.tokenVersion: number` (default 0).
- `signToken(payload, { tokenVersion })` — **only invite redemption sets it**, as a
  `tv` claim. Google logins keep today's 12 h token with no `tv`.
- Rule: *a token with `tv` is checked, a token without `tv` is not.*
  `requireAuth` (express) and `buildContext` (tRPC) become async and, when `tv` is
  present, do one indexed `User.findById` verifying `disabled !== true` and
  `tokenVersion === tv`.
- Invited sessions last **30 days**. "Deaktivieren" sets `disabled: true` *and*
  increments `tokenVersion`; "alle Sitzungen beenden" is the increment alone. Both take
  effect on her next request.
- Cost: one extra `findById` per request for exactly one user. No cache.

### D4 — The token travels in the URL fragment

Link shape: `<CLIENT_URL>/invite#<token>`. A small client page reads `location.hash`
and `POST`s to `/auth/invite/redeem`.

Rationale: a token in the path or query is written to Traefik's access log, echoed in
`Referer` headers, and stored in browser history. The fragment is never sent to the
server, so it reaches queen only inside the POST body. This costs one client route and
one POST endpoint; the alternative leaks a 7-day credential into infrastructure logs.

### D5 — `driveForActor(userId)` for Drive without a Google account

She will have no `refreshToken`. New helper in `services/driveForUser.ts`:

- user has `refreshToken` → `driveForUser(userId)` (unchanged behaviour for everyone else)
- user has none → `driveForCron()`, i.e. the admin who last saved the Drive settings,
  already used by the nightly job
- neither → `TRPCError` `PRECONDITION_FAILED` with a German message naming the missing
  Drive configuration

Explicitly **not** a `try/catch` fallback: if her own token exists but fails, that is an
error, not an invitation to impersonate.

Because the fallback token sees the fallback admin's *whole* Drive, the folder picker
(`settings.browseDriveFolders`) moves to `adminProcedure` — it is an admin task anyway.
`receipts.list`, `bookings.receiptMatches` / `readReceipt` / `setReceipt` and PDF filing
use `driveForActor`.

Accepted consequence: while acting as the fallback admin, the Drive API cannot tell her
apart from that admin. Ledger and booking attribution stay hers, because those writes
carry `ctx.user.sub`; Drive is a file store with no audit requirement of its own.

### D6 — `role: 'user'`, not admin

She books: `bookings.book`, `invoices.markSent`/`markPaid`/`cancel` and
`ledger.postManual` are `authedProcedure`, so `user` is sufficient. `admin` would add
booking rules, imports, fiscal-year control and user management — not her job.

A read-only `viewer` role is a **separate increment** if it turns out she should not
write. It needs guards on roughly eight procedures and is not part of this design.

### D7 — No email delivery

There is no mail transport in the stack. Adding nodemailer + SMTP credentials for one
link per quarter is not justified. The admin copies the link from the dialog and hands
it over out of band (Signal, WhatsApp, password manager). Delivery by mail can be added
later behind the same endpoint without changing anything else.

## Data model

`User` (`src/server/models/User.ts`) gains:

| Field | Type | Purpose |
|---|---|---|
| `inviteTokenHash` | `String` (indexed) | `sha256` of the live invite token |
| `inviteExpiresAt` | `Date` | TTL from `INVITE_TTL_HOURS` (default 168) |
| `invitedBy` | `String` | admin `_id`, for the audit trail |
| `disabled` | `Boolean` | absent = active; set instead of deleting users |
| `lastLoginAt` | `Date` | shown in the admin list |
| `tokenVersion` | `Number`, default 0 | bumps to kill live sessions |

Unchanged: `email` (unique), `role` (`admin` \| `user`), `googleId`, `refreshToken`.
Users are **never deleted** — `createdBy` references must stay resolvable.

## Flows

**Invite (admin).** `users.invite({ email, role })` → upsert user by email, generate
`randomBytes(32).toString('base64url')`, store `sha256`, set expiry and `invitedBy`,
return `{ url, expiresAt }` once. Re-inviting overwrites the hash, killing the old link.

**Redeem (invitee).** Client page splits `/invite#<token>`, `POST /auth/invite/redeem
{ token }` → hash → `findOne({ inviteTokenHash, inviteExpiresAt: { $gt: now },
disabled: { $ne: true } })` → `$unset` invite fields, set `lastLoginAt`, sign a 30-day
`tv` token, set the existing `queen_token` cookie (same `authCookieOptions()`), respond
`{ ok: true }`; the client navigates to `/`.

**Failures.** Unknown/expired/redeemed/disabled all resolve to the same generic
"Link ungültig oder abgelaufen" notice on the login page — no oracle telling an
attacker whether an address has an account.

**Login page.** One additional line: "Kein Google-Konto? Zugangslink beim Administrator
anfordern", plus the error notice. Keys in `de.ts` and `en.ts`.

## Admin screen

Settings page gets a "Benutzer" section (`adminProcedure` only):

- `users.list` — email, role, disabled, `lastLoginAt`, invite expiry, has-Google, has-Drive
- `users.invite` — dialog with the link and a copy button, shown once
- `users.revokeInvite` — clears the hash (kills a leaked link)
- `users.setRole` / `users.setDisabled` — disabling also bumps `tokenVersion`

## Security notes (what we accept)

- 256-bit token, single use, hash-only storage, 7-day default TTL, revocable.
- The link is a bearer credential for its lifetime; interception before first use is the
  residual risk. Mitigations: single use, revoke, observed expiry date in the dialog.
- No brute-force limiter on `/auth/invite/redeem`: at 256 bits of entropy it buys
  nothing. Rate limiting would matter only if the token were short or human-chosen.
- No 2FA for her. If that changes, TOTP on top of the session is a later increment.
- Cookie unchanged: `httpOnly`, `sameSite=lax`, `secure` in production.
- The Console check from "Current state" (consent screen user type) stays open and is
  tracked as its own risk, not as part of this change.

## Verification

- Tests (vitest + `mongodb-memory-server`, mirroring `routes/__tests__/auth.test.ts`):
  plaintext token never persisted; redeem sets cookie and clears the hash; replay
  rejected; expired rejected; disabled rejected; `INVITE_TTL_HOURS` respected;
  `tokenVersion` bump invalidates a live session; invite/list/disable are admin-only;
  `driveForActor` falls back only when `refreshToken` is absent; `browseDriveFolders`
  is admin-only.
- Manual, on servyy-test: invite → redeem → book a transaction → journal entry carries
  her `_id`; disable her → next request 401; `browseDriveFolders` visible only to admins.
- Then prod (queen is live there — see "Current state").

## Docs to update in the same change

- `AGENTS.md`: sign-in invariants — Google OAuth for `@bumbleflies.de`; invited users
  redeem a one-time fragment link; invited sessions carry `tv` and are checked per
  request; `driveForActor` fallback and why the folder picker is admin-only.
- `docs/plans/2026-10-06-queen.md` (Task 2 auth) and the prod-gating statement, which
  no longer matches reality.
- `history/YYYY-MM-DD_accountant-invite-login.md` when it ships.

## Open questions

1. `viewer` role — needed, or is `user` right for her? (D6 assumes `user`.)
2. Does the Console check change the Google path? If the consent screen turns out to be
   External + Published, a domain allowlist in `upsertUserFromProfile` becomes urgent on
   its own merits and should ship independently of this design.
