import { describe, it, expect } from 'vitest';
import { suggestionsFor } from '../lib/suggestions';

const paidItem = {
  id: 'inv1',
  invoiceNumber: '20260901-01',
  customerNumber: 10015,
  clientName: 'it-agile GmbH',
  openCents: 53550,
};

describe('suggestionsFor', () => {
  it('recognizes labeled RNR/KD references and suggests by exact amount', () => {
    const { reason, suggestions } = suggestionsFor(
      {
        amountCents: 53550,
        description: 'RNR 20260901-01 KD 10015 Datum 01.09.2026 Kto. 80691',
        counterpartyName: 'IT-AGILE GMBH',
      },
      [paidItem],
    );
    expect(reason).toBe('Verwendungszweck erkannt, Betrag/Nummer prüfen.');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ id: 'inv1', exact: true });
    expect(suggestions[0].why).toMatch(/Rechnungsnr. passt/);
    expect(suggestions[0].why).toMatch(/Betrag exakt/);
  });

  it('suggests paid-but-unpaid invoices by exact amount even without a parseable reference', () => {
    const { suggestions } = suggestionsFor(
      { amountCents: 53550, description: 'Dauerauftrag', counterpartyName: 'Someone' },
      [paidItem],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].why).toBe('Betrag exakt');
  });

  it('flags a wrong customer number', () => {
    const { reason, suggestions } = suggestionsFor(
      { amountCents: 53550, description: '10007-20260901-01', counterpartyName: 'X' },
      [paidItem],
    );
    expect(reason).toMatch(/Kundennummer 10007 passt nicht/);
    expect(suggestions).toHaveLength(1);
  });

  it('returns noRef with no suggestions when nothing matches', () => {
    const { reason, suggestions } = suggestionsFor(
      { amountCents: 100, description: 'Gebühr Kontoführung', counterpartyName: 'GLS Bank' },
      [paidItem],
    );
    expect(reason).toBe('Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.');
    expect(suggestions).toEqual([]);
  });
});
