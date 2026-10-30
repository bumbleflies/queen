# 2026-10-30 — The browser bundle contained Mongoose, and the app would not boot

## Problem

`https://queen.bumbleflies.de` opened to a blank page. The console showed only:

```
Uncaught TypeError: Class extends value undefined is not a constructor or null
    at index-B…js:25:123693
```

Nothing in the UI rendered — not even the login screen.

The failing statement in the built bundle was

```js
class extends t.EventEmitter { … }   // MongoDB driver, `t = Q()` → undefined
```

`Q()` is the bundler's shim for the **`events`** module, which Vite externalises
for the browser. The whole MongoDB driver, Mongoose and `node-fetch` (`fetch-blob`,
`data-uri-to-buffer`, `multipart-parser`, `debug`) were inside the client bundle:
2.47 MB in one chunk from 634 modules.

The import chain was two accidental layering violations:

```
src/client/components/RulesSection.tsx   (the Finance → Regeln tab)
  → src/server/lib/accounting/ruleLearning.ts
      → src/server/lib/accounting/receiptReading.ts   (for normalizeVendor)
          → src/server/lib/accounting/history.ts      (for suggestForTx)
              → src/server/models/BankTransaction.ts, JournalEntry.ts → mongoose
```

Both hops were avoidable: `ruleLearning` needed only two string helpers, and
`receiptReading` is pure receipt logic that had no business importing the
database-backed history.

## Solution

**Pure helpers extracted** — `src/server/lib/accounting/normalize.ts` (new) holds
`normalizeIban` and `normalizeVendor`. `suggest.ts`, `receiptReading.ts`,
`supplierImport.ts` and `routers/suppliers.ts` import from it instead of each
other, so no text helper pulls a database module any more.

**`suggestForTx` moved** — it is the only part of `receiptReading` that needs
history (rule → history → receipt order), so it now lives in
`src/server/lib/accounting/txSuggestion.ts`. `receiptReading.ts` imports only
`postingRules`, `normalize` and types and is therefore safe for the browser
(it already is used by `BookingDialog`). Importers updated: `autoBook.ts`,
`routers/bookings.ts`, `__tests__/suggestionConflict.test.ts`.

**Regression guard** — `src/client/__tests__/bundleBoundary.test.ts` walks the
static import graph of every client module and fails when it reaches
`src/server/models|services|jobs|routers|routes|cron`, a node builtin, or a
node-only package (mongoose, googleapis, node-fetch, express, …). It reports the
offending chain, e.g.
`bookingPreview.ts → txSuggestion → ./history → ../../models/BankTransaction`.

**Build guard** — `vite.config.ts` gains `noNodeBuiltinsInClient`: a `pre`
resolve hook collects every node builtin (and every `node:` specifier) imported
from our own sources and fails the build at the end with the importer path, so a
leak cannot reach a release even if the test were skipped. Importers under
`node_modules` are ignored: third-party packages are covered by the test.

Result: 141 modules, one 527 kB chunk (149 kB gzip), no externalised-module
warnings in the build.

## Main files

- `src/server/lib/accounting/normalize.ts` (new), `txSuggestion.ts` (new)
- `src/server/lib/accounting/{suggest,receiptReading,history,ruleLearning,supplierImport,autoBook}.ts`
- `src/server/routers/{bookings,suppliers}.ts`
- `vite.config.ts` (`noNodeBuiltinsInClient`)
- `src/client/__tests__/bundleBoundary.test.ts` (new)
- Tests touched: `__tests__/suggest.test.ts`, `__tests__/suggestionConflict.test.ts`

No behaviour change: same functions, same signatures, only moved or re-pointed.

## Verification

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
npm run build
```

- Build: `634 → 141` modules, `2472 kB → 527 kB`, no "externalized for browser"
  warnings.
- Guard test: adding a server-only import to a client module fails both the test
  (`… is server-only`, with the chain) and the build
  (`These node builtins cannot be bundled for the browser: node:fs ←
  src/client/lib/bookingPreview.ts`); both were checked and reverted.
- The production build loaded in headless Chromium via `vite preview`: before the
  fix the console showed the `TypeError` and a blank page; after it the app renders
  (Finance → `Regeln` tab, rule preview included) at 1600 px and 390 px width, with
  no console errors.
- `npm test`: 72/73 files green. `src/server/routers/__tests__/ledger.test.ts`
  fails (19 tests) because `mongodb-memory-server` has no MongoDB build for Alpine —
  identical failure on unmodified `master` in a clean worktree, unrelated to this
  change.

## Success criteria

- The deployed app boots and renders instead of throwing during module init.
- No model, service, node builtin or node-only package is reachable from
  `src/client` — enforced by a test inside the normal suite.

## Known issues

- Neither guard sees a node builtin reached only through a third-party package;
  the build guard ignores `node_modules` importers on purpose (some browser libs
  reference builtins in dead branches).

## Future enhancements

- Teach the boundary test `@/`-style aliases if the client ever gets them.
