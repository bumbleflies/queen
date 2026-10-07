import { describe, it, expect } from 'vitest';
import { amountTokens, rankReceipts } from '../receipts';

const f = (name: string) => ({ id: name, name, link: `https://drive/${name}` });

describe('amountTokens', () => {
  it('renders German and dotted forms incl. thousands', () => {
    expect(amountTokens(123456)).toEqual(['1234,56', '1234.56', '1.234,56']);
    expect(amountTokens(824)).toEqual(['8,24', '8.24']);
  });
});

describe('rankReceipts', () => {
  const tx = { date: new Date(2026, 0, 30), amountCents: 11900, counterpartyName: 'Software Ltd' };

  it('ranks amount, date proximity and name tokens', () => {
    const ranked = rankReceipts(
      [f('20250105 - Other.pdf'), f('20260129 - 70003 - Software - Lizenz 119,00.pdf'), f('202601 - Software.pdf'), f('random.pdf')],
      tx,
    );
    expect(ranked.map((r) => r.name)).toEqual([
      '20260129 - 70003 - Software - Lizenz 119,00.pdf',
      '202601 - Software.pdf',
      '20250105 - Other.pdf',
      'random.pdf',
    ]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[3].score).toBe(0);
  });

  it('uses the supplier name when given', () => {
    const ranked = rankReceipts([f('a.pdf'), f('kammer beitrag.pdf')], { ...tx, counterpartyName: null }, 'Kammer');
    expect(ranked[0].name).toBe('kammer beitrag.pdf');
  });
});
