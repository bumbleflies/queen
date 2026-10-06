import { describe, it, expect } from 'vitest';
import { normaliseServicePeriod } from '../servicePeriod';

describe('normaliseServicePeriod', () => {
  it("normalises '5.2025' → '05.2025'", () => {
    expect(normaliseServicePeriod('5.2025')).toBe('05.2025');
  });
  it("passes through '05.2025'", () => {
    expect(normaliseServicePeriod('05.2025')).toBe('05.2025');
  });
  it('throws on invalid month', () => {
    expect(() => normaliseServicePeriod('13.2025')).toThrow();
  });
  it('throws on wrong separator', () => {
    expect(() => normaliseServicePeriod('5-2025')).toThrow();
  });
  it('throws on empty string', () => {
    expect(() => normaliseServicePeriod('')).toThrow();
  });
});
