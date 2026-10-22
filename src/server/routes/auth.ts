import { Router, type Request, type Response, type NextFunction } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy, type VerifyCallback } from 'passport-google-oauth20';
import { User } from '../models/User';
import { isAdmin, parseBearerToken, signToken, verifyToken, assertSessionValid, SESSION_HOURS, INVITE_SESSION_DAYS } from '../services/AuthService';
import { userRoleSchema } from '../../shared/schemas/user';
import type { JwtPayload } from '../../shared/types';
import { hashInviteToken } from '../lib/inviteToken';

export const AUTH_COOKIE = 'queen_token';

function authCookieOptions(maxAgeMs: number = SESSION_HOURS * 60 * 60 * 1000) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeMs,
  };
}

function googleOAuthUnavailable(_req: Request, res: Response, next: NextFunction): void {
  const { clientID, clientSecret } = googleCreds();
  if (!clientID || !clientSecret) {
    res.status(501).json({ error: 'google oauth not configured' });
    return;
  }
  next();
}

// Drive scopes — no Sheets scope (plan Task 2). `drive.file` covers uploads
// queen creates; `drive.readonly` lets the folder picker and receipt listing
// see folders/files the user can access (drive.file only sees queen's own files).
export const GOOGLE_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
];

function googleCreds() {
  return {
    clientID: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackURL: process.env.GOOGLE_CALLBACK_URL ?? '/auth/google/callback',
  };
}

export function initPassport(): void {
  const { clientID, clientSecret, callbackURL } = googleCreds();
  if (!clientID || !clientSecret) {
    return;
  }
  passport.use(
    new GoogleStrategy(
      { clientID, clientSecret, callbackURL },
      (_accessToken: string, refreshToken: string, profile: unknown, done: VerifyCallback) => {
        // Stash the refresh token on the profile so the callback can persist it.
        done(null, { ...(profile as Record<string, unknown>), _refreshToken: refreshToken || undefined });
      },
    ),
  );
}

interface GoogleProfile {
  id: string;
  displayName?: string;
  emails?: { value: string }[];
}

function profileEmail(profile: GoogleProfile): string | undefined {
  return profile.emails?.[0]?.value?.toLowerCase();
}

async function upsertUserFromProfile(profile: GoogleProfile, refreshToken?: string) {
  const email = profileEmail(profile);
  if (!email) {
    throw new Error('no email on google profile');
  }
  const role = isAdmin(email) ? 'admin' : 'user';
  const existing = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });
  if (existing) {
    existing.set({
      googleId: profile.id,
      email,
      name: profile.displayName ?? existing.get('name'),
      role,
      ...(refreshToken ? { refreshToken } : {}),
    });
    await existing.save();
    return existing;
  }
  return User.create({
    email,
    name: profile.displayName,
    role,
    googleId: profile.id,
    ...(refreshToken ? { refreshToken } : {}),
  });
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

/** Must run after {@link requireAuth}; rejects authenticated non-admins. */
export function requireAdmin(_req: Request, res: Response, next: NextFunction): void {
  const user = res.locals.user as { role?: string } | undefined;
  if (user?.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export function createAuthRouter() {
  const router = Router();

  router.get(
    '/google',
    googleOAuthUnavailable,
    passport.authenticate('google', {
      session: false,
      accessType: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
    }),
  );

  router.get(
    '/google/callback',
    googleOAuthUnavailable,
    // failureRedirect is browser-flow-only (HTML redirect, not a JSON API).
    passport.authenticate('google', { session: false, failureRedirect: '/login' }),
    async (req: Request, res: Response) => {
      try {
        const profile = req.user as unknown as (GoogleProfile & {
          _refreshToken?: string;
        }) | undefined;
        if (!profile) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }
        const email = profileEmail(profile);
        if (!email) {
          res.status(403).json({ error: 'no email on google profile' });
          return;
        }
        const user = await upsertUserFromProfile(profile, profile._refreshToken);
        const userId = String(user.get('_id'));
        const roleParsed = userRoleSchema.safeParse(user.get('role'));
        const role = roleParsed.success ? roleParsed.data : 'user';
        const token = signToken({ sub: userId, email, role });
        res.cookie(AUTH_COOKIE, token, authCookieOptions());
        res.redirect('/');
      } catch {
        res.status(500).json({ error: 'login failed' });
      }
    },
  );

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
        { returnDocument: 'after' },
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
      res.cookie(
        AUTH_COOKIE,
        signToken(payload, { expiresInSeconds: maxAgeMs / 1000 }),
        authCookieOptions(maxAgeMs),
      );
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'login failed' });
    }
  });

  router.post('/logout', (_req: Request, res: Response) => {
    const cookieOptions = authCookieOptions();
    res.clearCookie(AUTH_COOKIE, {
      httpOnly: cookieOptions.httpOnly,
      sameSite: cookieOptions.sameSite,
      secure: cookieOptions.secure,
      path: cookieOptions.path,
    });
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (_req: Request, res: Response) => {
    res.json({ user: res.locals.user });
  });

  return router;
}
