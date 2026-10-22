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
