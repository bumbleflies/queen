import { describe, it, expect } from 'vitest';
import { claimFileName } from '../claimFileName';

describe('claimFileName', () => {
  it('uses short name and period, and strips path characters', () => {
    expect(
      claimFileName({ shortName: 'ChrisK', period: '2026-01', vendorName: 'DB Reise & Touristik', invoiceNumber: '419/259' }),
    ).toBe('Spesen-ChrisK-202601-DB-Reise-Touristik-419-259.pdf');
  });

  it('keeps names within a sane length', () => {
    expect(claimFileName({ shortName: 'X', period: '2026-01', vendorName: 'v'.repeat(120) }).length).toBeLessThanOrEqual(120);
  });

  it('leaves out empty vendor and invoice parts instead of doubling separators', () => {
    expect(claimFileName({ shortName: 'TP', period: '2026-03', vendorName: '', invoiceNumber: '' })).toBe(
      'Spesen-TP-202603.pdf',
    );
  });
});
