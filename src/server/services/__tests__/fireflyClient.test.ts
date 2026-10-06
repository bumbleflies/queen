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
        attributes: { transaction_journal_id: journalId, transactions: splits },
      },
    ],
    meta: { pagination: { total_pages: totalPages, current_page: currentPage } },
  };
}

const opts = { baseUrl: 'http://firefly:8080', pat: 'secret-pat', glsAccountId: '7' };

describe('FireflyClient.fetchDeposits', () => {
  it('parses a single page and maps split fields to cents', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, pageBody('42', [depositSplit()], 1, 1)));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    const txs = await client.fetchDeposits(
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
      destinationIban: 'DE02100500000054540402',
      sourceIban: 'DE02120300000000202051',
      sourceName: 'Acme GmbH',
    });
    expect(txs[0].date.toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('sends Authorization Bearer PAT and requests deposits for the account window', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, pageBody('42', [depositSplit()], 1, 1)));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await client.fetchDeposits(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/accounts/7/transactions');
    expect(url).toContain('type=deposit');
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

    const txs = await client.fetchDeposits(
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

    const txs = await client.fetchDeposits(
      new Date('2025-01-01T00:00:00Z'),
      new Date('2025-01-31T00:00:00Z'),
    );
    expect(txs[0].amountCents).toBe(1234);
  });

  it('maps 401 to FIREFLY_UNAUTHORIZED', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { message: 'Unauthenticated' }));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchDeposits(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAUTHORIZED' });
  });

  it('maps 5xx to FIREFLY_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { message: 'down' }));
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchDeposits(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAVAILABLE' });
  });

  it('maps network errors to FIREFLY_UNAVAILABLE', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(
      client.fetchDeposits(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toBeInstanceOf(FireflyError);
    await expect(
      client.fetchDeposits(new Date('2025-01-01T00:00:00Z'), new Date('2025-01-31T00:00:00Z')),
    ).rejects.toMatchObject({ code: 'FIREFLY_UNAVAILABLE' });
  });
});
