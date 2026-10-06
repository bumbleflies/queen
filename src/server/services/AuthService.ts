import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../shared/types';
import { userRoleSchema } from '../../shared/schemas/user';

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

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });
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
