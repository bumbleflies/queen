# 2026-10-22 — Sign-in links for people without a Google account

## Problem

queen had exactly one way in: Google OAuth, which only admits `@bumbleflies.de`
accounts. The accountant has no such account, so she could not reach the books at
all — no ledger, no booking inbox, no year-end reports. Lending her an admin session
was the only workaround, and it would have put somebody else's `_id` into
`createdBy` on every entry she books — unacceptable for a GoBD-relevant ledger, where
the journal must show who did what.

The obvious Google fix was checked first and ruled out: `upsertUserFromProfile`
accepts any Google profile, so the bumbleflies-only boundary *is* the OAuth consent
screen. Its user type is a per-project setting, and the project queen shares with
leagues.finance is configured for one organisation. Adding a single external address
would mean a second Google Cloud project (new consent screen) plus verification for
the sensitive Drive scope.

## Solution

**One-time invite links, with no password and no mail.**

- `users.invite {email, role}` (admin only) mints a 256-bit token, stores only its
  `sha256` (`users.inviteTokenHash`) and an expiry (`inviteExpiresAt`, default 168 h,
  overridable with `INVITE_TTL_HOURS`), and returns the link **once**:
  `<CLIENT_URL>/invite#<token>`. The admin copies it and sends it however they
  like — no SMTP was wired up.
- The token sits in the URL **fragment**, which browsers never transmit, so it stays
  out of proxy logs, `Referer` headers and server access logs. `InvitePage` reads it,
  clears it from the address bar with `replaceState`, and POSTs it to
  `/auth/invite/redeem`.
- Redemption is one atomic
  `findOneAndUpdate({ inviteTokenHash, inviteExpiresAt: { $gt: now }, disabled: { $ne: true } })`
  that also unsets the hash: single use even if the link is clicked twice at the same
  moment. Re-inviting replaces the hash and silently kills the old link;
  `users.revokeInvite` does the same on purpose.
- **Sessions:** invited users get 30 days instead of 12 hours. Their JWT carries a
  `tv` (tokenVersion) claim, and `assertSessionValid` compares it against the user
  document on every request — so `users.setDisabled` (which bumps `tokenVersion`)
  ends their session immediately. Google sessions have no `tv` and keep the original
  zero-read fast path.
- **Drive:** the accountant has no Google refresh token, so `driveForActor()` borrows
  the credentials of the admin who last saved the Drive settings — the same account
  the nightly reconcile already uses. It is not a fallback after a failure: if her own
  token exists but is dead, that is her error. Because that borrowed token can see
  its owner's whole Drive, `settings.browseDriveFolders` became admin-only.
- **Admin surface:** a `Benutzer` card on Settings lists everyone with role, last
  sign-in, Drive state and whether an invite is still open; it invites, revokes,
  changes roles and disables. Users are disabled, never deleted, and no admin can
  demote or disable themselves.

## Main files

- `src/server/lib/inviteToken.ts` (new), `src/server/models/User.ts`
- `src/server/services/AuthService.ts` (`tv`, `assertSessionValid`,
  `SESSION_HOURS`, `INVITE_SESSION_DAYS`), `src/server/trpcInit.ts`,
  `src/shared/types.ts`
- `src/server/routes/auth.ts` (`POST /invite/redeem`, async `requireAuth`)
- `src/server/routers/users.ts` (new), `src/server/trpc.ts`
- `src/server/services/driveForUser.ts` (`driveAccessForActor`, `driveForActor`),
  `src/server/routers/{receipts,bookings}.ts`, `src/server/jobs/FileInvoiceJob.ts`,
  `src/server/routers/settings.ts`
- `src/client/pages/InvitePage.tsx` (new), `src/client/components/UsersSection.tsx`
  (new), `src/client/pages/{LoginPage,SettingsPage}.tsx`, `src/client/main.tsx`
- `src/client/i18n/{de,en}.ts`
- Tests: `__tests__/{inviteToken,sessions,users,inviteRedeem,driveForActor}.test.ts`
  (new), `InvitePage.test.tsx`, `UsersSection.test.tsx`, plus fixture updates in
  `bookings`, `reconcile`, `availableCash`, `folderPicker`, `i18n-rollout`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

The dev container is Alpine, so `mongodb-memory-server` cannot start and the DB suites
skip. Verified against a throwaway `mongo:7` container (temporary, removed
afterwards) with `MONGO_URI=… NODE_ENV=development npx vitest run --no-file-parallelism`:
**619/619 tests pass**.

## Success criteria

- An invited person opens the link once and lands signed in, with her own `_id` in
  `createdBy` for everything she books.
- The plaintext token exists only in the API response that created it — never in the
  database, logs or the address bar.
- An expired, already-used, revoked or disabled invite is refused with one clear
  message and a way back to sign-in.
- Deactivating a user ends her live session on the next request.
- She can file and read receipts without a Google account of her own.

## Known issues

- The link has to be delivered by hand (chat, mail client); queen sends nothing.
- If the Drive-settings admin's Google token dies, receipt filing fails for invited
  users with "Zugang abgelaufen — bitte in den Einstellungen neu verbinden" until an
  admin reconnects.
- `refreshToken` is still stored in plaintext (pre-existing TODO).
- The Google path still has no admission check of its own; only the consent screen
  stands between "External, published" and "anyone may book".

## Future enhancements

- A read-only `viewer` role for people who should see reports but not book.
- Mail delivery of the invite link (nodemailer is already a dependency).
- Audit trail of admin actions (who invited, disabled or re-roled whom).

## Deployment results

Pending (servyy-test first, prod with explicit approval). `INVITE_TTL_HOURS` has a
safe default, so no env change is required to deploy.
