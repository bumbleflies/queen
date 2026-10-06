import { describe, it, expect } from 'vitest';
import { renderInvoiceText, generateInvoicePdf } from '../PdfService';
import type { InvoiceLike, InvoiceLineLike } from '../PdfService';

// NB: formatGermanEUR separates amount and currency with a non-breaking space.

const multiRateInvoice: InvoiceLike = {
  invoiceNumber: '20250101-01',
  customerNumber: 10001,
  kind: 'invoice',
  title: 'Beratung Mai',
  invoiceAddress: 'Acme GmbH\nMusterstr. 1\n12345 Berlin',
  invoiceDate: new Date('2025-05-12T00:00:00'),
  servicePeriod: '05.2025',
  paymentTermDays: 30,
  dueDate: new Date('2025-06-11T00:00:00'),
  currency: 'EUR',
  footerNotes: ['Vielen Dank für die Zusammenarbeit.'],
};

const multiRateLines: InvoiceLineLike[] = [
  {
    position: '1',
    description: 'Beratung',
    quantity: 1,
    unitNetCents: 100000,
    vatRate: 0.19,
  },
  {
    position: '1.1',
    description: 'Rabatt',
    quantity: 1,
    unitNetCents: -10000,
    vatRate: 0.19,
  },
  {
    position: '2',
    description: 'Steuerfreie Leistung',
    quantity: 1,
    unitNetCents: 50000,
    vatRate: 0,
    vatNote: '§ 4 Nr. 21 a) bb) UStG steuerbefreit',
  },
];

const creditNoteInvoice: InvoiceLike = {
  invoiceNumber: '20250601-02',
  customerNumber: 10001,
  kind: 'credit_note',
  title: 'Storno zu 20250101-01',
  invoiceAddress: 'Acme GmbH\nMusterstr. 1\n12345 Berlin',
  invoiceDate: new Date('2025-06-01T00:00:00'),
  servicePeriod: '05.2025',
  paymentTermDays: 30,
  dueDate: new Date('2025-07-01T00:00:00'),
  currency: 'EUR',
  footerNotes: [],
};

const creditNoteLines: InvoiceLineLike[] = [
  {
    position: '1',
    description: 'Beratung (Storno)',
    quantity: 1,
    unitNetCents: -100000,
    vatRate: 0.19,
  },
];

describe('renderInvoiceText', () => {
  it('renders a multi-rate invoice with vatNote, hierarchical positions and a negative discount line', () => {
    const text = renderInvoiceText(multiRateInvoice, multiRateLines);

    expect(text).toContain('Beratung Mai');
    expect(text).toContain('Rechnungsnummer: 20250101-01');
    expect(text).toContain('Acme GmbH');
    expect(text).toContain('Leistungszeitraum: 05.2025');
    expect(text).toContain('Zahlungsziel: 30 Tage');
    expect(text).toContain('Fällig am: 11.06.2025');

    // hierarchical positions
    expect(text).toContain('1.1');
    // negative discount line keeps the minus sign
    expect(text).toContain('-100,00\u00a0€');
    // per-line VAT exemption note
    expect(text).toContain('§ 4 Nr. 21 a) bb) UStG steuerbefreit');

    // VAT breakdown grouped by rate
    expect(text).toContain('USt. 19%');
    expect(text).toContain('USt. 0%');
    expect(text).toContain('171,00\u00a0€');

    // totals
    expect(text).toContain('Netto: 1.400,00\u00a0€');
    expect(text).toContain('USt.: 171,00\u00a0€');
    expect(text).toContain('Brutto: 1.571,00\u00a0€');

    // payment reference
    expect(text).toContain('Verwendungszweck: 10001-20250101-01');

    // footer notes
    expect(text).toContain('Vielen Dank für die Zusammenarbeit.');
  });

  it('renders a credit note with "Stornorechnung zu <nr>" and negative totals', () => {
    const text = renderInvoiceText(creditNoteInvoice, creditNoteLines);

    expect(text).toContain('Stornorechnung zu 20250101-01');
    expect(text).toContain('-1.000,00\u00a0€');
    expect(text).toContain('Netto: -1.000,00\u00a0€');
    expect(text).toContain('USt.: -190,00\u00a0€');
    expect(text).toContain('Brutto: -1.190,00\u00a0€');
    expect(text).toContain('Verwendungszweck: 10001-20250601-02');
  });
});

describe('generateInvoicePdf', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buffer = await generateInvoicePdf(multiRateInvoice, multiRateLines);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('latin1')).toBe('%PDF');
  });
});
