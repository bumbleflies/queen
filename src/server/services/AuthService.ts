import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../shared/types';
import { userRoleSchema } from '../../shared/schemas/user';
import { User } from '../models/User';
import { createOAuth2Client } from './DriveService';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

export function parseBearerToken(authHeader: string | undefined): string | undefined {
  if (!authHeader) {
    return undefined;
  }
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length < 2) {
    return undefined;
  }
  const [scheme, token] = parts;
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return undefined;
  }
  return token;
}

function parseEmailList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/** Domain guaranteed by the bumbleflies Google OAuth client. */
const BUMBLEFLIES_EMAIL_DOMAIN = 'bumbleflies.de';

/**
 * Match a configured entry against a signed-in email. Because the bumbleflies
 * Google OAuth client only admits the bumbleflies.de domain, an entry without
 * '@' is treated as the username (local part) — `christian.daehn` matches
 * `christian.daehn@bumbleflies.de`.
 */
function matchesEntry(entry: string, email: string): boolean {
  const normalised = email.trim().toLowerCase();
  if (entry.includes('@')) return entry === normalised;
  const at = normalised.lastIndexOf('@');
  return at > 0 && normalised.slice(0, at) === entry && normalised.slice(at + 1) === BUMBLEFLIES_EMAIL_DOMAIN;
}

export function getAllowedEmails(): string[] {
  return parseEmailList(process.env.ALLOWED_EMAILS);
}

/**
 * Optional stricter allowlist. queen reuses the bumbleflies Google OAuth client,
 * whose consent screen is restricted to the bumbleflies.de domain, so an empty
 * `ALLOWED_EMAILS` already allows only bumbleflies users. Set it only for
 * defense-in-depth.
 */
export function isAllowed(email: string): boolean {
  const allowed = getAllowedEmails();
  if (allowed.length === 0) return true;
  return allowed.some((entry) => matchesEntry(entry, email));
}

/**
 * Explicit admins from `ADMIN_EMAILS`, else every `ALLOWED_EMAILS` entry, else
 * (both unset) every authenticated user — a bumbleflies-only deployment has no
 * user population to distinguish, and this keeps the app usable with zero
 * email configuration.
 */
export function getAdminEmails(): string[] {
  const explicit = parseEmailList(process.env.ADMIN_EMAILS);
  if (explicit.length > 0) return explicit;
  return getAllowedEmails();
}

export function isAdmin(email: string): boolean {
  const admins = getAdminEmails();
  if (admins.length === 0) return true;
  return admins.some((entry) => matchesEntry(entry, email));
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });
}

export interface GoogleAccess {
  accessToken: string;
  refreshToken: string;
}

/**
 * Exchange a user's stored Google refresh token for a fresh access token.
 * The job fetches this at run time (never captures tokens in job data, which
 * would expire before retries).
 */
export async function getGoogleAccessTokenForUser(userId: string): Promise<GoogleAccess> {
  const user = await User.findById(userId);
  if (!user?.refreshToken) {
    throw new Error(`No Google refresh token stored for user ${userId}`);
  }
  const client = createOAuth2Client(user.refreshToken);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Failed to obtain Google access token');
  return { accessToken: token, refreshToken: user.refreshToken };
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, getJwtSecret());
  if (typeof decoded === 'string' || !decoded) {
    throw new Error('invalid token payload');
  }
  const { sub, email, role } = decoded as Partial<JwtPayload>;
  const roleParsed = userRoleSchema.safeParse(role);
  if (typeof sub !== 'string' || typeof email !== 'string' || !roleParsed.success) {
    throw new Error('invalid token payload');
  }
  return { sub, email, role: roleParsed.data };
}
