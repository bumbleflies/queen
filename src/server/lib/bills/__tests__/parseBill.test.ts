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

// The PDF text layer of a Hetzner invoice: a table whose period column
// (`10/2026`) sits right before the first money column, a `Total (excl. VAT)`
// table header, a VAT registration number, and a `Total` row that lists net,
// VAT and gross in one line.
const HETZNER_TABLE = `Hetzner Online GmbH • Industriestr. 25 • 91710 Gunzenhausen • Germany
bumbleflies UG (haftungsbeschränkt)
Gleiwitzer-Str., 6d
81929 München
Germany
VAT Reg. No.: DE812871812
Invoice no.: 087001370124
Invoice date: 16/11/2026
Invoice 087001370124
Overview
Service Period Total (excl. VAT) Tax Total
Project "servy" 10/2026 € 7.00 € 1.33A1 € 8.33
Storage 10/2026 € 3.20 € 0.61A1 € 3.81
Total € 10.20 € 1.94 € 12.14
Tax code Tax rate Total (excl. VAT) Taxable Tax Total
A1 19 % € 10.20 € 10.20 € 1.94 € 12.14
Total € 10.20 € 10.20 € 1.94 € 12.14
The amount will be debited from the following account.
IBAN: DE92 7607 0012 0750 0077 00
Due date of payment: 19/11/2026`;

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

const PORKBUN = `INVOICE PA I D
Porkbun LLC
11575 SW Pacific Hwy PMB 40649 Tigard, OR 97223, US
EIN: 46-3699764
Sold to:
bumbleflies UG (haftungsbeschränkt) Christian Reitmorstr. 54 Munich, Bavaria 80538 DE VAT:
DE336262972
Invoice #: 12610616
Date Paid: 2026-11-18
Paid With:
Account Credit
DOMAIN PRODUCT TERM STATUS AMOUNT (USD)
bumbleflies.de Domain Transfer 1 yr SUCCESS $5.10
Total Paid USD $5.10
Paid in full. This invoice serves as your receipt.`;

describe('parseBillText', () => {
  it('does not read a ZIP code as VAT when the label trails the address line', () => {
    const bill = parseBillText(PORKBUN, { fromName: 'Porkbun LLC' });
    expect(bill.vatCents).toBeNull();
    expect(bill.vatRate).toBeNull();
    expect(bill.grossCents).toBe(510);
  });

  it('still reads VAT when the amount follows the label', () => {
    expect(parseBillText('Rechnung\n19 % USt 19,00 EUR\nSumme brutto 119,00 EUR', { fromName: 'X GmbH' })).toMatchObject({
      vatCents: 1900,
      vatRate: 0.19,
    });
    expect(parseBillText('Invoice\nVAT (19%) € 1.94\nTotal € 12.14', { fromName: 'X Ltd' })).toMatchObject({
      vatCents: 194,
      vatRate: 0.19,
    });
    expect(parseBillText('Invoice\nTax $0.00\nTotal $5.10', { fromName: 'X LLC' })).toMatchObject({ vatCents: 0 });
  });

  it('never reads a total line that merely mentions VAT as the VAT amount', () => {
    expect(parseBillText('Invoice\nTotal 12,14 EUR (inkl. USt)', { fromName: 'X GmbH' }).vatCents).toBeNull();
    expect(parseBillText('Invoice\nVAT Reg. No.: DE812871812\nTotal 12,14 EUR', { fromName: 'X GmbH' }).vatCents).toBeNull();
  });
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

  it('parses a forwarded Bundesanzeiger invoice (letterhead, header number, value-before-label gross)', () => {
    // Forwarded mail: the sender is the forwarder, not the vendor. The vendor
    // is the letterhead, the invoice number lives in the `#####...~no~...~`
    // header line, and the gross sits on the line before its label.
    const text = `#####Rechnung~98848178~103855369~24.08.26
Amsterdamer Str. 192
50735 Köln
Ust-Ident-Nr. DE 122 787 997
Bundesanzeiger Verlag GmbH - Postfach 100534 - 50445 Köln
Bankverbindung:
Konto 399 509
Postbank Köln, BLZ 370 100 50
IBAN DE57 3701 0050 0000 3995 09
BIC-CODE PBNKDEFFXXX
bumbleflies UG (haftungsbeschränkt)
Kundennummer
103855369
bei Zahlungen und Rückfragen bitte angeben
98848178
RechnungsdatumRechnungsnummer
Rechnung
Seite 1 von 2
24.08.2026
I
Rechnungs-
betrag €
Preis
€
AnzahlBestellzeichen
Offenlegung
MwSt
Schl.
Auftrags-
nummer
MwSt-Schlüssel :
49,15
3 7,85
41,30
49,15Zahlbar ohne Abzüge innerhalb von 14 Tagen
Brutto-Rechnungsbetrag
Netto-Rechnungsbetrag
%19,00`;

    const bill = parseBillText(text, { fromName: 'Sebastian Keller' });
    expect(bill.vendorName).toContain('Bundesanzeiger Verlag GmbH');
    expect(bill.vendorName).not.toBe('Sebastian Keller');
    expect(bill.invoiceNumber).toBe('98848178');
    expect(bill.grossCents).toBe(4915);
    expect(bill.iban).toBe('DE57370100500000399509');
  });

  it('reads a table invoice: the gross of a Total row, not its net column or a period', () => {
    // "Service Period Total (excl. VAT) Tax Total" used to be taken as the gross
    // label, and the period of the next row ("10/2026 €") as the amount — which
    // made a 12,14 € invoice read as 2.026,00 €.
    const bill = parseBillText(HETZNER_TABLE);
    expect(bill.grossCents).toBe(1214);
    expect(bill.invoiceNumber).toBe('087001370124');
    expect(bill.iban).toBe('DE92760700120750007700');
    // The letterhead is the vendor line, its address is not part of the name.
    expect(bill.vendorName).toBe('Hetzner Online GmbH');
    expect(bill.dueDate && [bill.dueDate.getFullYear(), bill.dueDate.getMonth() + 1, bill.dueDate.getDate()]).toEqual([2026, 11, 19]);
  });

  it('never reads a VAT registration number as a VAT amount', () => {
    const bill = parseBillText('Musterfirma GmbH\nVAT Reg. No.: DE336262972\nTotal 12,14 EUR');
    expect(bill.vatCents).toBeNull();
    expect(bill.grossCents).toBe(1214);
    const german = parseBillText('Musterfirma GmbH\nUst-Ident-Nr. DE 122 787 997\nBrutto-Rechnungsbetrag\n49,15');
    expect(german.vatCents).toBeNull();
    expect(german.grossCents).toBe(4915);
  });

  it('does not take a net column header as the gross', () => {
    const bill = parseBillText('Musterfirma GmbH\nTotal (excl. VAT) € 10.20');
    expect(bill.grossCents).toBeNull();
    expect(bill.vatCents).toBeNull();
  });

  it('prefers the label line over a line item that happens to sit above it', () => {
    // No value-before-label when the label line states the amount itself.
    const bill = parseBillText('Musterfirma GmbH\nSpeicher 10/2026 € 3,20\nTotal € 10,20 € 1,94 € 12,14');
    expect(bill.grossCents).toBe(1214);
  });
});
