/**
 * Defensive handling for Gmail/Google API HTTP 429 responses.
 *
 * Gmail puts the retry timestamp in the error text (`User-rate limit exceeded.
 * Retry after <ISO>`), and the Google SDK wraps that text in Gaxios errors,
 * nested `response.data.error` objects and stringified JSON. The helpers here
 * recognise all of those shapes, turn them into one sentence an admin can act
 * on, and provide a bounded retry for the interactive "Jetzt abrufen" path.
 *
 * Pure module: no models, no network, no timers unless injected. The hourly
 * cron must NOT use `withRateLimitRetry` — it should fail fast and let the next
 * hourly run be the retry.
 */

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
const RETRY_AFTER = new RegExp(`Retry[-\\s]?after[^0-9]{0,24}?(${ISO_TIMESTAMP.source})`, 'i');
const RATE_LIMIT_TEXT = /(?:user[-\s]?rate[-\s]?limit|rate[-\s]?limit(?:exceeded)?|too many requests)/i;

export interface RateLimitInfo {
  /** All technical detail, for logs only — never shown in a toast. */
  raw: string;
  retryAfter: Date | null;
}

interface ScanResult {
  texts: string[];
  statuses: unknown[];
}

/** Walk the wrapped SDK error shape without following cycles or huge object graphs. */
function scan(value: unknown, depth: number, seen: Set<object>, into: ScanResult): void {
  if (value === null || value === undefined || depth > 6) return;
  if (typeof value === 'string') {
    if (value.trim()) into.texts.push(value);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (value instanceof Error) into.texts.push(value.message);
  const record = value as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code'] as const) {
    if (key in record) into.statuses.push(record[key]);
  }
  for (const [key, child] of Object.entries(record)) {
    // A stack or an HTTP request config never carries the Gmail error text.
    if (key === 'stack' || key === 'config') continue;
    scan(child, depth + 1, seen, into);
  }
  if ('cause' in record) scan(record.cause, depth + 1, seen, into);
}

function scanOf(err: unknown): ScanResult {
  const result: ScanResult = { texts: [], statuses: [] };
  scan(err, 0, new Set<object>(), result);
  return result;
}

function parseRetryAfter(texts: string[]): Date | null {
  for (const text of texts) {
    const match = text.match(RETRY_AFTER) ?? text.match(ISO_TIMESTAMP);
    if (!match) continue;
    const date = new Date(match[1] ?? match[0]);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

/** null for every error that is not a Gmail/Google rate limit. */
export function rateLimitInfo(err: unknown): RateLimitInfo | null {
  const { texts, statuses } = scanOf(err);
  const hasStatus = statuses.some(
    (status) => (typeof status === 'number' && status === 429) || (typeof status === 'string' && status.trim() === '429'),
  );
  if (!hasStatus && !texts.some((text) => RATE_LIMIT_TEXT.test(text))) return null;
  return {
    raw: [...new Set(texts)].join(' | ').slice(0, 2000),
    retryAfter: parseRetryAfter(texts),
  };
}

export function isRateLimitError(err: unknown): boolean {
  return rateLimitInfo(err) !== null;
}

/** Toast copy: local wall-clock time and a rounded countdown, no raw error text. */
export function formatRateLimitMessage(info: RateLimitInfo | null, now: Date = new Date()): string {
  const fallback = 'Gmail is rate-limited. Please try again in a few minutes.';
  if (!info?.retryAfter) return fallback;
  const remainingMs = info.retryAfter.getTime() - now.getTime();
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return fallback;

  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  const hours = String(info.retryAfter.getHours()).padStart(2, '0');
  const mins = String(info.retryAfter.getMinutes()).padStart(2, '0');
  return `Gmail is rate-limited. Retry after ${hours}:${mins} (in ${minutes} minute${minutes === 1 ? '' : 's'}).`;
}

/** Server-side only: friendly copy plus the raw detail an operator needs. */
export function describeRateLimitForLog(err: unknown, now: Date = new Date()): string {
  const info = rateLimitInfo(err);
  return (
    `Gmail rate limit (HTTP 429). ${formatRateLimitMessage(info, now)} ` +
    `retryAfter=${info?.retryAfter?.toISOString() ?? 'unknown'} raw=${info?.raw ?? String(err)}`
  );
}

export interface RateLimitRetryOptions {
  /** Total attempts including the first one. */
  maxAttempts?: number;
  baseDelayMs?: number;
  /** Ceiling for one individual wait. */
  maxDelayMs?: number;
  /** Ceiling for the whole in-process wait, so a click never hangs for a 15-minute quota. */
  maxTotalWaitMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** 1 + 2 retries; at most 20 s of in-process waiting on a manual fetch. */
export const DEFAULT_RATE_LIMIT_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10_000,
  maxTotalWaitMs: 20_000,
} as const;

/**
 * Retry a whole intake pass only when it failed with a rate limit. Everything
 * else propagates untouched. The operation must be safe to repeat: bill intake
 * is idempotent per (message, attachment) and per content hash, and a reply is
 * only sent for attachments that were newly recorded in that pass.
 */
export async function withRateLimitRetry<T>(
  operation: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, maxTotalWaitMs } = { ...DEFAULT_RATE_LIMIT_RETRY, ...options };
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const startedAt = now();

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (err) {
      const info = rateLimitInfo(err);
      const remaining = maxTotalWaitMs - (now() - startedAt);
      if (!info || attempt >= maxAttempts || remaining <= 0) throw err;

      // Exponential backoff with 0.5x–1x jitter; never longer than one cap.
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      let delay = Math.min(Math.round(exponential * (0.5 + random() * 0.5)), maxDelayMs);
      // A short server-supplied retry-after wins; a long quota window never does.
      const retryAfterMs = info.retryAfter ? info.retryAfter.getTime() - now() : null;
      if (retryAfterMs !== null && retryAfterMs > 0 && retryAfterMs <= remaining) {
        delay = Math.max(delay, Math.min(retryAfterMs, maxDelayMs));
      }
      delay = Math.min(delay, remaining, maxDelayMs);
      if (delay <= 0) throw err;
      await sleep(delay);
    }
  }
}
