import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAdminEmails, isAdmin } from '../services/AuthService';

const ENV_KEYS = ['ADMIN_EMAILS'] as const;

describe('admin mapping (env)', () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('parses ADMIN_EMAILS (trimmed, lowercased)', () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.de , second@example.de ';
    expect(getAdminEmails()).toEqual(['admin@example.de', 'second@example.de']);
    expect(isAdmin('admin@example.de')).toBe(true);
    expect(isAdmin('user@example.de')).toBe(false);
  });

  it('with no ADMIN_EMAILS, any authenticated user is admin (bumbleflies-only)', () => {
    delete process.env.ADMIN_EMAILS;
    expect(getAdminEmails()).toEqual([]);
    expect(isAdmin('anyone@example.com')).toBe(true);
  });

  it('a bare username entry matches the local part at bumbleflies.de only', () => {
    process.env.ADMIN_EMAILS = 'christian.daehn';
    expect(isAdmin('christian.daehn@bumbleflies.de')).toBe(true);
    expect(isAdmin('CHRISTIAN.DAEHN@BUMBLEFLIES.DE')).toBe(true);
    expect(isAdmin('christian.daehn@example.com')).toBe(false);
    expect(isAdmin('someone.else@bumbleflies.de')).toBe(false);
  });
});
