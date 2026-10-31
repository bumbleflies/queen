import { describe, it, expect } from 'vitest';
import { suggestionsFor } from '../lib/paymentSuggest';

const item = {
  id: 'inv1',
  invoiceNumber: '20260901-01',
  customerNumber: 10015,
  clientName: 'it-agile GmbH',
  openCents: 53550,
};

/** An invoice imported from the Sheet as paid: no payment record, so it is matchable. */
const unassignedItem = {
  id: 'inv2',
  invoiceNumber: '20260529-01',
  customerNumber: 10010,
  clientName: 'AFCV NRW',
  openCents: 226576,
  paymentMissing: true,
};

describe('suggestionsFor', () => {
  it('recognizes labeled RNR/KD references and suggests by exact amount', () => {
    const { reason, suggestions } = suggestionsFor(
      {
        amountCents: 53550,
        direction: 'in',
        description: 'RNR 20260901-01 KD 10015 Datum 01.09.2026 Kto. 80691',
        counterpartyName: 'IT-AGILE GMBH',
      },
      [item],
    );
    expect(reason).toBe('Verwendungszweck erkannt, Betrag/Nummer prüfen.');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ id: 'inv1', exact: true });
    expect(suggestions[0].why).toMatch(/Rechnungsnr. passt/);
    expect(suggestions[0].why).toMatch(/Betrag exakt/);
  });

  it('suggests open invoices by exact amount even without a parseable reference', () => {
    const { suggestions } = suggestionsFor(
      { amountCents: 53550, direction: 'in', description: 'Dauerauftrag', counterpartyName: 'Someone' },
      [item],
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].why).toBe('Betrag exakt');
  });

  it('flags a wrong customer number', () => {
    const { reason, suggestions } = suggestionsFor(
      { amountCents: 53550, direction: 'in', description: '10007-20260901-01', counterpartyName: 'X' },
      [item],
    );
    expect(reason).toMatch(/Kundennummer 10007 passt nicht/);
    expect(suggestions).toHaveLength(1);
  });

  it('returns noRef with no suggestions when no reference is parseable', () => {
    const { reason, suggestions } = suggestionsFor(
      { amountCents: 100, direction: 'in', description: 'Gebühr Kontoführung', counterpartyName: 'GLS Bank' },
      [item],
    );
    expect(reason).toBe('Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.');
    expect(suggestions).toEqual([]);
  });

  it('does not claim "no reference" when the reference parses but no invoice matches', () => {
    const { reason, suggestions } = suggestionsFor(
      { amountCents: 100, direction: 'in', description: '10010-20260529-01 ANAM: AFCV NRW', counterpartyName: 'AFCV NRW' },
      [],
    );
    expect(reason).toBe('Verwendungszweck 20260529-01 erkannt, aber keine passende Rechnung gefunden.');
    expect(suggestions).toEqual([]);
  });

  it('suggests an invoice imported as paid without a recorded payment, with its label', () => {
    const { reason, suggestions } = suggestionsFor(
      {
        amountCents: 226576,
        direction: 'in',
        description: '10010-20260529-01 ANAM: American Football und Cheerleading Verband NRW e.V.',
        counterpartyName: 'American Football und Cheerleading Verband Nordrhein-W',
      },
      [item, unassignedItem],
    );
    expect(reason).toBe('Verwendungszweck erkannt, Betrag/Nummer prüfen.');
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ id: 'inv2', invoiceNumber: '20260529-01', exact: true });
    expect(suggestions[0].why).toMatch(/als bezahlt importiert · Bankzahlung nicht zugeordnet/);
  });

  it('translates the missing-payment label', () => {
    const { suggestions } = suggestionsFor(
      { amountCents: 226576, direction: 'in', description: 'Zahlung', counterpartyName: 'AFCV NRW' },
      [unassignedItem],
      'en',
    );
    expect(suggestions[0].why).toMatch(/imported as paid · bank payment not assigned/);
  });

  it('outgoing rows get no invoice suggestions at all (they are expenses)', () => {
    const { suggestions } = suggestionsFor(
      { amountCents: 53550, direction: 'out', description: 'RNR 20260901-01 KD 10015 Datum 01.09.2026', counterpartyName: 'IT-AGILE GMBH' },
      [item],
    );
    expect(suggestions).toEqual([]);
  });
});
