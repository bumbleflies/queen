import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { parseCsv, buildImportPlan, parseGermanDate } from '../sheetImport';

const dir = path.join(__dirname, 'fixtures', 'sheet');
const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
const input = {
  clientsCsv: read('clientData.csv'),
  invoicesCsv: read('invoiceData.csv'),
  positionsCsv: read('invoicePositions.csv'),
};

describe('parseCsv', () => {
  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('"a","b, c"\n"x ""y""","line1\nline2"\n')).toEqual([
      ['a', 'b, c'],
      ['x "y"', 'line1\nline2'],
    ]);
  });

  it('handles CRLF line endings and drops trailing empty rows', () => {
    expect(parseCsv('a,b\r\nc,d\r\n\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseGermanDate', () => {
  it('parses DD.MM.YYYY as local midnight', () => {
    const d = parseGermanDate('21.12.2020');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2020, 11, 21, 0]);
  });

  it('rejects other formats and impossible dates', () => {
    expect(() => parseGermanDate('2020-12-21')).toThrow();
    expect(() => parseGermanDate('31.02.2020')).toThrow();
  });
});

describe('buildImportPlan', () => {
  const plan = buildImportPlan(input);
  const byNumber = (n: string) => plan.invoices.find((i) => i.invoiceNumber === n)!;

  it('maps clients keeping customerNumber, trimming domain, using last used payment term', () => {
    expect(plan.clients).toHaveLength(3);
    const c1 = plan.clients.find((c) => c.customerNumber === 10001)!;
    expect(c1.name).toBe('Muster Wohnen GmbH');
    expect(c1.domain).toBe('muster-wohnen.example');
    expect(c1.invoiceAddress).toContain('\n80335 München');
    // 10001: 1001 (14 days, 2020) then 20250821-01 (30 days, 2026) → 30
    expect(c1.defaultPaymentTermDays).toBe(30);
    expect(plan.clients.find((c) => c.customerNumber === 10003)!.domain).toBeUndefined();
  });

  it('flags non YYYYMMDD-NN numbers as legacy', () => {
    expect(byNumber('1001').legacy).toBe(true);
    expect(byNumber('20230511-01').legacy).toBe(false);
  });

  it('maps states: open/overdue → sent, paid → paid + importedPaid, draft, canceled', () => {
    expect(byNumber('20241209-01').status).toBe('sent');
    expect(byNumber('20250901-01').status).toBe('sent');
    expect(byNumber('1001')).toMatchObject({ status: 'paid', importedPaid: true });
    expect(byNumber('20250617-01').status).toBe('draft');
    expect(byNumber('20250821-01').status).toBe('canceled');
  });

  it('parses dates, normalises periods, computes due date from payment term', () => {
    const inv = byNumber('20250617-01');
    expect(inv.servicePeriod).toBe('05.2025');
    const sent = byNumber('20241209-01');
    expect(sent.invoiceDate!.getDate()).toBe(9);
    expect(sent.paymentTermDays).toBe(30);
    expect(sent.dueDate!.getTime() - sent.invoiceDate!.getTime()).toBeGreaterThanOrEqual(
      30 * 86400000 - 3600000,
    );
  });

  it('strips "Gebucht - " from the Drive file name; empty file name → undefined', () => {
    expect(byNumber('20230511-01').driveFileName).toBe(
      '2023-05.20230511-01 - beispiel - Moderation Teammeeting.pdf',
    );
    expect(byNumber('20250617-01').driveFileName).toBeUndefined();
  });

  it('converts lines: German amounts → cents, % → rate, negatives kept', () => {
    const lines = byNumber('20230511-01').lines;
    expect(lines).toHaveLength(6);
    expect(lines[2]).toMatchObject({ unitNetCents: -10000, vatRate: 0.19, quantity: 1 });
    expect(byNumber('1001').lines[0]).toMatchObject({ unitNetCents: 160000, vatRate: 0.16 });
    expect(byNumber('20241209-01').lines[0]).toMatchObject({
      quantity: 4,
      unitNetCents: 9500,
      vatRate: 0,
    });
  });

  it('numbers empty positions sequentially in sheet order and warns', () => {
    expect(byNumber('20230511-01').lines.map((l) => l.position)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ]);
    expect(plan.warnings.some((w) => w.includes('20230511-01') && w.includes('position'))).toBe(
      true,
    );
  });

  it('recomputes totals and matches the 20230511-01 sheet sums', () => {
    expect(byNumber('20230511-01').totals).toEqual({
      netCents: 472000,
      vatCents: 89680,
      grossCents: 561680,
    });
  });

  it('reports total mismatches without auto-fixing', () => {
    const inv = byNumber('20250901-01');
    expect(inv.totals.vatCents).toBe(1900);
    expect(plan.mismatches).toEqual([
      expect.objectContaining({
        invoiceNumber: '20250901-01',
        sheet: { netCents: 10000, vatCents: 2000, grossCents: 11900 },
        computed: { netCents: 10000, vatCents: 1900, grossCents: 11900 },
      }),
    ]);
  });

  it('warns about canceled invoices without a credit note', () => {
    expect(plan.warnings.some((w) => w.includes('20250821-01') && /credit note/i.test(w))).toBe(
      true,
    );
  });

  it('errors on invoices referencing unknown clients and on lines for unknown invoices', () => {
    const bad = buildImportPlan({
      ...input,
      invoicesCsv: input.invoicesCsv.replace('"20241209-01","10003"', '"20241209-01","19999"'),
      positionsCsv: input.positionsCsv + '"99999999-01","1","x","1","1,00 €","19%","","","",""\n',
    });
    expect(bad.errors.some((e) => e.includes('20241209-01') && e.includes('19999'))).toBe(true);
    expect(bad.errors.some((e) => e.includes('99999999-01'))).toBe(true);
    expect(bad.invoices.find((i) => i.invoiceNumber === '20241209-01')).toBeUndefined();
  });

  it('errors on missing header columns', () => {
    expect(() => buildImportPlan({ ...input, clientsCsv: '"foo","bar"\n"1","2"\n' })).toThrow(
      /clientId/,
    );
  });
});
