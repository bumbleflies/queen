import { describe, it, expect } from 'vitest';
import { GOOGLE_SCOPES } from '../auth';

describe('Google OAuth scopes', () => {
  it('requests read-only Drive access for folder browsing', () => {
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/drive.file');
    expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/drive.readonly');
  });

  it('does not request Sheets or full write access', () => {
    expect(GOOGLE_SCOPES.some((s) => s.includes('spreadsheets'))).toBe(false);
    expect(GOOGLE_SCOPES).not.toContain('https://www.googleapis.com/auth/drive');
  });
});
