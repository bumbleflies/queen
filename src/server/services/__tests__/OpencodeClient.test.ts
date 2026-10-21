import { describe, expect, it } from 'vitest';
import { OpencodeClient, opencodeFromEnv, type OpencodeModel } from '../OpencodeClient';

const BASE = 'http://oc.test';
const A: OpencodeModel = { providerID: 'opencode', id: 'a-free' };
const B: OpencodeModel = { providerID: 'opencode', id: 'b-free' };
const C: OpencodeModel = { providerID: 'opencode', id: 'c-free' };
const PAID: OpencodeModel = { providerID: 'opencode-go', id: 'paid-1' };

const key = (m: OpencodeModel) => `${m.providerID}:${m.id}`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const registry = [
  { ...A, status: 'active', enabled: true, cost: [{ input: 0, output: 0 }] },
  { ...B, status: 'deprecated', enabled: true, cost: [{ input: 0, output: 0 }] },
  { ...C, status: 'active', enabled: false, cost: [{ input: 0, output: 0 }] },
  { providerID: 'opencode', id: 'd-free', status: 'active', enabled: true, cost: [{ input: 0, output: 0 }] },
  { providerID: 'opencode', id: 'e-free', status: 'active', enabled: true, cost: [{ input: 0, output: 0 }] },
  { ...PAID, status: 'active', enabled: true, cost: [{ input: 1, output: 2 }] },
  { providerID: 'x', id: 'pricey', status: 'active', enabled: true, cost: [{ input: 1, output: 1 }] },
];

interface Behaviour {
  registry?: () => Response;
  /** Per model key: handler for each prompt call. */
  prompt?: Record<string, (n: number) => Response>;
  /** Per model key: the assistant reply (newest first message list). */
  messages?: Record<string, () => unknown[]>;
}

function setup(b: Behaviour) {
  const sleeps: number[] = [];
  let clock = 0;
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const sessionModel = new Map<string, string>();
  const promptCount = new Map<string, number>();
  let sid = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ url, method, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const path = url.slice(BASE.length);
    if (path === '/api/model') return b.registry ? b.registry() : json(registry);
    if (path === '/api/session' && method === 'POST') {
      const m = (body as { model: OpencodeModel }).model;
      const id = `s${++sid}`;
      sessionModel.set(id, key(m));
      return json({ data: { id } });
    }
    const prompt = /^\/api\/session\/(s\d+)\/prompt$/.exec(path);
    if (prompt) {
      const k = sessionModel.get(prompt[1])!;
      const n = (promptCount.get(k) ?? 0) + 1;
      promptCount.set(k, n);
      return b.prompt?.[k] ? b.prompt[k](n) : json({ data: {} });
    }
    const msg = /^\/api\/session\/(s\d+)\/message$/.exec(path);
    if (msg) {
      const k = sessionModel.get(msg[1])!;
      const list = b.messages?.[k]?.() ?? [
        { type: 'assistant', finish: 'stop', content: [{ type: 'text', text: `reply from ${k}` }] },
      ];
      return json({ data: list });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock += ms;
  };
  const make = (preferred: OpencodeModel[], paid: OpencodeModel | null = PAID) =>
    new OpencodeClient({ baseUrl: BASE, apiKey: 'k', fetch: fetchImpl, sleep, now: () => clock, preferred, paid });
  return { make, sleeps, calls };
}

describe('OpencodeClient', () => {
  it('modelChain orders preferred, then other free active models, then one paid', async () => {
    const { make, calls } = setup({});
    const chain = await make([{ providerID: 'opencode', id: 'e-free' }, B, PAID]).modelChain();
    expect(chain.map(key)).toEqual([
      'opencode:e-free', // preferred and usable; deprecated B dropped
      'opencode:a-free',
      'opencode:d-free',
      'opencode-go:paid-1', // paid exactly once
    ]);
    expect(calls[0].headers['X-Api-Key']).toBe('k');
  });

  it('retries a model 3 times with 1 s and 2 s backoff, then moves on', async () => {
    const { make, sleeps } = setup({
      prompt: { [key(A)]: () => new Response('down', { status: 503 }) },
    });
    const res = await make([A]).ask('hi');
    expect(sleeps).toEqual([1000, 2000]);
    expect(res.model).toEqual({ providerID: 'opencode', id: 'd-free' });
    expect(res.text).toBe('reply from opencode:d-free');
  });

  it('falls back to the paid model when every free model fails', async () => {
    const bad = () => new Response('x', { status: 500 });
    const { make } = setup({
      prompt: { [key(A)]: bad, 'opencode:d-free': bad, 'opencode:e-free': bad },
    });
    const res = await make([A]).ask('hi');
    expect(res.model).toEqual(PAID);
    expect(res.text).toBe('reply from opencode-go:paid-1');
  });

  it('throws the last error when all models fail', async () => {
    const bad = () => new Response('x', { status: 500 });
    const { make } = setup({
      prompt: { [key(A)]: bad, 'opencode:d-free': bad, 'opencode:e-free': bad, [key(PAID)]: () => new Response('x', { status: 502 }) },
    });
    await expect(make([A]).ask('hi')).rejects.toThrow(/502/);
  });

  it('finish: error fails the attempt', async () => {
    const { make } = setup({
      messages: {
        [key(A)]: () => [{ type: 'assistant', finish: 'error', error: { message: 'boom' }, content: [] }],
      },
    });
    const res = await make([A], null).ask('hi');
    expect(res.model.id).not.toBe('a-free');
  });

  it('finish: error on every model surfaces its message', async () => {
    const err = () => [{ type: 'assistant', finish: 'error', error: { message: 'boom' } }];
    // registry failure keeps just preferred + paid
    const { make: make2 } = setup({
      registry: () => new Response('x', { status: 500 }),
      messages: { [key(A)]: err, [key(PAID)]: err },
    });
    await expect(make2([A]).ask('hi')).rejects.toThrow(/boom/);
  });

  it('poll timeout after 120 s fails the attempt', async () => {
    const pending = () => [{ type: 'assistant', content: [] }];
    const { make, sleeps } = setup({
      registry: () => new Response('x', { status: 500 }),
      messages: { [key(A)]: pending },
    });
    const res = await make([A]).ask('hi');
    expect(res.model).toEqual(PAID);
    // 120 polls of 1 s per attempt, plus 1 s / 2 s backoff between the 3 attempts
    expect(sleeps.filter((ms) => ms === 1000).length).toBeGreaterThanOrEqual(120);
    expect(sleeps).toContain(2000);
  });

  it('registry failure still tries preferred and paid', async () => {
    const { make } = setup({ registry: () => new Response('x', { status: 500 }) });
    expect((await make([A, B]).modelChain()).map(key)).toEqual([key(A), key(B), key(PAID)]);
  });

  it('accepts a registry wrapped in {data} or {models}', async () => {
    for (const wrap of [(r: unknown[]) => ({ data: r }), (r: unknown[]) => ({ models: r })]) {
      const { make } = setup({ registry: () => json(wrap(registry)) });
      expect((await make([]).modelChain()).map(key)).toEqual([
        'opencode:a-free',
        'opencode:d-free',
        'opencode:e-free',
        key(PAID),
      ]);
    }
  });

  it('sends model, prompt text and key', async () => {
    const { make, calls } = setup({});
    await make([A], null).ask('hello');
    const create = calls.find((c) => c.url.endsWith('/api/session'))!;
    expect(create.body).toEqual({ model: A });
    const prompt = calls.find((c) => c.url.endsWith('/prompt'))!;
    expect(prompt.body).toEqual({ prompt: { text: 'hello' } });
    expect(prompt.headers['X-Api-Key']).toBe('k');
  });
});

describe('opencodeFromEnv', () => {
  it('returns null without OPENCODE_API_KEY', () => {
    const saved = process.env.OPENCODE_API_KEY;
    delete process.env.OPENCODE_API_KEY;
    try {
      expect(opencodeFromEnv()).toBeNull();
      process.env.OPENCODE_API_KEY = 'abc';
      expect(opencodeFromEnv()).toBeInstanceOf(OpencodeClient);
    } finally {
      if (saved === undefined) delete process.env.OPENCODE_API_KEY;
      else process.env.OPENCODE_API_KEY = saved;
    }
  });
});
