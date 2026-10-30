import { describe, expect, it } from 'vitest';
import { parseAmountToken, parseBillText } from '../parseBill';

const HETZNER = `Hetzner Online GmbH
Industriestr. 25, 91710 Gunzenhausen
Rechnungsnummer: R-1234567
Rechnungsdatum: 01.10.2026
Fälligkeitsdatum: 15.10.2026
IBAN: DE44 5009 2100 0000 0595 12
Summe netto 100,00 EUR
19,00 % USt 19,00 EUR
Summe brutto 119,00 EUR
Vielen Dank für Ihren Auftrag.`;

const GOOGLE = `Google Ireland Limited
Gordon House, Barrow Street, Dublin 4, Ireland
Invoice number: 5100-1234
Invoice date: Oct 1, 2026
Payment due: Oct 31, 2026
Total in EUR 45.00
Reverse charge: VAT to be accounted for by the recipient.`;

describe('parseAmountToken', () => {
  it('reads German and English decimals without guessing thousands', () => {
    expect(parseAmountToken('1.234,56')).toBe(123456);
    expect(parseAmountToken('119,00')).toBe(11900);
    expect(parseAmountToken('119.00')).toBe(11900);
    expect(parseAmountToken('1.234')).toBe(123400);
    expect(parseAmountToken('1,234.56')).toBe(123456);
    expect(parseAmountToken('9329,6')).toBe(932960);
    expect(parseAmountToken('45')).toBe(4500);
  });

  it('returns null instead of throwing on junk', () => {
    expect(parseAmountToken('')).toBeNull();
    expect(parseAmountToken('1.2.3')).toBeNull();
    expect(parseAmountToken('R-1234567')).toBeNull();
  });
});

describe('parseBillText', () => {
  it('reads a German invoice: net, VAT rate, gross, IBAN, number, due date', () => {
    const bill = parseBillText(HETZNER, { fromName: 'Hetzner Online GmbH' });
    expect(bill).toMatchObject({
      vendorName: 'Hetzner Online GmbH',
      invoiceNumber: 'R-1234567',
      netCents: 10000,
      vatCents: 1900,
      grossCents: 11900,
      vatRate: 0.19,
      iban: 'DE445009210000000595 12'.replace(' ', ''),
      reverseCharge: false,
    });
    // Local German date (the container runs TZ=Europe/Berlin), not a UTC instant.
    expect(bill.dueDate && [bill.dueDate.getFullYear(), bill.dueDate.getMonth() + 1, bill.dueDate.getDate()]).toEqual([2026, 10, 15]);
  });

  it('reads an English invoice and its reverse charge, never assuming 19 %', () => {
    const bill = parseBillText(GOOGLE, { fromName: 'Google Ireland Ltd' });
    expect(bill.grossCents).toBe(4500);
    expect(bill.vatCents).toBe(0);
    expect(bill.vatRate).toBe(0);
    expect(bill.reverseCharge).toBe(true);
    expect(bill.invoiceNumber).toBe('5100-1234');
  });

  it('derives gross from net + VAT when only those are stated', () => {
    const bill = parseBillText('Rechnung\nNettobetrag 200,00 EUR\n7,00 % USt 14,00 EUR');
    expect(bill.netCents).toBe(20000);
    expect(bill.vatCents).toBe(1400);
    expect(bill.vatRate).toBe(0.07);
    expect(bill.grossCents).toBe(21400);
  });

  it('leaves unknown fields empty instead of inventing them', () => {
    const bill = parseBillText('Hallo, anbei die Rechnung.');
    expect(bill).toMatchObject({
      invoiceNumber: '',
      grossCents: null,
      netCents: null,
      vatCents: null,
      vatRate: null,
      iban: '',
      dueDate: null,
      reverseCharge: false,
    });
  });

  it('never treats a date or a number without a currency as the total', () => {
    const bill = parseBillText('Rechnungsdatum 01.10.2026\nKundennummer 12345\nSeite 1 von 2');
    expect(bill.grossCents).toBeNull();
    expect(bill.invoiceNumber).toBe('');
  });

  it('falls back to the first real line for the vendor when the mail has no name', () => {
    expect(parseBillText(HETZNER).vendorName).toBe('Hetzner Online GmbH');
    expect(parseBillText('Rechnung\nMusterfirma AG\nSumme brutto 10,00 EUR').vendorName).toBe('Musterfirma AG');
  });

  it('keeps the sender name when the PDF text has none', () => {
    expect(parseBillText('Summe brutto 10,00 EUR', { fromName: 'ACME Versand' }).vendorName).toBe('ACME Versand');
  });
});
