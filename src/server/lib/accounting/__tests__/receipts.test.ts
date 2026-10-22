import { describe, it, expect } from 'vitest';
import { amountTokens, rankReceipts, receiptCandidates, strongReceipt } from '../receipts';

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

describe('rankReceipts — Verwendungszweck', () => {
  const out = { date: new Date(2026, 9, 21), amountCents: 1213, counterpartyName: 'Hoster GmbH' };

  it('matches an invoice number from the purpose against the file name', () => {
    const ranked = rankReceipts(
      [f('Hoster_2026-09-16_100000654321.pdf'), f('Hoster_2026-10-16_100000123456.pdf')],
      { ...out, description: 'Customer No. K0000000001 Invoice No. 100000123456 EREF: 000000000001 MREF: M-K00' },
    );
    expect(ranked[0].name).toBe('Hoster_2026-10-16_100000123456.pdf');
    expect(strongReceipt(ranked)?.name).toBe('Hoster_2026-10-16_100000123456.pdf');
  });

  it('ignores digit runs that only partially overlap', () => {
    const ranked = rankReceipts([f('x_1000001234561.pdf')], { ...out, counterpartyName: null, description: 'Invoice 100000123456' });
    expect(ranked[0].score).toBe(0);
  });

  it('matches the file name written into the purpose and a Drive link', () => {
    const files = [f('Spesen - Kim - Kantine - 08_2026.pdf'), f('Spesen - Alex - 08_2026.pdf'), { id: '1AbCdEfGhIjKlMnOpQr', name: 'beleg.pdf', link: 'l' }];
    const tx = { date: new Date(2026, 8, 3), amountCents: 6390, counterpartyName: 'Alex Muster' };
    expect(strongReceipt(rankReceipts(files, { ...tx, description: 'Spesen - Alex - 08_2026 auslage' }))?.name).toBe('Spesen - Alex - 08_2026.pdf');
    expect(strongReceipt(rankReceipts(files, { ...tx, description: 'Spesen https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr' }))?.id).toBe('1AbCdEfGhIjKlMnOpQr');
  });
});

describe('strongReceipt', () => {
  it('needs a score of 5 and a unique leader', () => {
    expect(strongReceipt([{ ...f('a'), score: 4 }])).toBeNull();
    expect(strongReceipt([{ ...f('a'), score: 5 }, { ...f('b'), score: 5 }])).toBeNull();
    expect(strongReceipt([{ ...f('a'), score: 6 }, { ...f('b'), score: 5 }])?.name).toBe('a');
    expect(strongReceipt([])).toBeNull();
  });
});

describe('receiptCandidates', () => {
  const tx = {
    date: new Date(2026, 8, 3),
    amountCents: 5460,
    counterpartyName: 'Christian Dähn',
    description: '2x Spesen - Chris - Augustiner - 08/2026 + Spesen - Chris - Augustiner - 08.2/2026 SecureGo plus',
  };
  const files = [
    f('Spesen - Chris - Augustiner - 08/2026.pdf'),
    f('Spesen - Chris - Augustiner - 08_2/2026.pdf'),
    f('Spesen - Kim - Kantine - 08_2026.pdf'),
    f('Spesen - Chris - Augustiner - 09/2026.pdf'),
    f('random.pdf'),
  ];

  it('adds the sibling file that the score alone would miss', () => {
    expect(receiptCandidates(tx, files, 'Augustiner Keller').map((r) => r.name)).toEqual([
      'Spesen - Chris - Augustiner - 08/2026.pdf',
      'Spesen - Chris - Augustiner - 08_2/2026.pdf',
    ]);
  });

  it('keeps the attached receipt first and does not duplicate it', () => {
    const attached = { receipt: { driveFileId: 'Spesen - Chris - Augustiner - 08_2/2026.pdf', fileName: 'Spesen - Chris - Augustiner - 08_2/2026.pdf' } };
    const names = receiptCandidates({ ...tx, ...attached }, files, 'Augustiner Keller').map((r) => r.name);
    expect(names[0]).toBe('Spesen - Chris - Augustiner - 08_2/2026.pdf');
    expect(names).toContain('Spesen - Chris - Augustiner - 08/2026.pdf');
    expect(new Set(names).size).toBe(names.length);
  });

  it('caps the list at three files', () => {
    const many = [f('Spesen - Chris - Augustiner - 08/2026.pdf'), f('Spesen - Chris - Augustiner - 08_2/2026.pdf'), f('Spesen - Chris - Augustiner - 08_3/2026.pdf'), f('Spesen - Chris - Augustiner - 08_4/2026.pdf')];
    expect(receiptCandidates(tx, many, 'Augustiner Keller')).toHaveLength(3);
  });

  it('returns nothing without a strong seed', () => {
    expect(receiptCandidates({ ...tx, amountCents: 1234, description: '' }, [f('random.pdf'), f('2026-01-01 something.pdf')], null)).toEqual([]);
  });
});
