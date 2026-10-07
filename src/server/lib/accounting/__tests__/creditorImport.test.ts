import { describe, it, expect } from 'vitest';
import { parseCreditorsCsv } from '../creditorImport';

describe('parseCreditorsCsv', () => {
  it('reads creditorName/creditorId columns in any order', () => {
    expect(parseCreditorsCsv('creditorId,creditorName\n70001,Bank A\n70002,"Amt, Stadt"\n')).toEqual({
      rows: [
        { kreditorNumber: 70001, name: 'Bank A' },
        { kreditorNumber: 70002, name: 'Amt, Stadt' },
      ],
      errors: [],
    });
  });

  it('reports missing headers, bad numbers, empty names and duplicates', () => {
    expect(parseCreditorsCsv('name,id\n1,x').errors).toEqual(['Kopfzeile braucht creditorName und creditorId']);
    expect(parseCreditorsCsv('creditorName,creditorId\nA,123\n,70002\nB,70003\nC,70003').errors).toEqual([
      'Zeile 2: Kreditornummer 123 außerhalb 70000–99999',
      'Zeile 3: Name fehlt',
      'Zeile 5: Kreditornummer 70003 doppelt',
    ]);
  });
});
