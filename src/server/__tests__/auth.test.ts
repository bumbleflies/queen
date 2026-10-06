import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAdminEmails, isAdmin } from '../services/AuthService';

const ENV_KEYS = ['ADMIN_EMAILS', 'ALLOWED_EMAILS'] as const;

describe('admin bootstrap (env)', () => {
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

  it('falls back to ALLOWED_EMAILS when ADMIN_EMAILS is unset', () => {
    delete process.env.ADMIN_EMAILS;
    process.env.ALLOWED_EMAILS = 'Owner@Example.de, second@example.de';
    expect(getAdminEmails()).toEqual(['owner@example.de', 'second@example.de']);
    expect(isAdmin('owner@example.de')).toBe(true);
    expect(isAdmin('SECOND@example.de')).toBe(true);
    expect(isAdmin('stranger@example.de')).toBe(false);
  });

  it('falls back to ALLOWED_EMAILS when ADMIN_EMAILS is empty/whitespace', () => {
    process.env.ADMIN_EMAILS = '  ,  ';
    process.env.ALLOWED_EMAILS = 'owner@example.de';
    expect(getAdminEmails()).toEqual(['owner@example.de']);
    expect(isAdmin('owner@example.de')).toBe(true);
  });

  it('uses the explicit ADMIN_EMAILS list (trimmed, lowercased) over ALLOWED_EMAILS', () => {
    process.env.ADMIN_EMAILS = ' Admin@Example.de , second@example.de ';
    process.env.ALLOWED_EMAILS = 'user@example.de';
    expect(getAdminEmails()).toEqual(['admin@example.de', 'second@example.de']);
    expect(isAdmin('admin@example.de')).toBe(true);
    expect(isAdmin('user@example.de')).toBe(false);
  });
});
