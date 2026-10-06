import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAdminEmails, isAdmin, isAllowed } from '../services/AuthService';

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

  it('with no ADMIN_EMAILS/ALLOWED_EMAILS, any authenticated user is admin (bumbleflies-only)', () => {
    delete process.env.ADMIN_EMAILS;
    delete process.env.ALLOWED_EMAILS;
    expect(getAdminEmails()).toEqual([]);
    expect(isAdmin('anyone@example.com')).toBe(true);
  });

  it('isAllowed allows everyone when ALLOWED_EMAILS is unset, enforces it when set', () => {
    delete process.env.ALLOWED_EMAILS;
    expect(isAllowed('anyone@example.com')).toBe(true);
    process.env.ALLOWED_EMAILS = 'owner@example.de';
    expect(isAllowed('owner@example.de')).toBe(true);
    expect(isAllowed('stranger@example.de')).toBe(false);
  });

  it('a bare username entry matches the local part (bumbleflies.de domain)', () => {
    delete process.env.ALLOWED_EMAILS;
    process.env.ADMIN_EMAILS = 'christian.daehn';
    expect(isAdmin('christian.daehn@bumbleflies.de')).toBe(true);
    expect(isAdmin('christian.daehn@example.com')).toBe(false);
    expect(isAdmin('someone.else@bumbleflies.de')).toBe(false);
  });
});
