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
    expect(inviteExpiry(now, 24).toISOString()).toBe('2026-10-23T10:00:00.000Z');
    expect(inviteExpiry(now, 168).toISOString()).toBe('2026-10-29T10:00:00.000Z');
  });
});
