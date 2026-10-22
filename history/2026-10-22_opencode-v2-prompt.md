# 2026-10-22 — Receipt reading against OpenCode V2

## Problem

"Beleg auslesen" failed on every row with:

```
opencode POST /api/session/ses_…/prompt failed: 400
```

The shared server at `code.lehel.xyz` had been upgraded from OpenCode V1 to V2 (`dachrisch/servyy-container`, plan `2026-10-21-opencode-v2-upgrade.md`). V2 changed the prompt contract:

| Endpoint | V1 body | V2 body |
|---|---|---|
| `POST /api/session/{id}/prompt` | `{ prompt: { text } }` | `{ text }` |

Both schemas are strict (`additionalProperties: false`), so the V1 body gets `400 InvalidRequestError — Missing key at ["text"]`. queen was a fourth consumer that plan did not cover.

A second, latent break sat behind the first: V2 prepends `idle` control entries to `GET /api/session/{id}/message` (`[idle, assistant, user]`). The poller read `data[0]` and required `type === 'assistant'`, so it would have timed out even with the body fixed.

## Solution

`src/server/services/OpencodeClient.ts`:

- **Prompt body**: sends `{ text }` (V2). A `400` on that request is treated as "old server" and retried once with the legacy `{ prompt: { text } }`, so a V1 instance still works. Any other status is rethrown unchanged — a genuine 400 (e.g. bad model) fails the attempt after the legacy retry and is never masked. To tell the two apart, `request()` now throws an `HttpError` carrying `status`.
- **Poll**: takes the newest *finished assistant* message from the list instead of `data[0]`, ignoring `idle` (and any other non-assistant control entries).
- **Model pinning**: new `QUEEN_OPENCODE_FREE_MODELS` (default `true`). Set to `false`/`0`/`off`/`no` to skip the free-registry auto-fill, leaving only `QUEEN_OPENCODE_MODELS` and the paid `QUEEN_OPENCODE_PAID_MODEL`. Motivation: `opencode:flint-40b-free` took 100 s+ for a trivial answer, so a click could sit in free-model retries and starve the 180 s budget. `.env.example` documents the flag.

## Files changed

- `src/server/services/OpencodeClient.ts` — V2 prompt body + V1 fallback, `HttpError`, assistant-message scan, `freeModels` option / env flag.
- `src/server/services/__tests__/OpencodeClient.test.ts` — 4 new tests (V2 body, V1 fallback, non-400 400s not masked, `idle` at the head, free-model opt-out) and the body assertion flipped to `{ text }`.
- `.env.example` — `QUEEN_OPENCODE_FREE_MODELS`.

## Verification

- `npm run lint && npm run typecheck && npm run typecheck:server && npm test` — green (545+ tests).
- Live against `https://code.lehel.xyz` with the production key, from a checkout of this branch:
  - old body → `400 {"message":"Missing key at [\"text\"]"}`, new body → `200`;
  - a full `ask()` through the real client answered (the free model took ~103 s, which is what motivated the pinning flag);
  - `QUEEN_OPENCODE_FREE_MODELS=false` with `QUEEN_OPENCODE_PAID_MODEL=opencode-go:deepseek-v4.1-flash` yields a one-model chain.
- Dry run of the actual reading path (PDF text extraction + prompt + strict parse, no DB write) on the Augustiner receipt of the failed transaction: `deepseek-v4.1-flash` returned a valid reading in ~16 s (`totalCents: 2520`, 19 %, account 6640).

## Known issues

- The receipt for the "2x Spesen" transaction is a single 25.20 € receipt, so reading it against the 54.60 € transaction will still be reported as an amount mismatch. That is the intended guard, not a reading failure.
- The fallback path to V1 is covered by unit tests only; there is no V1 server left to exercise it.

## Follow-ups

- None known in sibling consumers: `dontforget` (`src/search/opencodeClient.ts`) and `dachrisch/ai-job-search` (`packages/api/src/ai/opencode.ts`) already send `{ text }` on their masters. queen was the last V1-body caller.
