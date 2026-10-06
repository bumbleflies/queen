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

export function getAllowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? '';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

export function isAllowed(email: string): boolean {
  return getAllowedEmails().includes(email.trim().toLowerCase());
}

/** Explicit admins from `ADMIN_EMAILS`; falls back to every allowed email so a
 *  deployment that only sets `ALLOWED_EMAILS` still has an admin. */
export function getAdminEmails(): string[] {
  const explicit = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return explicit.length > 0 ? explicit : getAllowedEmails();
}

export function isAdmin(email: string): boolean {
  return getAdminEmails().includes(email.trim().toLowerCase());
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
