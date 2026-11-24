import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATE_LIMIT_RETRY,
  describeRateLimitForLog,
  formatRateLimitMessage,
  isRateLimitError,
  rateLimitInfo,
  withRateLimitRetry,
} from '../gmailRateLimit';
import { listBillMessages, type GmailClientLike } from '../../services/GmailService';

/** ISO string without a zone so `new Date(...)` is the local time we format for the toast. */
function localIso(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const now = new Date(2026, 10, 24, 10, 20, 0);
const retryAfter = new Date(2026, 10, 24, 10, 34, 0);
const rateLimitMessage = `User-rate limit exceeded.  Retry after ${localIso(retryAfter)}`;

/** Fake clock + sleep: the retry helper never touches real timers in these tests. */
function clock(start = now.getTime()) {
  let current = start;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('isRateLimitError', () => {
  it('recognises the Gmail "User-rate limit exceeded" text', () => {
    const err = new Error(rateLimitMessage);
    expect(isRateLimitError(err)).toBe(true);
    expect(rateLimitInfo(err)?.retryAfter?.getTime()).toBe(retryAfter.getTime());
  });

  it('recognises a bare HTTP 429 status even with an unhelpful message', () => {
    const err = Object.assign(new Error('Request failed with status code 429'), { status: 429 });
    expect(isRateLimitError(err)).toBe(true);
  });

  it('recognises the nested Google SDK / Gaxios error shape', () => {
    const err = Object.assign(new Error('Request failed with status code 429'), {
      response: {
        status: 429,
        statusText: 'Too Many Requests',
        data: { error: { code: 429, message: rateLimitMessage } },
      },
    });
    expect(isRateLimitError(err)).toBe(true);
    expect(rateLimitInfo(err)?.retryAfter?.getTime()).toBe(retryAfter.getTime());
  });

  it('recognises a wrapped error with a cause and stringified JSON details', () => {
    const inner = { error: { code: 429, message: rateLimitMessage } };
    const err = new Error(`Gmail request failed: ${JSON.stringify(inner)}`, { cause: inner });
    expect(isRateLimitError(err)).toBe(true);
    expect(rateLimitInfo(err)?.retryAfter?.getTime()).toBe(retryAfter.getTime());
  });

  it('recognises Google reason codes inside nested error arrays', () => {
    const err = { errors: [{ reason: 'userRateLimitExceeded', message: 'Quota exceeded' }] };
    expect(isRateLimitError(err)).toBe(true);
  });

  it('leaves every other error alone', () => {
    expect(isRateLimitError(new Error('Drive 403'))).toBe(false);
    expect(isRateLimitError(new Error('Request had insufficient authentication scopes.'))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error('oops'), { status: 500 }))).toBe(false);
    expect(isRateLimitError('nope')).toBe(false);
    expect(rateLimitInfo(new Error('Connection reset'))).toBeNull();
  });
});

describe('rate limit diagnostics', () => {
  it('parses a Z-suffixed ISO retry-after timestamp', () => {
    const info = rateLimitInfo(new Error(`User-rate limit exceeded. Retry after 2026-11-24T10:19:35.315Z`));
    expect(info?.retryAfter?.toISOString()).toBe('2026-11-24T10:19:35.315Z');
  });

  it('formats a friendly, local-time message with a rounded countdown', () => {
    const text = formatRateLimitMessage(rateLimitInfo(new Error(rateLimitMessage)), now);
    expect(text).toBe('Gmail is rate-limited. Retry after 10:34 (in 14 minutes).');
  });

  it('uses the singular for one minute', () => {
    const soon = new Date(now.getTime() + 60_000);
    const text = formatRateLimitMessage(rateLimitInfo(new Error(`User-rate limit exceeded. Retry after ${localIso(soon)}`)), now);
    expect(text).toBe('Gmail is rate-limited. Retry after 10:21 (in 1 minute).');
  });

  it('falls back when the timestamp is missing, invalid or in the past', () => {
    const fallback = 'Gmail is rate-limited. Please try again in a few minutes.';
    expect(formatRateLimitMessage(rateLimitInfo(new Error('User-rate limit exceeded.')), now)).toBe(fallback);
    expect(formatRateLimitMessage(rateLimitInfo(new Error('User-rate limit exceeded. Retry after tomorrow')), now)).toBe(fallback);
    expect(formatRateLimitMessage(rateLimitInfo(new Error(`User-rate limit exceeded. Retry after ${localIso(now)}`)), now)).toBe(fallback);
    expect(formatRateLimitMessage(null, now)).toBe(fallback);
  });

  it('keeps the raw technical detail in the log line, not in the toast', () => {
    const err = Object.assign(new Error('Request failed with status code 429'), {
      response: { status: 429, data: { error: { message: rateLimitMessage } } },
    });
    const toast = formatRateLimitMessage(rateLimitInfo(err), now);
    const log = describeRateLimitForLog(err, now);
    expect(toast).toContain('Retry after 10:34');
    expect(toast).not.toContain('Gaxios');
    expect(log).toContain('HTTP 429');
    expect(log).toContain('2026-11-24');
    expect(log).toContain(rateLimitMessage);
  });
});

describe('withRateLimitRetry', () => {
  it('retries only rate-limit failures with exponential delay and jitter', async () => {
    const fake = clock();
    let calls = 0;
    const err = Object.assign(new Error('429'), { status: 429 });
    const value = await withRateLimitRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw err;
        return 'ok';
      },
      { now: fake.now, sleep: fake.sleep, random: () => 0, baseDelayMs: 1000 },
    );

    expect(value).toBe('ok');
    expect(calls).toBe(3);
    // 1000ms exponential base * (0.5 + jitter 0), then 2000ms * 0.5.
    expect(fake.sleeps).toEqual([500, 1000]);
  });

  it('does not retry other errors', async () => {
    const fake = clock();
    const err = new Error('Drive 403');
    await expect(
      withRateLimitRetry(
        async () => {
          throw err;
        },
        { now: fake.now, sleep: fake.sleep },
      ),
    ).rejects.toBe(err);
    expect(fake.sleeps).toEqual([]);
  });

  it('stops after the bounded number of attempts', async () => {
    const fake = clock();
    const err = new Error(rateLimitMessage);
    let calls = 0;
    await expect(
      withRateLimitRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { now: fake.now, sleep: fake.sleep, random: () => 0.5 },
      ),
    ).rejects.toBe(err);
    expect(calls).toBe(DEFAULT_RATE_LIMIT_RETRY.maxAttempts);
    expect(fake.sleeps).toHaveLength(DEFAULT_RATE_LIMIT_RETRY.maxAttempts - 1);
  });

  it('honours a short server-supplied retry-after', async () => {
    const fake = clock();
    let calls = 0;
    await withRateLimitRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error(`User-rate limit exceeded. Retry after ${localIso(new Date(now.getTime() + 3000))}`);
        return 'ok';
      },
      { now: fake.now, sleep: fake.sleep, random: () => 0, baseDelayMs: 1000 },
    );
    expect(fake.sleeps).toEqual([3000]);
  });

  it('retries a mocked Gmail client that throws a Gaxios-shaped 429', async () => {
    const fake = clock();
    let calls = 0;
    const client: GmailClientLike = {
      users: {
        messages: {
          list: async () => {
            calls += 1;
            if (calls === 1) {
              throw Object.assign(new Error('Request failed with status code 429'), {
                response: { status: 429, data: { error: { message: `User-rate limit exceeded. Retry after ${localIso(new Date(now.getTime() + 2000))}` } } },
              });
            }
            return { data: { messages: [{ id: 'm1' }] } };
          },
          get: async () => ({ data: {} }),
          attachments: { get: async () => ({ data: {} }) },
        },
      },
    };

    const messages = await withRateLimitRetry(
      () => listBillMessages(client, { query: 'has:attachment', maxResults: 10 }),
      { now: fake.now, sleep: fake.sleep, random: () => 0, baseDelayMs: 1000 },
    );

    expect(messages).toEqual([{ id: 'm1' }]);
    expect(calls).toBe(2);
    expect(fake.sleeps).toEqual([2000]);
  });

  it('caps a 15-minute quota window and returns after the total-wait budget', async () => {
    const fake = clock();
    let calls = 0;
    const err = new Error(`User-rate limit exceeded. Retry after ${localIso(new Date(now.getTime() + 15 * 60_000))}`);
    await expect(
      withRateLimitRetry(
        async () => {
          calls += 1;
          throw err;
        },
        { now: fake.now, sleep: fake.sleep, maxTotalWaitMs: 2000, maxDelayMs: 1000, random: () => 1 },
      ),
    ).rejects.toBe(err);
    // 15 minutes is never waited out in-process; the budget (2s) ends the loop.
    expect(calls).toBe(3);
    expect(fake.sleeps).toEqual([1000, 1000]);
    expect(fake.now() - now.getTime()).toBeLessThanOrEqual(DEFAULT_RATE_LIMIT_RETRY.maxTotalWaitMs);
  });
});
