import { describe, it, expect } from 'vitest';
import { BankTransaction } from '../BankTransaction';

describe('BankTransaction schema', () => {
  it('declares exactly one unique index on fireflyJournalId (no duplicate)', () => {
    const journalIndexes = BankTransaction.schema
      .indexes()
      .filter(([fields]) => 'fireflyJournalId' in fields);

    expect(journalIndexes).toHaveLength(1);
    expect(journalIndexes[0][1]).toMatchObject({ unique: true });
  });
});
