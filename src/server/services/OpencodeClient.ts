/**
 * Thin client for the shared opencode instance.
 *   POST /api/session            -> { data: { id } }   (body: { model })
 *   POST /api/session/:id/prompt -> ack               (body: { text }; V2 servers.
 *                                    V1 servers only accept { prompt: { text } },
 *                                    so a 400 falls back to the legacy shape once)
 *   GET  /api/session/:id/message -> { data: [newest first] }, polled until a
 *                                    finished assistant message is in the list
 *                                    (V2 prepends `idle` control entries)
 *   GET  /api/model              -> registry (array, { data } or { models })
 * Auth header: X-Api-Key. Every request times out after 30 s; one `ask`
 * (one receipt reading) gets 180 s across the whole model chain.
 */
export interface OpencodeModel {
  providerID: string;
  id: string;
}

export interface OpencodeClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Preferred models, tried first when the registry marks them usable. */
  preferred?: OpencodeModel[];
  /** The one paid last resort; `null` disables it. */
  paid?: OpencodeModel | null;
  /** Auto-fill the chain with every active free registry model (default true). */
  freeModels?: boolean;
  /** Abort signal per request (tests); default `AbortSignal.timeout`. */
  timeoutSignal?: (ms: number) => AbortSignal;
  /** Overall time for one `ask` across all models and attempts. */
  budgetMs?: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const ASK_BUDGET_MS = 180_000;
const DEFAULT_BASE_URL = 'https://code.lehel.xyz';
const DEFAULT_PAID: OpencodeModel = { providerID: 'opencode-go', id: 'deepseek-v4.1-flash' };

interface RegistryModel extends OpencodeModel {
  status?: string;
  enabled?: boolean;
  cost?: { input?: unknown; output?: unknown }[];
}

const modelKey = (m: OpencodeModel) => `${m.providerID}:${m.id}`;

/** The reading's overall time is used up: no further attempts or models. */
class BudgetExceeded extends Error {}

/** A non-2xx answer; `status` lets the caller tell a contract mismatch apart. */
class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function parseModelKey(value: string): OpencodeModel | null {
  const [providerID, ...rest] = value.trim().split(':');
  const id = rest.join(':');
  return providerID && id ? { providerID, id } : null;
}

function parseRegistry(json: unknown): RegistryModel[] | null {
  let list: unknown;
  if (Array.isArray(json)) list = json;
  else if (isRecord(json) && Array.isArray(json.data)) list = json.data;
  else if (isRecord(json) && Array.isArray(json.models)) list = json.models;
  if (!Array.isArray(list)) return null;
  const models: RegistryModel[] = [];
  for (const m of list) {
    if (!isRecord(m) || typeof m.id !== 'string' || typeof m.providerID !== 'string') continue;
    models.push({
      id: m.id,
      providerID: m.providerID,
      status: typeof m.status === 'string' ? m.status : undefined,
      enabled: typeof m.enabled === 'boolean' ? m.enabled : undefined,
      cost: Array.isArray(m.cost) ? m.cost.filter(isRecord) : undefined,
    });
  }
  return models.length > 0 ? models : null;
}

const isUsable = (m: RegistryModel) =>
  (m.status === undefined || m.status === 'active') && m.enabled !== false;
const isFree = (m: RegistryModel) =>
  Array.isArray(m.cost) && m.cost.length > 0 && m.cost.every((c) => !c.input && !c.output);

export class OpencodeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly preferred: OpencodeModel[];
  private readonly paid: OpencodeModel | null;
  private readonly freeModels: boolean;
  private readonly timeoutSignal: (ms: number) => AbortSignal;
  private readonly budgetMs: number;

  constructor(opts: OpencodeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = opts.now ?? Date.now;
    this.preferred = opts.preferred ?? [];
    this.paid = opts.paid === undefined ? DEFAULT_PAID : opts.paid;
    this.freeModels = opts.freeModels ?? true;
    this.timeoutSignal = opts.timeoutSignal ?? ((ms) => AbortSignal.timeout(ms));
    this.budgetMs = opts.budgetMs ?? ASK_BUDGET_MS;
  }

  /**
   * Preferred usable models, then (unless disabled) other active free registry
   * models, then one paid model.
   */
  async modelChain(): Promise<OpencodeModel[]> {
    const registry = await this.fetchRegistry();
    const usable = registry ? new Set(registry.filter(isUsable).map(modelKey)) : null;
    const servable = (m: OpencodeModel) => !usable || usable.has(modelKey(m));

    const chain: OpencodeModel[] = [];
    const add = (m: OpencodeModel) => {
      if (!chain.some((c) => modelKey(c) === modelKey(m))) chain.push({ providerID: m.providerID, id: m.id });
    };
    const paidKey = this.paid ? modelKey(this.paid) : null;
    for (const m of this.preferred) if (servable(m) && modelKey(m) !== paidKey) add(m);
    if (this.freeModels) {
      for (const m of registry ?? []) {
        if (isUsable(m) && isFree(m) && modelKey(m) !== paidKey) add(m);
      }
    }
    if (this.paid && servable(this.paid)) add(this.paid);
    return chain;
  }

  /**
   * Runs the prompt through the model chain (3 attempts each, exponential
   * backoff) within the overall budget; once it is used up, fails without
   * trying further attempts or models.
   */
  async ask(prompt: string): Promise<{ text: string; model: OpencodeModel }> {
    const deadline = this.now() + this.budgetMs;
    const budgetError = () => new BudgetExceeded(`opencode: reading took longer than ${this.budgetMs / 1000} s`);
    const models = await this.modelChain();
    let lastError: unknown = new Error('opencode: no models available');
    for (const model of models) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (this.now() >= deadline) throw budgetError();
        try {
          const text = await this.attempt(model, prompt, deadline);
          return { text, model };
        } catch (err) {
          if (err instanceof BudgetExceeded) throw budgetError();
          lastError = err;
          if (attempt < MAX_ATTEMPTS) await this.sleep(RETRY_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async fetchRegistry(): Promise<RegistryModel[] | null> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/model`, {
        headers: this.headers(),
        signal: this.timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      return parseRegistry(await res.json());
    } catch {
      return null;
    }
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', 'X-Api-Key': this.apiKey };
  }

  private async attempt(model: OpencodeModel, prompt: string, deadline: number): Promise<string> {
    const created = await this.request('/api/session', 'POST', { model });
    const id = isRecord(created) && isRecord(created.data) ? created.data.id : undefined;
    if (typeof id !== 'string') throw new Error('opencode session create returned no id');
    await this.prompt(id, prompt);
    return this.poll(id, deadline);
  }

  /**
   * V2 takes `{ text }`; V1 only takes `{ prompt: { text } }` and both schemas
   * are strict, so a 400 on the V2 body means "old server" — retry once with
   * the legacy shape. Other 400s fail the second call as well, so nothing is
   * masked.
   */
  private async prompt(sessionId: string, prompt: string): Promise<void> {
    try {
      await this.request(`/api/session/${sessionId}/prompt`, 'POST', { text: prompt });
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 400) throw err;
      await this.request(`/api/session/${sessionId}/prompt`, 'POST', { prompt: { text: prompt } });
    }
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: this.timeoutSignal(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new HttpError(`opencode ${method} ${path} failed: ${res.status}`, res.status);
    return res.json();
  }

  private async poll(sessionId: string, budgetDeadline: number): Promise<string> {
    const deadline = this.now() + POLL_TIMEOUT_MS;
    while (this.now() < deadline) {
      if (this.now() >= budgetDeadline) throw new BudgetExceeded();
      const json = await this.request(`/api/session/${sessionId}/message`, 'GET');
      const list = isRecord(json) && Array.isArray(json.data) ? json.data : [];
      // Newest first, but V2 interleaves `idle` control entries at the head, so
      // take the newest *finished assistant* message rather than list[0].
      const latest = list.find((m) => isRecord(m) && m.type === 'assistant' && m.finish);
      if (isRecord(latest) && latest.finish) {
        if (latest.finish === 'error') {
          const msg = isRecord(latest.error) && typeof latest.error.message === 'string' ? latest.error.message : 'unknown error';
          throw new Error(`opencode generation failed: ${msg}`);
        }
        const parts = Array.isArray(latest.content) ? latest.content : [];
        for (const p of parts) {
          if (isRecord(p) && p.type === 'text' && typeof p.text === 'string' && p.text) return p.text;
        }
        throw new Error('opencode reply had no text content');
      }
      await this.sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`opencode reply timed out after ${POLL_TIMEOUT_MS / 1000}s`);
  }
}

function parseModelList(value: string | undefined): OpencodeModel[] {
  return (value ?? '')
    .split(',')
    .map(parseModelKey)
    .filter((m): m is OpencodeModel => m !== null);
}

/** `false`/`0`/`off`/`no` disable the free-model auto-fill; anything else keeps it on. */
function freeModelsFromEnv(value: string | undefined): boolean {
  return !/^(0|false|off|no)$/i.test((value ?? '').trim());
}

/** Builds the client from the environment; `null` when `OPENCODE_API_KEY` is unset. */
export function opencodeFromEnv(): OpencodeClient | null {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) return null;
  return new OpencodeClient({
    baseUrl: process.env.OPENCODE_BASE_URL || DEFAULT_BASE_URL,
    apiKey,
    preferred: parseModelList(process.env.QUEEN_OPENCODE_MODELS),
    paid: (process.env.QUEEN_OPENCODE_PAID_MODEL && parseModelKey(process.env.QUEEN_OPENCODE_PAID_MODEL)) || DEFAULT_PAID,
    freeModels: freeModelsFromEnv(process.env.QUEEN_OPENCODE_FREE_MODELS),
  });
}
