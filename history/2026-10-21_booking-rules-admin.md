# 2026-10-21 — Booking rules overview and JSON import

## Problem

Inbox suggestions ("Vorschlag") come only from supplier rules, but queen had no UI to see or manage them. The only ways to create rules were "Als Regel merken" while booking a single row, or raw tRPC calls. So every row showed "kein Vorschlag", nobody could tell why, and the rules couldn't be seeded in bulk.

## Solution

- **Rules overview:** a "Regeln" chip on the Finanzen page next to "Journal (SKR04)" opens it. It lists every supplier rule with:
  - its matching (IBAN / Zweck / Name)
  - the default account, VAT rate and "nur USt" mode
  - **Treffer:** how many open bank rows the rule currently wins, using the same `suggest()` priority as the inbox
  - Archived rules sit behind a toggle and can be restored.
- **Rule dialog:** create and edit a rule, with patterns entered one per line.
- **Inbox shortcut:** rows with "kein Vorschlag" get a "Regel anlegen" button that prefills the dialog. It takes the counterparty name as a name pattern plus the IBAN. Firefly placeholder names such as "(unknown destination)" are skipped, and in that case the first two words of the Verwendungszweck become a Zweck pattern.
- **JSON import and export:**
  - `suppliers.exportJson` returns all rules in the import format, and the UI downloads it as `queen-regeln-YYYY-MM-DD.json`.
  - `suppliers.importJson({ json, dryRun = true })` matches by Kreditornummer, then by name (case-insensitive). Fields missing from the JSON stay unchanged, and every row reports `create`, `update` or `unchanged`.
  - Any validation error writes nothing: invalid JSON, schema errors, duplicates, unknown or archived accounts, or a Kreditornummer that contradicts a name match.
  - A given free Kreditornummer is used as is, and the counter is raised past it.
  - The import dialog checks first (dry run) and only then enables "Importieren".
- **Admin only:** `suppliers.create`, `update`, `setArchived`, `importJson` and `exportJson` are now `adminProcedure`. Non-admins see the overview read-only.
- **Refactor:** `bankCoverage.ts` now holds `yearRange`, `coverageMap`, `loadYear` and `openTransactions`, so the bookings router and the overview share one definition of an "open" row.

## Main files

- `src/server/routers/suppliers.ts`, `src/server/lib/accounting/{supplierImport,bankCoverage}.ts`, `src/server/routers/bookings.ts`
- `src/client/components/RulesSection.tsx`, `src/client/pages/FinancePage.tsx`, `src/client/i18n/{de,en}.ts`
- Tests: `suppliers.test.ts`, `rulesSection.test.tsx`, `financePage.test.tsx`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

Seeding through the API takes an admin JWT (the `queen_token` cookie value):

```bash
python3 -c "import json;print(json.dumps({'json':open('rules.json').read(),'dryRun':True}))" \
  | curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data @- \
    https://queen.bumbleflies.de/trpc/suppliers.importJson
```

Checked locally with `npm run dev` and made-up data, in DE and EN, light and dark, and at 390 px width:
- The overview, hit counts, inbox suggestions and the prefilled "Regel anlegen" dialog all render correctly.
- The import dialog lists errors and keeps "Importieren" disabled until a check passes.
- An import via curl worked: the dry run, then the apply, then the hit counts.

## Success criteria

- Every rule shows how many open rows it covers, so a pattern can be checked against real data without a test environment.
- Rules can be seeded and backed up as JSON, and the import is idempotent: a re-import reports only `unchanged`.

## Known issues

- Server-side import errors are German only, as with the other import endpoints.
- The inbox shortcut prefills the counterparty IBAN, which is the strongest match. For payees with several kinds of payments (Finanzamt: KöSt and USt), remove the IBAN and use Zweck patterns instead.

## Deployment results

Pending.
