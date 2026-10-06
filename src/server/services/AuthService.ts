import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../shared/types';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET env is not set');
  }
  return secret;
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
  if (typeof sub !== 'string' || typeof email !== 'string' || (role !== 'admin' && role !== 'user')) {
    throw new Error('invalid token payload');
  }
  return { sub, email, role };
}
