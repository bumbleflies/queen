import { describe, expect, it } from 'vitest';
import { formatBooking, type BookingShape } from '../lib/bookingLabel';
import { de } from '../i18n/de';
import type { DictKey } from '../i18n/de';
import { formatEUR } from '../lib/format';

const t = (key: DictKey): string => de[key] ?? key;

const shape = (over: Partial<BookingShape> = {}): BookingShape => ({ account: '6837', vatRate: 0.19, mode: 'normal', ...over });

describe('formatBooking', () => {
  it('spells out account, rate and mode, so a §13b booking never reads like a normal one', () => {
    expect(formatBooking(shape(), t)).toBe('6837 · 19 %');
    expect(formatBooking(shape({ mode: 'reverseCharge' }), t)).toBe('6837 · 19 % · §13b');
  });

  it('uses the account name when the caller has the chart of accounts', () => {
    const names = (account: string) => (account === '6837' ? 'Lizenzen' : undefined);
    expect(formatBooking(shape(), t, names)).toBe('6837 Lizenzen · 19 %');
  });

  it('keeps the VAT rate with a §13b split part and with vatOnly rows', () => {
    expect(formatBooking(shape({ account: undefined, mode: 'vatOnly' }), t)).toBe('nur USt · 19 %');
    expect(formatBooking(shape({ account: undefined, mode: 'vatOnly', vatRate: 0.07 }), t)).toBe('nur USt · 7 %');
  });

  it('says so when a rule does not pin a VAT rate', () => {
    expect(formatBooking(shape({ vatRate: undefined }), t)).toBe('6837 · USt-Satz offen');
  });

  it('lists a split by its parts, so two different splits never render the same', () => {
    const a = formatBooking(
      shape({
        account: undefined,
        split: [
          { account: '6837', vatRate: 0.19, grossCents: 8330, mode: 'normal' },
          { account: '6830', vatRate: 0.07, grossCents: 3570, mode: 'normal' },
        ],
      }),
      t,
    );
    const b = formatBooking(
      shape({
        account: undefined,
        split: [
          { account: '6837', vatRate: 0.19, grossCents: 3570, mode: 'normal' },
          { account: '6830', vatRate: 0.07, grossCents: 8330, mode: 'normal' },
        ],
      }),
      t,
    );
    expect(a).toBe(`Aufteilung auf 2 Konten · 6837 19 % · ${formatEUR(8330)} + 6830 7 % · ${formatEUR(3570)}`);
    expect(a).not.toBe(b);
  });

  it('tags a §13b part inside a split', () => {
    const label = formatBooking(
      shape({
        account: undefined,
        split: [
          { account: '6837', vatRate: 0.19, grossCents: 8330, mode: 'reverseCharge' },
          { account: '6830', vatRate: 0.07, grossCents: 3570, mode: 'normal' },
        ],
      }),
      t,
    );
    expect(label).toContain('6837 19 % §13b');
  });

  it('treats a one-part split as a single booking', () => {
    expect(
      formatBooking(shape({ split: [{ account: '6837', vatRate: 0.19, grossCents: 11900, mode: 'normal' }] }), t),
    ).toBe('6837 · 19 %');
  });
});
