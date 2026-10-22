# Accountant Invite Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the accountant sign in to queen with her own identity, without a Google account, and take that access away again immediately.

**Architecture:** A new public endpoint `POST /auth/invite/redeem` trades a one-time token (stored only as `sha256`) for the same `queen_token` cookie everyone else gets. Invited sessions carry a `tv` (tokenVersion) claim and last 30 days; tokens *with* `tv` are checked against the user document on every request, tokens *without* it (Google) keep today's zero-read 12 h path. Drive calls go through `driveForActor()`, which borrows the Drive-settings admin's credentials for users who have none.

**Tech Stack:** TypeScript, Express 5, Mongoose 9, tRPC 11, zod, React 19, vitest + supertest + mongodb-memory-server.

**Spec:** `docs/plans/2026-10-22-accountant-invite-login-design.md` (read first — it carries the decisions D1–D7 and the reasons).

## Global Constraints

- Decisions are fixed: 7-day default invite TTL (`INVITE_TTL_HOURS`, env-overridable), 30-day invited session, fragment delivery, `role: 'user'`, no SMTP, no password, no TOTP, no `viewer` role.
- `role: 'user'` may book, cancel invoices and post manual ledger entries. That is intended for her.
- Users are **never deleted** — `createdBy` on journal entries and bookings must stay resolvable. Disable, don't delete.
- The plaintext invite token must exist in exactly one place: the HTTP response of `users.invite`. Never in the DB, never in a log.
- The Google login path must be unchanged in behaviour: 12 h, no per-request DB read.
- Every UI string goes through `t()` with keys in **both** `de.ts` and `en.ts` (`de.ts` is the source of `DictKey`).
- Full local check: `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.
  Focused run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism <path>` — `NODE_ENV=development` is required or DB tests skip silently.
- Conventional Commits, one commit per task, feature branch, PR; never commit to `master`.

## Review Focus

1. **`tv` must never appear on a Google token.** If it does, every request of every user gains a DB read and the disable semantics change silently. Task 2 test `google token has no tv`.
2. **Redemption must be atomic.** `findOneAndUpdate` with the hash in the filter — not `findOne` + `save` — or two clicks in flight both mint a session. Task 4 test `concurrent redeem → exactly one session`.
3. **The plaintext token must not be persisted.** Task 3 test `stores only the hash` greps the stored document for the returned token.
4. **`browseDriveFolders` must be admin-only before the fallback lands.** Otherwise she can walk the firm's whole Drive through the borrowed admin token. Task 5 covers it.
5. **Disabling must bump `tokenVersion`.** Without the bump a 30-day session outlives the disable. Task 3 test `setDisabled kills a live session`.
6. **An invite for an existing user must not wipe their Google data.** `$set` only — never `replaceOne`, or an invited-to-admin `googler` loses `refreshToken` and `googleId`.

---

### Task 1: User fields and invite-token helpers

**Files:**
- Create: `src/server/lib/inviteToken.ts`
- Modify: `src/server/models/User.ts`
- Test: `src/server/lib/__tests__/inviteToken.test.ts`

**Interfaces:**
- Produces: `DEFAULT_INVITE_TTL_HOURS = 168`, `inviteTtlHours(raw?)`, `generateInviteToken(): string`, `hashInviteToken(token): string`, `inviteExpiry(now: Date, hours?)`.
- Produces on `UserDoc`: `inviteTokenHash`, `inviteExpiresAt`, `invitedBy`, `disabled`, `lastLoginAt`, `tokenVersion`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INVITE_TTL_HOURS,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteTtlHours,
} from '../inviteToken';

describe('inviteTtlHours', () => {
  it('defaults to 168 h (7 days)', () => {
    expect(DEFAULT_INVITE_TTL_HOURS).toBe(168);
    expect(inviteTtlHours(undefined)).toBe(168);
    expect(inviteTtlHours('')).toBe(168);
    expect(inviteTtlHours('abc')).toBe(168);
    expect(inviteTtlHours('0')).toBe(168);
    expect(inviteTtlHours('-5')).toBe(168);
  });

  it('honours a configured value', () => {
    expect(inviteTtlHours('720')).toBe(720);
    expect(inviteTtlHours('36.9')).toBe(36);
  });
});

describe('invite tokens', () => {
  it('is 256 bits, url-safe and unique', () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes to a stable sha256 hex', () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
    expect(hashInviteToken(token)).not.toBe(hashInviteToken(generateInviteToken()));
    expect(hashInviteToken(token)).not.toContain(token);
  });
});

describe('inviteExpiry', () => {
  it('adds the ttl to the given instant', () => {
    const now = new Date('2026-10-22T10:00:00.000Z');
    expect(inviteExpiry(now, 7).toISOString()).toBe('2026-10-29T10:00:00.000Z');
    expect(inviteExpiry(now, 168).toISOString()).toBe('2026-10-29T10:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/lib/__tests__/inviteToken.test.ts`
Expected: FAIL — `Cannot find module '../inviteToken'`.

- [ ] **Step 3: Implement**

```ts
// src/server/lib/inviteToken.ts
import crypto from 'crypto';

/**
 * 7 days: long enough that a link survives a week of vacation, short enough
 * that a leaked link is worthless soon. Overridable per deployment
 * (`INVITE_TTL_HOURS`), because the invitee's cadence is a business decision.
 */
export const DEFAULT_INVITE_TTL_HOURS = 168;

export function inviteTtlHours(raw: string | undefined = process.env.INVITE_TTL_HOURS): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_INVITE_TTL_HOURS;
}

/** 256 bits, url-safe: the token travels in a URL fragment. */
export function generateInviteToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Only the hash is stored — a DB dump must not yield working links. */
export function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function inviteExpiry(now: Date, hours: number = inviteTtlHours()): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
```

Add to `src/server/models/User.ts` inside the schema object:

```ts
    inviteTokenHash: { type: String, index: true },
    inviteExpiresAt: { type: Date },
    invitedBy: { type: String },
    disabled: { type: Boolean },
    lastLoginAt: { type: Date },
    /** Bumped to kill live sessions; carried as `tv` by invite-redeemed tokens. */
    tokenVersion: { type: Number, default: 0 },
```

- [ ] **Step 4: Run the tests, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/lib/__tests__/inviteToken.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/inviteToken.ts src/server/lib/__tests__/inviteToken.test.ts src/server/models/User.ts
git commit -m "feat(auth): add invite token helpers and user session fields"
```

---

### Task 2: `tv` claim, 30-day sessions, per-request check

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/services/AuthService.ts`
- Modify: `src/server/trpcInit.ts` (`buildContext` becomes async)
- Modify: `src/server/app.ts:33-40` (`createContext` awaits)
- Modify: `src/server/routes/auth.ts` (`requireAuth` async, cookie maxAge parameter)
- Test: `src/server/services/__tests__/sessions.test.ts`
- Test: `src/server/__tests__/trpc.test.ts:100` (await `buildContext`)

**Interfaces:**
- Produces: `SESSION_HOURS = 12`, `INVITE_SESSION_DAYS = 30`, `signToken(payload, opts?: { expiresInSeconds?: number })`, `assertSessionValid(payload): Promise<void>`.
- Produces: `JwtPayload.tv?: number`.
- Consumes: `User.tokenVersion`, `User.disabled` (Task 1).

- [ ] **Step 1: Write the failing tests**

```ts
// src/server/services/__tests__/sessions.test.ts
import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../../models/User';
import { assertSessionValid, signToken, verifyToken } from '../AuthService';

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('session tokens', () => {
  it('google token has no tv and survives a bump', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'g@bumbleflies.de', role: 'admin', googleId: 'g1' });
    const payload = verifyToken(signToken({ sub: String(user._id), email: 'g@bumbleflies.de', role: 'admin' }));
    expect(payload.tv).toBeUndefined();
    await assertSessionValid(payload); // never touches the DB
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    await expect(assertSessionValid(payload)).resolves.toBeUndefined();
  });

  it('invited token carries tv and is rejected after a bump', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'a@example.de', role: 'user' });
    const token = signToken(
      { sub: String(user._id), email: 'a@example.de', role: 'user', tv: 0 },
      { expiresInSeconds: 30 * 24 * 3600 },
    );
    const payload = verifyToken(token);
    expect(payload.tv).toBe(0);
    await expect(assertSessionValid(payload)).resolves.toBeUndefined();
    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    await expect(assertSessionValid(payload)).rejects.toThrow(/revoked/);
  });

  it('invited token is rejected when the user is disabled', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'b@example.de', role: 'user', disabled: true });
    const payload = verifyToken(signToken({ sub: String(user._id), email: 'b@example.de', role: 'user', tv: 0 }));
    await expect(assertSessionValid(payload)).rejects.toThrow(/revoked/);
  });

  it('rejects a token whose tv is not a non-negative integer', () => {
    expect(() => verifyToken(signToken({ sub: 'x', email: 'x@y.de', role: 'user', tv: -1 }))).toThrow(/invalid token payload/);
    expect(() => verifyToken(signToken({ sub: 'x', email: 'x@y.de', role: 'user', tv: 1.5 }))).toThrow(/invalid token payload/);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/services/__tests__/sessions.test.ts`
Expected: FAIL — `assertSessionValid` is not exported; `tv: 0` is dropped from the payload.

- [ ] **Step 3: Implement**

`src/shared/types.ts`:

```ts
export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'user';
  /** Present only on invite-redeemed sessions — triggers the per-request user check. */
  tv?: number;
}
```

`src/server/services/AuthService.ts` — replace `signToken`/`verifyToken` and add the check:

```ts
export const SESSION_HOURS = 12;
export const INVITE_SESSION_DAYS = 30;

export function signToken(payload: JwtPayload, opts: { expiresInSeconds?: number } = {}): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: opts.expiresInSeconds ?? SESSION_HOURS * 3600 });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (typeof decoded === 'string' || !decoded) {
    throw new Error('invalid token payload');
  }
  const { sub, email, role, tv } = decoded as Partial<JwtPayload>;
  const roleParsed = userRoleSchema.safeParse(role);
  if (typeof sub !== 'string' || typeof email !== 'string' || !roleParsed.success) {
    throw new Error('invalid token payload');
  }
  if (tv !== undefined && (typeof tv !== 'number' || !Number.isInteger(tv) || tv < 0)) {
    throw new Error('invalid token payload');
  }
  return { sub, email, role: roleParsed.data, ...(tv !== undefined ? { tv } : {}) };
}

/**
 * A token that carries `tv` (invite-redeemed, long-lived) is checked against the
 * user document on every request so disabling bites immediately. A Google token
 * has no `tv` and keeps the original zero-read fast path.
 */
export async function assertSessionValid(payload: JwtPayload): Promise<void> {
  if (payload.tv === undefined) return;
  const user = await User.findById(payload.sub).select('disabled tokenVersion');
  const version = Number(user?.get('tokenVersion') ?? 0);
  if (!user || user.get('disabled') === true || version !== payload.tv) {
    throw new Error('session revoked');
  }
}
```

`src/server/trpcInit.ts` — make `buildContext` async:

```ts
export async function buildContext(options: {
  authHeader?: string;
  cookieToken?: string;
  serviceToken?: string;
}): Promise<Context> {
  const bearer = parseBearerToken(options.authHeader);
  if (bearer && isServiceTokenValid(bearer, options.serviceToken)) {
    return { user: undefined, serviceAuth: true };
  }
  const token = bearer ?? options.cookieToken;
  if (token) {
    try {
      const user = verifyToken(token);
      await assertSessionValid(user);
      return { user, serviceAuth: false };
    } catch {
      return { user: undefined, serviceAuth: false };
    }
  }
  return { user: undefined, serviceAuth: false };
}
```
(import `assertSessionValid` alongside `verifyToken`; `buildContext` is called directly in tests too.)

`src/server/app.ts`:

```ts
      createContext: async ({ req }) =>
        buildContext({
          authHeader: req.headers.authorization,
          cookieToken: req.cookies?.[AUTH_COOKIE] as string | undefined,
          serviceToken: process.env.QUEEN_SERVICE_TOKEN,
        }),
```

`src/server/routes/auth.ts`:

```ts
function authCookieOptions(maxAgeMs: number = SESSION_HOURS * 60 * 60 * 1000) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: maxAgeMs };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const bearer = parseBearerToken(req.headers.authorization);
  const token = bearer ?? req.cookies?.[AUTH_COOKIE];
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const payload = verifyToken(token);
    await assertSessionValid(payload);
    res.locals.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}
```

`src/server/__tests__/trpc.test.ts` line ~100: `const ctx = await buildContext({ ... })`.

- [ ] **Step 4: Run the tests, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/services/__tests__/sessions.test.ts src/server/__tests__/trpc.test.ts`
Expected: PASS. If `trpc.test.ts` fails on a non-awaited context, that is the intended break — fix the call site, not the implementation.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/server/services/AuthService.ts src/server/trpcInit.ts src/server/app.ts src/server/routes/auth.ts src/server/services/__tests__/sessions.test.ts src/server/__tests__/trpc.test.ts
git commit -m "feat(auth): check long-lived invite sessions per request via tokenVersion"
```

---

### Task 3: `users` router (invite, list, revoke, role, disable)

**Files:**
- Create: `src/server/routers/users.ts`
- Modify: `src/server/trpc.ts` (import + mount `users: usersRouter`)
- Test: `src/server/routers/__tests__/users.test.ts`

**Interfaces:**
- Produces: `usersRouter` with `list`, `invite({ email, role? })` → `{ url, expiresAt, ttlHours, id }`, `revokeInvite({ id })`, `setRole({ id, role })`, `setDisabled({ id, disabled })`.
- Consumes: Task 1 helpers, `adminProcedure`, `userRoleSchema`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeAll, beforeEach, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { User } from '../../models/User';
import { hashInviteToken } from '../../lib/inviteToken';

function adminCaller() {
  return appRouter.createCaller({ user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' }, serviceAuth: false });
}
function userCaller(id = 'user-id-1') {
  return appRouter.createCaller({ user: { sub: id, email: 'user@example.de', role: 'user' }, serviceAuth: false });
}
function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeAll(() => { process.env.CLIENT_URL = 'https://queen.example.de'; });
beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('users router', () => {
  it('is admin-only', async () => {
    await expect(userCaller().users.list()).rejects.toThrow(/FORBIDDEN|forbidden/i);
  });

  it('creates an invite and stores only the hash', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'Steuer@Example.de', role: 'user' });
    expect(res.url).toMatch(/^https:\/\/queen\.example\.de\/invite#[A-Za-z0-9_-]{43}$/);
    const token = res.url.split('#')[1]!;
    const user = await User.findOne({ email: 'steuer@example.de' });
    expect(user?.get('inviteTokenHash')).toBe(hashInviteToken(token));
    expect(JSON.stringify(user?.toObject())).not.toContain(token);
    expect(user?.get('inviteExpiresAt')).toBeInstanceOf(Date);
    expect(user?.get('invitedBy')).toBe('admin-id-1');
    expect(user?.get('role')).toBe('user');
  });

  it('re-inviting replaces the hash and kills the old link', async (ctx) => {
    if (!dbReady(ctx)) return;
    const first = await adminCaller().users.invite({ email: 'a@example.de' });
    const second = await adminCaller().users.invite({ email: 'a@example.de' });
    const user = await User.findOne({ email: 'a@example.de' });
    const oldHash = first.url.split('#')[1]!;
    const newHash = second.url.split('#')[1]!;
    expect(user?.get('inviteTokenHash')).toBe(hashInviteToken(newHash));
    expect(user?.get('inviteTokenHash')).not.toBe(hashInviteToken(oldHash));
  });

  it('does not wipe an existing Google user', async (ctx) => {
    if (!dbReady(ctx)) return;
    await User.create({ email: 'g@bumbleflies.de', role: 'admin', googleId: 'g1', refreshToken: 'rt' });
    await adminCaller().users.invite({ email: 'g@bumbleflies.de', role: 'admin' });
    const user = await User.findOne({ email: 'g@bumbleflies.de' });
    expect(user?.get('googleId')).toBe('g1');
    expect(user?.get('refreshToken')).toBe('rt');
  });

  it('revokeInvite clears the hash', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'a@example.de' });
    await adminCaller().users.revokeInvite({ id: res.id });
    const user = await User.findOne({ email: 'a@example.de' });
    expect(user?.get('inviteTokenHash')).toBeUndefined();
    expect(user?.get('inviteExpiresAt')).toBeUndefined();
  });

  it('setDisabled bumps tokenVersion and refuses self-disable', async (ctx) => {
    if (!dbReady(ctx)) return;
    const res = await adminCaller().users.invite({ email: 'a@example.de' });
    await adminCaller().users.setDisabled({ id: res.id, disabled: true });
    let user = await User.findById(res.id);
    expect(user?.get('disabled')).toBe(true);
    expect(user?.get('tokenVersion')).toBe(1);

    await expect(adminCaller().users.setDisabled({ id: 'admin-id-1', disabled: true })).rejects.toThrow(/eigenen/i);

    await adminCaller().users.setDisabled({ id: res.id, disabled: false });
    user = await User.findById(res.id);
    expect(user?.get('disabled')).toBe(false);
  });

  it('list reports sessions and Drive state without leaking hashes', async (ctx) => {
    if (!dbReady(ctx)) return;
    await User.create({ email: 'g@bumbleflies.de', role: 'admin', googleId: 'g1', refreshToken: 'rt' });
    const invited = await adminCaller().users.invite({ email: 'a@example.de' });
    const rows = await adminCaller().users.list();
    const invitedRow = rows.find((r) => r.id === invited.id);
    expect(invitedRow).toMatchObject({ email: 'a@example.de', role: 'user', disabled: false, hasGoogle: false, hasDrive: false });
    expect(JSON.stringify(rows)).not.toContain('inviteTokenHash');
    expect(rows.find((r) => r.email === 'g@bumbleflies.de')?.hasDrive).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/routers/__tests__/users.test.ts`
Expected: FAIL — `appRouter.users` is undefined.

- [ ] **Step 3: Implement**

```ts
// src/server/routers/users.ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { User } from '../models/User';
import { userRoleSchema } from '../../shared/schemas/user';
import {
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteTtlHours,
} from '../lib/inviteToken';

const emailSchema = z.string().trim().email();
const idSchema = z.string().min(1);

/** `<CLIENT_URL>/invite#<token>` — the fragment never reaches a proxy log. */
function inviteUrl(token: string): string {
  const base = (process.env.CLIENT_URL ?? '').replace(/\/+$/, '');
  return `${base}/invite#${token}`;
}

export const usersRouter = router({
  /** Admin roster: who exists, who may still redeem, who has Drive. */
  list: adminProcedure.query(async () => {
    const users = await User.find({}).sort({ email: 1 });
    return users.map((u) => ({
      id: String(u._id),
      email: String(u.get('email')),
      role: u.get('role') === 'admin' ? ('admin' as const) : ('user' as const),
      disabled: u.get('disabled') === true,
      lastLoginAt: (u.get('lastLoginAt') as Date | undefined) ?? null,
      inviteExpiresAt: (u.get('inviteExpiresAt') as Date | undefined) ?? null,
      hasGoogle: Boolean(u.get('googleId')),
      hasDrive: Boolean(u.get('refreshToken')),
    }));
  }),

  /** Issue (or re-issue) a one-time link. The plaintext token is returned once and never stored. */
  invite: adminProcedure
    .input(z.object({ email: emailSchema, role: userRoleSchema.default('user') }))
    .mutation(async ({ input, ctx }) => {
      const token = generateInviteToken();
      const expiresAt = inviteExpiry(new Date());
      const email = input.email.toLowerCase();
      const user = await User.findOneAndUpdate(
        { email },
        {
          $set: {
            email,
            role: input.role,
            inviteTokenHash: hashInviteToken(token),
            inviteExpiresAt: expiresAt,
            invitedBy: ctx.user.sub,
            disabled: false,
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      );
      return { id: String(user._id), url: inviteUrl(token), expiresAt, ttlHours: inviteTtlHours() };
    }),

  revokeInvite: adminProcedure.input(z.object({ id: idSchema })).mutation(async ({ input }) => {
    await User.updateOne({ _id: input.id }, { $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 } });
    return { ok: true as const };
  }),

  setRole: adminProcedure
    .input(z.object({ id: idSchema, role: userRoleSchema }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.sub && input.role !== 'admin') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Der eigene Admin-Zugang kann nicht herabgestuft werden.' });
      }
      await User.updateOne({ _id: input.id }, { $set: { role: input.role } });
      return { ok: true as const };
    }),

  /** Disable (never delete — `createdBy` must stay resolvable). Also ends live sessions. */
  setDisabled: adminProcedure
    .input(z.object({ id: idSchema, disabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.id === ctx.user.sub && input.disabled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Der eigene Zugang kann nicht deaktiviert werden.' });
      }
      await User.updateOne(
        { _id: input.id },
        { $set: { disabled: input.disabled }, $inc: { tokenVersion: 1 } },
      );
      return { ok: true as const };
    }),
});
```

`src/server/trpc.ts`: add `import { usersRouter } from './routers/users';` and `users: usersRouter,` in `appRouter`.

- [ ] **Step 4: Run the tests, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/routers/__tests__/users.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/routers/users.ts src/server/routers/__tests__/users.test.ts src/server/trpc.ts
git commit -m "feat(auth): add users router with one-time invite links"
```

---

### Task 4: Redeem endpoint

**Files:**
- Modify: `src/server/routes/auth.ts`
- Test: `src/server/routes/__tests__/inviteRedeem.test.ts`

**Interfaces:**
- Produces: `POST /auth/invite/redeem` — body `{ token: string }`; 200 `{ ok: true }` + `queen_token` cookie, or 400 `{ error: 'invalid invite' }`.
- Consumes: `hashInviteToken`, `signToken` with `expiresInSeconds`, `authCookieOptions(maxAgeMs)`, `INVITE_SESSION_DAYS`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, type TaskContext } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../../app';
import { User } from '../../models/User';
import { AUTH_COOKIE } from '../auth';
import { appRouter } from '../../trpc';
import { hashInviteToken } from '../../lib/inviteToken';

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

async function makeInvite(email = 'steuer@example.de', extra: Record<string, unknown> = {}) {
  const caller = appRouter.createCaller({ user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' }, serviceAuth: false });
  const res = await caller.users.invite({ email, role: 'user' });
  return { token: res.url.split('#')[1]!, id: res.id, ...extra };
}

const app = createApp();

beforeEach(async () => {
  if (mongoose.connection.readyState === 1) await User.deleteMany({});
});

describe('POST /auth/invite/redeem', () => {
  it('sets a 30-day cookie, clears the hash and stamps lastLoginAt', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    const res = await request(app).post('/auth/invite/redeem').send({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`${AUTH_COOKIE}=`);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('HttpOnly');

    const user = await User.findById(id);
    expect(user?.get('inviteTokenHash')).toBeUndefined();
    expect(user?.get('lastLoginAt')).toBeInstanceOf(Date);

    const me = await request(app).get('/auth/me').set('Cookie', cookie.split(';')[0]!);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'steuer@example.de', role: 'user', tv: 0 });
  });

  it('rejects a second redeem of the same token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token } = await makeInvite();
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(200);
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
  });

  it('mints exactly one session for concurrent clicks', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token } = await makeInvite();
    const results = await Promise.all([
      request(app).post('/auth/invite/redeem').send({ token }),
      request(app).post('/auth/invite/redeem').send({ token }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('rejects an expired invite', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    await User.updateOne({ _id: id }, { $set: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
  });

  it('rejects a disabled user and an unknown token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token, id } = await makeInvite();
    await User.updateOne({ _id: id }, { $set: { disabled: true } });
    expect((await request(app).post('/auth/invite/redeem').send({ token })).status).toBe(400);
    expect((await request(app).post('/auth/invite/redeem').send({ token: 'nope' })).status).toBe(400);
    expect((await request(app).post('/auth/invite/redeem').send({})).status).toBe(400);
  });

  it('a session dies as soon as the user is disabled', async (ctx) => {
    if (!dbReady(ctx)) return;
    const { token } = await makeInvite();
    const login = await request(app).post('/auth/invite/redeem').send({ token });
    const cookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);

    const rows = await appRouter
      .createCaller({ user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' }, serviceAuth: false })
      .users.list();
    await appRouter
      .createCaller({ user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' }, serviceAuth: false })
      .users.setDisabled({ id: rows[0]!.id, disabled: true });

    expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/routes/__tests__/inviteRedeem.test.ts`
Expected: FAIL — 404 on `/auth/invite/redeem`.

- [ ] **Step 3: Implement**

Add inside `createAuthRouter()` in `src/server/routes/auth.ts`, after the Google callback:

```ts
  /**
   * Redeem a one-time invite. The token arrives in the request body (the browser
   * read it from the URL fragment), so it never lands in a proxy log or referer.
   * `findOneAndUpdate` keeps this single-use even under concurrent clicks.
   */
  router.post('/invite/redeem', async (req: Request, res: Response) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'invalid invite' });
      return;
    }
    try {
      const now = new Date();
      const user = await User.findOneAndUpdate(
        {
          inviteTokenHash: hashInviteToken(token),
          inviteExpiresAt: { $gt: now },
          disabled: { $ne: true },
        },
        { $unset: { inviteTokenHash: 1, inviteExpiresAt: 1 }, $set: { lastLoginAt: now } },
        { new: true },
      );
      if (!user) {
        res.status(400).json({ error: 'invalid invite' });
        return;
      }
      const roleParsed = userRoleSchema.safeParse(user.get('role'));
      const payload: JwtPayload = {
        sub: String(user._id),
        email: String(user.get('email')),
        role: roleParsed.success ? roleParsed.data : 'user',
        tv: Number(user.get('tokenVersion') ?? 0),
      };
      const maxAgeMs = INVITE_SESSION_DAYS * 24 * 60 * 60 * 1000;
      res.cookie(AUTH_COOKIE, signToken(payload, { expiresInSeconds: maxAgeMs / 1000 }), authCookieOptions(maxAgeMs));
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'login failed' });
    }
  });
```

Imports to add: `hashInviteToken` from `../lib/inviteToken`, `INVITE_SESSION_DAYS` from `../services/AuthService`, and `type JwtPayload` from `../../shared/types`.

- [ ] **Step 4: Run the tests, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/routes/__tests__/inviteRedeem.test.ts src/server/routes/__tests__/auth.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/auth.ts src/server/routes/__tests__/inviteRedeem.test.ts
git commit -m "feat(auth): redeem one-time invite links for a 30-day session"
```

---

### Task 5: Drive for a user without a Google account

**Files:**
- Modify: `src/server/services/driveForUser.ts` (add `driveAccessForActor`, `driveForActor`)
- Modify: `src/server/routers/settings.ts:26` (`browseDriveFolders` → `adminProcedure`)
- Modify: `src/server/routers/receipts.ts:25`, `src/server/routers/bookings.ts:191,233,303`
- Modify: `src/server/jobs/FileInvoiceJob.ts:112`
- Test: `src/server/services/__tests__/driveForActor.test.ts`

**Interfaces:**
- Produces: `driveAccessForActor(userId): Promise<GoogleAccess>`, `driveForActor(userId): Promise<DriveFilesLike>`.
- Behaviour: own `refreshToken` → her credentials; none → the admin who saved the Drive settings; neither → `PRECONDITION_FAILED`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { TRPCError } from '@trpc/server';
import { User } from '../../models/User';
import { Setting } from '../../models/Setting';
import { driveAccessForActor } from '../driveForUser';

const getGoogleAccessTokenForUser = vi.hoisted(() =>
  vi.fn(async (userId: string) => ({ accessToken: `at-${userId}`, refreshToken: `rt-${userId}` })),
);
vi.mock('../AuthService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../AuthService')>();
  return { ...actual, getGoogleAccessTokenForUser };
});

function dbReady(ctx: TaskContext): boolean {
  if (mongoose.connection.readyState === 1) return true;
  ctx.skip();
  return false;
}

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await User.deleteMany({});
  await Setting.deleteMany({});
  getGoogleAccessTokenForUser.mockClear();
});

describe('driveAccessForActor', () => {
  it("uses the user's own token when present", async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'a@bumbleflies.de', role: 'admin', googleId: 'g', refreshToken: 'rt-own' });
    const access = await driveAccessForActor(String(user._id));
    expect(access).toEqual({ accessToken: `at-${user._id}`, refreshToken: `rt-${user._id}` });
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledWith(String(user._id));
  });

  it('falls back to the Drive-settings admin for a user without a refresh token', async (ctx) => {
    if (!dbReady(ctx)) return;
    const invited = await User.create({ email: 'steuer@example.de', role: 'user' });
    await Setting.create({ key: 'drive', updatedBy: 'admin-id-1' });
    const access = await driveAccessForActor(String(invited._id));
    expect(access.refreshToken).toBe('rt-admin-id-1');
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledWith('admin-id-1');
  });

  it('raises PRECONDITION_FAILED when nothing is configured', async (ctx) => {
    if (!dbReady(ctx)) return;
    const invited = await User.create({ email: 'steuer@example.de', role: 'user' });
    await expect(driveAccessForActor(String(invited._id))).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('does not fall back when the user has a token that fails', async (ctx) => {
    if (!dbReady(ctx)) return;
    const user = await User.create({ email: 'a@bumbleflies.de', role: 'admin', googleId: 'g', refreshToken: 'rt-own' });
    await Setting.create({ key: 'drive', updatedBy: 'admin-id-1' });
    getGoogleAccessTokenForUser.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(driveAccessForActor(String(user._id))).rejects.toThrow(/invalid_grant/);
    expect(getGoogleAccessTokenForUser).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/services/__tests__/driveForActor.test.ts`
Expected: FAIL — `driveAccessForActor` is not exported.

- [ ] **Step 3: Implement**

`src/server/services/driveForUser.ts` — add:

```ts
import { TRPCError } from '@trpc/server';
import { User } from '../models/User';

/**
 * Google credentials for a user acting on Drive. A user without a stored
 * refresh token (an invited accountant who never signed in with Google) acts as
 * the admin who last saved the Drive settings — the same credential `driveForCron`
 * uses. No try/catch fallback: if her own token exists but fails, that is her error.
 */
export async function driveAccessForActor(userId: string): Promise<GoogleAccess> {
  const user = await User.findById(userId).select('refreshToken');
  if (user?.get('refreshToken')) {
    return getGoogleAccessTokenForUser(userId);
  }
  const fallbackUserId = (await Setting.findOne({ key: 'drive' }))?.updatedBy;
  if (!fallbackUserId) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Kein Google-Laufwerk verbunden — bitte in den Einstellungen die Drive-Ordner speichern.',
    });
  }
  try {
    return await getGoogleAccessTokenForUser(fallbackUserId);
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Der hinterlegte Google-Laufwerk-Zugang ist abgelaufen — bitte in den Einstellungen neu verbinden.',
    });
  }
}

export async function driveForActor(userId: string): Promise<DriveFilesLike> {
  const { accessToken, refreshToken } = await driveAccessForActor(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.drive({ version: 'v3', auth }) as unknown as DriveFilesLike;
}
```

Call sites:
- `src/server/routers/settings.ts`: `browseDriveFolders: authedProcedure` → `adminProcedure`; keep `driveForUser(ctx.user.sub)` (admins have their own token).
- `src/server/routers/receipts.ts:25` and `bookings.ts:191,233,303`: `driveForUser(ctx.user.sub)` → `driveForActor(ctx.user.sub)`.
- `src/server/jobs/FileInvoiceJob.ts`: `import { driveAccessForActor } from '../services/driveForUser';` and `const getAccessToken = deps.getAccessToken ?? driveAccessForActor;` (drop the `getGoogleAccessTokenForUser` import, keep `type GoogleAccess` from AuthService).

- [ ] **Step 4: Run the tests, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp NODE_ENV=development npx vitest run --no-file-parallelism src/server/services/__tests__/driveForActor.test.ts src/server/jobs/__tests__/fileInvoiceJob.test.ts src/server/routers/__tests__/bookings.test.ts src/server/routers/__tests__/reconcile.test.ts`
Expected: PASS. `reconcile.test.ts` mocks `services/driveForUser` — if the mock now lacks `driveAccessForActor`, add it to the mock factory; that is a test-fixture fix, not a behaviour change.

- [ ] **Step 5: Commit**

```bash
git add src/server/services/driveForUser.ts src/server/services/__tests__/driveForActor.test.ts src/server/routers/settings.ts src/server/routers/receipts.ts src/server/routers/bookings.ts src/server/jobs/FileInvoiceJob.ts src/server/routers/__tests__/reconcile.test.ts
git commit -m "feat(drive): borrow the Drive-settings admin for users without a Google token"
```

---

### Task 6: Invite page and login notice

**Files:**
- Create: `src/client/pages/InvitePage.tsx`
- Modify: `src/client/main.tsx:38` (route `/invite`)
- Modify: `src/client/pages/LoginPage.tsx`
- Modify: `src/client/i18n/de.ts`, `src/client/i18n/en.ts`
- Test: `src/client/pages/__tests__/InvitePage.test.tsx`

**Interfaces:**
- Consumes: `POST /auth/invite/redeem`.
- Produces i18n keys: `invite.working`, `invite.invalid`, `invite.toLogin`, `auth.noGoogle`, `auth.inviteInvalid`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvitePage } from '../InvitePage';
import { LanguageProvider } from '../../i18n/LanguageContext';

describe('InvitePage', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/invite#tok-123');
    window.location.replace = vi.fn();
  });
  afterEach(() => vi.restoreAllMocks());

  it('posts the fragment token and leaves for the dashboard', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LanguageProvider><MemoryRouter><InvitePage /></MemoryRouter></LanguageProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/auth/invite/redeem');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ token: 'tok-123' });
    expect(window.location.replace).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the invalid notice when the link is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    render(<LanguageProvider><MemoryRouter><InvitePage /></MemoryRouter></LanguageProvider>);
    expect(await screen.findByText(/ungültig|abgelaufen/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp npx vitest run src/client/pages/__tests__/InvitePage.test.tsx`
Expected: FAIL — `Cannot find module '../InvitePage'`.

- [ ] **Step 3: Implement**

```tsx
// src/client/pages/InvitePage.tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * The invite token arrives in the URL fragment, which browsers never send to a
 * server: it reaches queen only in the POST body below. `replaceState` also
 * removes it from history, so it is not left behind in the address bar.
 */
export function InvitePage() {
  const { t } = useLanguage();
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    const token = window.location.hash.replace(/^#/, '');
    if (!token) {
      setInvalid(true);
      return;
    }
    window.history.replaceState(null, '', '/invite');
    let cancelled = false;
    fetch('/auth/invite/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) window.location.replace('/dashboard');
        else setInvalid(true);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="auth">
      <div className="card auth-card">
        <Brand size={40} className="auth-brand" />
        <div className="auth-intro">
          <h1>{t('auth.title')}</h1>
          <p className="muted">{invalid ? t('invite.invalid') : t('invite.working')}</p>
        </div>
        {invalid ? <Link className="btn honey" to="/login">{t('invite.toLogin')}</Link> : null}
      </div>
    </main>
  );
}
```

`src/client/main.tsx`: import and add `<Route path="/invite" element={<InvitePage />} />` next to `/login` (outside `ProtectedRoute`).

`src/client/pages/LoginPage.tsx`: below the Google button add

```tsx
        {new URLSearchParams(window.location.search).has('invite') ? (
          <p className="auth-foot" style={{ color: 'var(--danger)' }}>{t('auth.inviteInvalid')}</p>
        ) : null}
        <p className="auth-foot muted">{t('auth.noGoogle')}</p>
```
before the existing `auth.restricted` line.

i18n (`de.ts` / `en.ts`, same keys):
```ts
  'invite.working': 'Zugangslink wird geprüft …',      // 'Checking your sign-in link …'
  'invite.invalid': 'Dieser Link ist ungültig, abgelaufen oder wurde schon verwendet.', // 'This link is invalid, expired, or already used.'
  'invite.toLogin': 'Zur Anmeldung',                   // 'Go to sign-in'
  'auth.noGoogle': 'Kein Google-Konto? Den Zugangslink beim Administrator anfordern.', // 'No Google account? Ask the administrator for a sign-in link.'
  'auth.inviteInvalid': 'Der Zugangslink ist ungültig oder abgelaufen. Bitte einen neuen anfordern.', // 'The sign-in link is invalid or expired. Please ask for a new one.'
```

- [ ] **Step 4: Run the test, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp npx vitest run src/client/pages/__tests__/InvitePage.test.tsx`
Expected: PASS (2 tests). Then `npm run typecheck` — a missing key in `en.ts` fails the `DictKey` check.

- [ ] **Step 5: Commit**

```bash
git add src/client/pages/InvitePage.tsx src/client/pages/__tests__/InvitePage.test.tsx src/client/main.tsx src/client/pages/LoginPage.tsx src/client/i18n/de.ts src/client/i18n/en.ts
git commit -m "feat(auth): add invite page and sign-in-link notice"
```

---

### Task 7: Admin "Benutzer" section

**Files:**
- Create: `src/client/components/UsersSection.tsx`
- Modify: `src/client/pages/SettingsPage.tsx` (render next to `TaxRateSection` in the admin block)
- Modify: `src/client/i18n/de.ts`, `src/client/i18n/en.ts`
- Test: `src/client/components/__tests__/UsersSection.test.tsx`

**Interfaces:**
- Consumes: `users.list`, `users.invite`, `users.revokeInvite`, `users.setRole`, `users.setDisabled`.
- Produces keys: `settings.usersTitle`, `settings.usersEmail`, `settings.usersRole`, `settings.usersLastLogin`, `settings.usersInvite`, `settings.usersCopy`, `settings.usersRevoke`, `settings.usersDisable`, `settings.usersEnable`, `settings.usersNever`, `settings.usersDrive`, `settings.usersLinkExpires`, `settings.usersInvited`, `settings.usersHint`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersSection } from '../UsersSection';
import { LanguageProvider } from '../../i18n/LanguageContext';

const mutate = vi.fn(async () => ({ url: 'https://queen.example.de/invite#abc', id: 'u1', expiresAt: new Date(), ttlHours: 168 }));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ users: { list: { invalidate: vi.fn() } } }),
    users: {
      list: { useQuery: () => ({ data: [{ id: 'u1', email: 'steuer@example.de', role: 'user', disabled: false, lastLoginAt: null, inviteExpiresAt: null, hasGoogle: false, hasDrive: false }], isLoading: false, error: null }) },
      invite: { useMutation: () => ({ mutateAsync: mutate, isPending: false }) },
      revokeInvite: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setRole: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
      setDisabled: { useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }) },
    },
  },
}));

describe('UsersSection', () => {
  it('lists users with their state', () => {
    render(<LanguageProvider><UsersSection /></LanguageProvider>);
    expect(screen.getByText('steuer@example.de')).toBeInTheDocument();
    expect(screen.getByText(/nie/i)).toBeInTheDocument();
  });

  it('shows the generated link once after inviting', async () => {
    render(<LanguageProvider><UsersSection /></LanguageProvider>);
    await userEvent.type(screen.getByLabelText(/E-Mail/i), 'neu@example.de');
    await userEvent.click(screen.getByRole('button', { name: /einladen/i }));
    expect(await screen.findByDisplayValue('https://queen.example.de/invite#abc')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test, expect failure**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp npx vitest run src/client/components/__tests__/UsersSection.test.tsx`
Expected: FAIL — `Cannot find module '../UsersSection'`.

- [ ] **Step 3: Implement**

`UsersSection.tsx` — same shape as `TaxRateSection` in `SettingsPage.tsx`: a `section.card` with `<h2>{t('settings.usersTitle')}</h2>`, an invite row (`<input type="email" aria-label={t('settings.usersEmail')}>`, role `<select>`, button `{t('settings.usersInvite')}`), and the resulting `<input readOnly value={inviteUrl}>` plus expiry date — shown until the next invite. Below it a `table.resp` with columns email / role (select, `setRole`) / last login (`t('settings.usersNever')` when null) / Drive (`t('settings.usersDrive')` when `hasDrive`, else `—`) / actions (revoke link, disable/enable). Every mutation invalidates `utils.users.list`.

Wire it into `SettingsPage.tsx` next to the other admin-only blocks:

```tsx
      {user?.role === 'admin' ? <UsersSection /> : null}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `TMPDIR=$HOME/.cache/queen-test-tmp npx vitest run src/client/components/__tests__/UsersSection.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/components/UsersSection.tsx src/client/components/__tests__/UsersSection.test.tsx src/client/pages/SettingsPage.tsx src/client/i18n/de.ts src/client/i18n/en.ts
git commit -m "feat(settings): manage users and invite links in the settings page"
```

---

### Task 8: Invariants, docs, full verification

**Files:**
- Modify: `AGENTS.md` (sign-in invariants; correct the "prod is gated" claim)
- Modify: `docs/plans/2026-10-06-queen.md` (Task 2 auth, prod gating)
- Modify: `docs/plans/2026-10-22-accountant-invite-login-design.md` (status → implemented, link the plan)
- Create: `history/2026-10-22_accountant-invite-login.md`

- [ ] **Step 1: Update `AGENTS.md`**

In "Invariants", replace the implicit Google-only assumption with:

```markdown
- **Sign-in:** Google OAuth for `@bumbleflies.de`, plus one-time invite links
  (`users.invite`, 7-day TTL via `INVITE_TTL_HOURS`, `sha256` stored only). Invited
  sessions carry a `tv` claim, last 30 days and are checked against the user document
  on every request, so `users.setDisabled` (which bumps `tokenVersion`) ends them
  immediately. Google sessions stay 12 h with no per-request DB read. Users are disabled,
  never deleted — `createdBy` must stay resolvable.
- **Drive for users without a Google token:** `driveForActor()` borrows the admin who
  saved the Drive settings (same credential as `driveForCron()`); it never falls back
  when the user's own token fails. `settings.browseDriveFolders` is admin-only for this
  reason.
```

And correct the status line: production is live at `queen.bumbleflies.de` (see
`servyy-container/history/2026-10-06_queen-prod-enablement.md`), so "prod is gated" goes.

- [ ] **Step 2: Run the full check**

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```
Expected: all green. If `npm test` reports skipped DB tests, `NODE_ENV=development` is missing.

- [ ] **Step 3: Write the history log**

`history/2026-10-22_accountant-invite-login.md` following `history/README.md`: problem, solution, files changed, deployment result, verification commands, success criteria, known issues (no 2FA, link is a bearer credential for its TTL, Drive actions run as the fallback admin), future enhancements (SMTP delivery, TOTP, `viewer` role, domain allowlist in the Google callback if the consent screen turns out public).

- [ ] **Step 4: Deploy to servyy-test and verify by hand**

```bash
cd /root/dev/dachrisch/servyy-container/ansible && ./servyy-test.sh --tags finance
```
Then: sign in as admin → Settings → Benutzer → invite her → open the link in a private window → she lands on the dashboard → book one transaction → check `createdBy` in the journal entry → disable her → reload → 401/login. Production only after that, with an explicit go-ahead.

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/plans/2026-10-06-queen.md docs/plans/2026-10-22-accountant-invite-login-design.md history/2026-10-22_accountant-invite-login.md
git commit -m "docs(auth): record invite sign-in invariants and rollout"
```

---

## Out of scope (separate increments)

- `viewer` role (read-only guards on ~8 procedures) — only if she must not write.
- Email delivery of the invite (needs a mail transport; nodemailer is already a dependency but unwired).
- TOTP as a second factor.
- A Google-domain allowlist in `upsertUserFromProfile` — decided by the OAuth consent screen's user type, tracked in the design doc's "Current state", and worth shipping on its own if that screen is External + published.
