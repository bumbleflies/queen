import { describe, it, expect, vi } from 'vitest';
import {
  computeSyncWindow,
  syncBankTransactions,
  type BankTransactionModelLike,
} from '../bankSync';
import type { FireflyTransaction } from '../../services/FireflyClient';

const bankStart = new Date('2025-01-01T00:00:00Z');

describe('computeSyncWindow', () => {
  it('first run starts at QUEEN_BANK_START and ends today (inclusive)', () => {
    const now = new Date('2025-03-10T12:00:00Z');
    expect(computeSyncWindow({ bankStart, now })).toEqual({ from: bankStart, to: now });
  });

  it('subsequent run looks back 7 days from the last successful finish', () => {
    const now = new Date('2025-03-10T12:00:00Z');
    const lastRunFinishedAt = new Date('2025-03-05T06:30:00Z');
    const { from, to } = computeSyncWindow({ lastRunFinishedAt, bankStart, now });
    expect(from).toEqual(new Date('2025-02-26T06:30:00Z'));
    expect(to).toEqual(now);
  });

  it('ignores a null lastRunFinishedAt', () => {
    const now = new Date('2025-03-10T12:00:00Z');
    expect(computeSyncWindow({ lastRunFinishedAt: null, bankStart, now }).from).toEqual(bankStart);
  });

  it('full window starts at QUEEN_BANK_START even after earlier runs', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    const lastRunFinishedAt = new Date('2026-10-06T06:30:00Z');
    expect(computeSyncWindow({ lastRunFinishedAt, bankStart, now, full: true }).from).toEqual(bankStart);
  });
});

function makeModel() {
  const store = new Map<string, Record<string, unknown>>();
  const updateOne = vi.fn(
    async (
      filter: { fireflyJournalId: string },
      update: { $set: Record<string, unknown>; $setOnInsert: Record<string, unknown> },
    ) => {
      store.set(filter.fireflyJournalId, {
        ...store.get(filter.fireflyJournalId),
        ...update.$set,
        ...update.$setOnInsert,
      });
      return {};
    },
  );
  const model: BankTransactionModelLike = {
    updateOne: updateOne as unknown as BankTransactionModelLike['updateOne'],
  };
  return { model, store, updateOne };
}

const tx: FireflyTransaction = {
  fireflyJournalId: '42:0',
  date: new Date('2025-01-15T00:00:00Z'),
  amountCents: 107100,
  currency: 'EUR',
  description: 'Rechnung 10001-20250101-01',
  direction: 'in',
  counterpartyName: 'Acme GmbH',
  counterpartyIban: 'DE02120300000000202051',
};

const now = new Date('2025-03-10T12:00:00Z');
const window = { from: bankStart, to: now, now };

describe('syncBankTransactions', () => {
  it('upserts one row per transaction keyed by fireflyJournalId', async () => {
    const { model, store, updateOne } = makeModel();
    const client = { fetchTransactions: vi.fn(async () => [tx, { ...tx, fireflyJournalId: '43:0' }]) };

    const result = await syncBankTransactions({ client, ...window, model });

    expect(result).toEqual({ fetched: 2, upserted: 2 });
    expect(updateOne).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
    expect(store.get('42:0')).toMatchObject({
      fireflyJournalId: '42:0',
      amountCents: 107100,
      currency: 'EUR',
      description: 'Rechnung 10001-20250101-01',
      counterpartyName: 'Acme GmbH',
      counterpartyIban: 'DE02120300000000202051',
      direction: 'in',
      importedAt: now,
    });
  });

  it('is idempotent: re-syncing never duplicates rows', async () => {
    const { model, store } = makeModel();
    const client = { fetchTransactions: vi.fn(async () => [tx]) };

    await syncBankTransactions({ client, ...window, model });
    const second = await syncBankTransactions({ client, ...window, model });

    expect(second).toEqual({ fetched: 1, upserted: 1 });
    expect(store.size).toBe(1);
  });

  it('reports zero when Firefly returns nothing', async () => {
    const { model } = makeModel();
    const client = { fetchTransactions: vi.fn(async () => []) };
    expect(await syncBankTransactions({ client, ...window, model })).toEqual({
      fetched: 0,
      upserted: 0,
    });
  });
});
