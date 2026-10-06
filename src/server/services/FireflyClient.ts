import { fireflyAmountToCents } from '../lib/money';

/** Typed errors surfaced by {@link FireflyClient}; never thrown into CRUD paths. */
export type FireflyErrorCode = 'FIREFLY_UNAUTHORIZED' | 'FIREFLY_UNAVAILABLE';

export class FireflyError extends Error {
  readonly code: FireflyErrorCode;

  constructor(code: FireflyErrorCode, message: string) {
    super(message);
    this.name = 'FireflyError';
    this.code = code;
  }
}

/** A bank deposit mapped from one Firefly III transaction split. */
export interface FireflyTransaction {
  /** Stable idempotency key: `<transaction_journal_id>:<splitIndex>`. */
  fireflyJournalId: string;
  date: Date;
  /** Positive integer cents for the deposit. */
  amountCents: number;
  currency: string;
  description: string;
  destinationIban?: string;
  sourceIban?: string;
  sourceName?: string;
}

export interface FireflyClientOptions {
  baseUrl: string;
  pat: string;
  glsAccountId: string;
  fetchImpl?: typeof fetch;
}

interface FireflySplit {
  date?: string;
  amount?: string;
  currency_code?: string;
  description?: string;
  source_name?: string;
  source_iban?: string;
  destination_name?: string;
  destination_iban?: string;
}

interface FireflyJournal {
  attributes?: {
    transaction_journal_id?: string | number;
    transactions?: FireflySplit[];
  };
}

interface FireflyDepositsResponse {
  data?: FireflyJournal[];
  meta?: { pagination?: { total_pages?: number; current_page?: number } };
}

const PAGE_LIMIT = 100;

function formatDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Minimal Firefly III API v1 client for reading GLS deposits. Paginates
 * `GET /api/v1/accounts/{glsAccountId}/transactions` using the response's
 * `meta.pagination.total_pages`. Dates are inclusive; amounts become integer
 * cents. The `fetchImpl` is injectable so tests never touch the network.
 */
export class FireflyClient {
  private readonly baseUrl: string;
  private readonly pat: string;
  private readonly glsAccountId: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: FireflyClientOptions) {
    if (!options.baseUrl || !options.pat || !options.glsAccountId) {
      throw new Error('FireflyClient requires baseUrl, pat and glsAccountId');
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.pat = options.pat;
    this.glsAccountId = options.glsAccountId;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async fetchDeposits(start: Date, end: Date): Promise<FireflyTransaction[]> {
    const out: FireflyTransaction[] = [];
    let page = 1;
    let totalPages = 1;

    do {
      const url =
        `${this.baseUrl}/api/v1/accounts/${this.glsAccountId}/transactions` +
        `?type=deposit&start=${formatDate(start)}&end=${formatDate(end)}` +
        `&limit=${PAGE_LIMIT}&page=${page}`;

      const body = await this.getJson<FireflyDepositsResponse>(url);
      totalPages = body.meta?.pagination?.total_pages ?? 1;
      const journals = body.data ?? [];
      if (journals.length === 0) break;

      for (const journal of journals) {
        const attributes = journal.attributes;
        const journalId = attributes?.transaction_journal_id;
        const splits = attributes?.transactions ?? [];
        splits.forEach((split, splitIndex) => {
          out.push(this.mapSplit(journalId, splitIndex, split));
        });
      }
      page += 1;
    } while (page <= totalPages);

    return out;
  }

  private mapSplit(
    journalId: string | number | undefined,
    splitIndex: number,
    split: FireflySplit,
  ): FireflyTransaction {
    return {
      fireflyJournalId: `${journalId ?? 'unknown'}:${splitIndex}`,
      date: split.date ? new Date(split.date) : new Date(0),
      amountCents: Math.abs(fireflyAmountToCents(split.amount ?? '0')),
      currency: split.currency_code ?? 'EUR',
      description: split.description ?? '',
      destinationIban: split.destination_iban,
      sourceIban: split.source_iban,
      sourceName: split.source_name,
    };
  }

  private async getJson<T>(url: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${this.pat}`,
          Accept: 'application/json',
        },
      });
    } catch (err) {
      throw new FireflyError(
        'FIREFLY_UNAVAILABLE',
        `Firefly request failed: ${(err as Error).message}`,
      );
    }

    if (res.status === 401) {
      throw new FireflyError('FIREFLY_UNAUTHORIZED', 'Firefly PAT rejected (401)');
    }
    if (!res.ok) {
      throw new FireflyError('FIREFLY_UNAVAILABLE', `Firefly returned HTTP ${res.status}`);
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new FireflyError(
        'FIREFLY_UNAVAILABLE',
        `Firefly response was not JSON: ${(err as Error).message}`,
      );
    }
  }
}
