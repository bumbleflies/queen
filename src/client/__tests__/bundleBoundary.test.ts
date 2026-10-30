import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';

/**
 * The browser bundle may only contain code the browser can run. A client module
 * that reaches `src/server/models/…` (directly or through a lib) drags Mongoose
 * into the bundle, where `node:events` is externalised and the app dies with
 * "Class extends value undefined" before the first render.
 *
 * This walks the import graph from every client module (tests excluded) and
 * fails on server-only directories, node builtins and node-only packages.
 */

const ROOT = resolve(__dirname, '../../..');
const CLIENT = join(ROOT, 'src/client');

/** Directories the client must never reach: models, DB access, services, HTTP. */
const SERVER_ONLY = [
  'src/server/models/',
  'src/server/services/',
  'src/server/jobs/',
  'src/server/routers/',
  'src/server/routes/',
  'src/server/cron/',
  'src/server/db',
  'src/server/index.ts',
  'src/server/trpcInit',
];

const NODE_ONLY_PACKAGES = [
  'mongoose',
  'mongodb',
  'bson',
  'googleapis',
  'google-auth-library',
  'gaxios',
  'node-fetch',
  'fetch-blob',
  'express',
  'bull',
  'ioredis',
  'redis',
  'nodemailer',
  'pdfkit',
  'jsonwebtoken',
  'passport',
  'unpdf',
  'html-to-text',
  'cookie-parser',
  'cors',
];

const NODE_BUILTINS = [
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib',
];

/** `import …'` / `export …'` / side-effect `import 'x'` / `import('x')`; `import type` is erased at build time. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const found: string[] = [];
  for (const m of code.matchAll(IMPORT_RE)) {
    const [, typeOnly, stat, dynamic] = m;
    const spec = stat ?? dynamic;
    if (!spec || typeOnly) continue;
    found.push(spec);
  }
  return found;
}

function resolveModule(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function clientFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : clientFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/** Why a module must not be in the browser bundle, or null when it is fine. */
function violation(file: string): string | null {
  const rel = relative(ROOT, file).replaceAll('\\', '/');
  if (SERVER_ONLY.some((p) => rel.startsWith(p))) return `${rel} is server-only`;
  for (const spec of specifiers(file)) {
    if (spec.startsWith('.')) continue;
    const bare = spec.replace(/^node:/, '');
    const pkg = spec.startsWith('node:') ? bare : spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
    if (NODE_ONLY_PACKAGES.includes(pkg)) return `${rel} imports ${spec}`;
    if (NODE_BUILTINS.includes(bare)) return `${rel} imports node builtin ${spec}`;
  }
  return null;
}

describe('client bundle boundary', () => {
  it('keeps models, node-only packages and node builtins out of the browser bundle', () => {
    const problems = new Set<string>();
    const seen = new Set<string>();

    // Breadth-first so the reported chain starts at the client module that caused it.
    const queue = clientFiles(CLIENT).map((file) => ({ file, chain: [relative(ROOT, file)] }));
    while (queue.length > 0) {
      const { file, chain } = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);

      const why = violation(file);
      if (why) {
        problems.add(`${why}\n    via ${chain.join(' → ')}`);
        continue;
      }

      for (const spec of specifiers(file)) {
        const next = resolveModule(file, spec);
        if (next) queue.push({ file: next, chain: [...chain, spec] });
      }
    }

    expect(seen.size).toBeGreaterThan(10); // the walk actually ran
    expect([...problems]).toEqual([]);
  });
});
