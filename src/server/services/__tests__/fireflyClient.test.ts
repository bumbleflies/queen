import { describe, it, expect, vi } from 'vitest';
import { FireflyClient, FireflyError } from '../FireflyClient';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function depositSplit(overrides: Record<string, unknown> = {}) {
  return {
    type: 'deposit',
    date: '2025-01-15T00:00:00+00:00',
    amount: '1071.00',
    currency_code: 'EUR',
    description: 'Rechnung 10001-20250101-01',
    source_name: 'Acme GmbH',
    source_iban: 'DE02120300000000202051',
    destination_name: 'GLS',
    destination_iban: 'DE02100500000054540402',
    ...overrides,
  };
}

function pageBody(
  journalId: string,
  splits: unknown[],
  totalPages: number,
  currentPage: number,
) {
  return {
    data: [
      {
        type: 'transactions',
        id: journalId,
        attributes: {
          transactions: (splits as Record<string, unknown>[]).map((s) => ({
            transaction_journal_id: journalId,
            ...s,
          })),
        },
      },
    ],
    meta: { pagination: { total_pages: totalPages, current_page: currentPage } },
  };
}

const opts = { baseUrl: 'http://firefly:8080', pat: 'secret-pat', glsAccountId: '7' };

describe('FireflyClient.fetchTransactions', () => {
  it('parses a single page and maps split fields to cents', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, pageBody('42', [depositSplit()], 1, 1)));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    const txs = await client.fetchTransactions(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      fireflyJournalId: '42:0',
      amountCents: 107100,
      currency: 'EUR',
      description: 'Rechnung 10001-20250101-01',
      direction: 'in',
      counterpartyName: 'Acme GmbH',
      counterpartyIban: 'DE02120300000000202051',
    });
    expect(txs[0].date.toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('sends Authorization Bearer PAT and requests deposits for the account window', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, pageBody('42', [depositSplit()], 1, 1)));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.fetchTransactions(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/accounts/7/transactions');
    expect(url).toContain('type=all');
    expect(url).toContain('start=2025-01-01');
    expect(url).toContain('end=2025-01-31');
    expect(url).toContain('limit=100');
    expect(url).toContain('page=1');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-pat');
    expect(headers.Accept).toBe('application/json');
  });

  it('paginates across meta.pagination.total_pages', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return jsonResponse(
        200,
        pageBody(String(100 + page), [depositSplit({ description: `page ${page}` })], 2, page),
      );
    });
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    const txs = await client.fetchTransactions(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const pages = fetchImpl.mock.calls.map(
      (c) => Number(new URL((c as unknown as [string])[0]).searchParams.get('page')),
    );
    expect(pages).toEqual([1, 2]);
    expect(txs.map((t) => t.fireflyJournalId)).toEqual(['101:0', '102:0']);
  });

  it('uses absolute value for negative deposit amounts', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, pageBody('42', [depositSplit({ amount: '-12.34' })], 1, 1)),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    const txs = await client.fetchTransactions(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );
    expect(txs[0].amountCents).toBe(1234);
  });

  it('maps 401 to FIREFLY_UNAUTHORIZED', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'Unauthenticated' }));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchTransactions(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAUTHORIZED' });
  });

  it('maps 5xx to FIREFLY_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: 'down' }));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchTransactions(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAVAILABLE' });
  });

  it('maps network errors to FIREFLY_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchTransactions(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toBeInstanceOf(FireflyError);
    await expect(
      client.fetchTransactions(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAVAILABLE' });
  });
});

function withdrawalSplit(overrides: Record<string, unknown> = {}) {
  return {
    type: 'withdrawal',
    date: '2026-01-30T00:00:00+00:00',
    amount: '8.24',
    currency_code: 'EUR',
    description: 'Abrechnung vom 29.01.2026',
    source_name: 'GLS',
    source_iban: 'DE02100500000054540402',
    destination_name: 'Beispiel Software Ltd',
    destination_iban: 'IE29AIBK93115212345678',
    ...overrides,
  };
}

describe('FireflyClient.fetchTransactions directions', () => {
  it('maps withdrawals to direction out with the destination as counterparty and skips transfers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        200,
        {
          data: [
            { type: 'transactions', id: '312', attributes: { transactions: [withdrawalSplit({ transaction_journal_id: '50' })] } },
            { type: 'transactions', id: '313', attributes: { transactions: [depositSplit({ transaction_journal_id: '51' })] } },
            { type: 'transactions', id: '314', attributes: { transactions: [depositSplit({ transaction_journal_id: '52', type: 'transfer' })] } },
          ],
          meta: { pagination: { total_pages: 1, current_page: 1 } },
        },
      ),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const txs = await client.fetchTransactions(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z'));
    expect(String(fetchImpl.mock.calls[0][0])).toContain('type=all');
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({
      fireflyJournalId: '50:0',
      direction: 'out',
      amountCents: 824,
      counterpartyName: 'Beispiel Software Ltd',
      counterpartyIban: 'IE29AIBK93115212345678',
    });
    expect(txs[1]).toMatchObject({ fireflyJournalId: '51:0', direction: 'in', counterpartyName: 'Acme GmbH' });
  });

  it('keys rows by the split-level journal id so journals never collapse onto unknown:N', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        200,
        {
          data: [
            { type: 'transactions', id: '312', attributes: { transactions: [withdrawalSplit({ transaction_journal_id: '501' })] } },
            { type: 'transactions', id: '313', attributes: { transactions: [withdrawalSplit({ transaction_journal_id: '502' })] } },
          ],
          meta: { pagination: { total_pages: 1, current_page: 1 } },
        },
      ),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const txs = await client.fetchTransactions(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z'));
    expect(txs.map((t) => t.fireflyJournalId)).toEqual(['501:0', '502:0']);
  });

  it('falls back to the journal id when a split carries no journal id', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        200,
        {
          data: [
            { type: 'transactions', id: '312', attributes: { transactions: [withdrawalSplit()] } },
          ],
          meta: { pagination: { total_pages: 1, current_page: 1 } },
        },
      ),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const txs = await client.fetchTransactions(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z'));
    expect(txs.map((t) => t.fireflyJournalId)).toEqual(['312:0']);
  });
});

describe('FireflyClient.fetchBalance', () => {
  it('reads current_balance for the given date as cents', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: { attributes: { current_balance: '1234.56' } } }),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.fetchBalance(new Date(2026, 11, 31))).toBe(123456);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://firefly:8080/api/v1/accounts/7?date=2026-12-31');
  });
});
