import { describe, expect, it } from 'vitest';
import { billFileName } from '../billFileName';
import type { ParsedBill } from '../parseBill';

function parsed(over: Partial<ParsedBill> = {}): ParsedBill {
  return {
    vendorName: 'Hetzner Online GmbH',
    invoiceNumber: 'R-1234567',
    grossCents: 11900,
    netCents: 10000,
    vatCents: 1900,
    vatRate: 0.19,
    iban: 'DE44500921000000059512',
    dueDate: new Date(2026, 9, 15),
    reverseCharge: false,
    ...over,
  };
}

describe('billFileName', () => {
  it('names the file so the receipt ranking can find it', () => {
    expect(billFileName(parsed(), new Date(2026, 9, 1), 'invoice.pdf')).toBe(
      '2026-10-01 Hetzner Online GmbH R-1234567 119,00.pdf',
    );
  });

  it('uses the original name when nothing was parsed', () => {
    expect(billFileName(null, new Date(2026, 9, 1), 'Rechnung Oktober.pdf')).toBe('Rechnung Oktober.pdf');
  });

  it('fills the gaps and strips characters Drive dislikes', () => {
    const name = billFileName(
      parsed({ vendorName: 'A/B GmbH', invoiceNumber: '', grossCents: null }),
      new Date(2026, 9, 1),
      'x.pdf',
    );
    expect(name).toBe('2026-10-01 A-B GmbH.pdf');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('always ends in .pdf and never double-suffixes', () => {
    expect(billFileName(parsed({ grossCents: null }), new Date(2026, 9, 1), 'scan.PDF')).toMatch(/\.pdf$/);
  });
});
