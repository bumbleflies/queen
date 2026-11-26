# 2026-11-26 — Founder registry JSON import

## Problem

The founder data collected while planning the expense flow was never loaded into
queen. The registry had no seed and no bulk import, so intake mapped no incoming
mail to a person: claims arrived as `Unbekannt`, the assign dropdown was empty,
and booking refused them. The only write path was the per-founder Settings form.

## Solution

- `founders.importJson` (admin): dry run by default, validates the whole file
  before writing, and upserts founders by login address, intake addresses, name
  or IBAN. Missing fields leave an existing founder unchanged. A row that would
  create a new founder needs name, short name, intake addresses, login address
  and IBAN; a liability account must exist and be active.
- An import dialog in Settings → Founders mirrors the supplier-rules import:
  textarea or file picker, **Check** (dry run) then **Import**, with German/English
  row-level results and error messages.
- `expenses.claims.reimport` (admin) plus a **Neu importieren** button on a claim:
  re-reads and re-files the original mail attachment in place, with the founder
  now known and no second confirmation mail. Booked/payout/settled claims are
  refused; an old hand correction is cleared because it belonged to the old read.
  Nothing is deleted and no duplicate claim is created (unique `(messageId,
  attachmentId)` index stays intact).
- The JSON template lives outside the public repo (`/tmp/opencode/founders-import.json`);
  it was compiled from the public imprint for names and the user's Gmail/Drive for
  intake addresses, login addresses and payout data. No personal data is in git.

## Files changed

- `src/server/lib/expenses/founderImport.ts` (new) and its colocated test
- `src/server/routers/founders.ts` (`importJson`) and router tests
- `src/client/components/FoundersSection.tsx` (import dialog) and component test
- `src/server/jobs/expenseIntake.ts` (`reimportClaim`) and job tests
- `src/server/routers/expenses.ts` (`reimport`) and router tests
- `src/client/components/ClaimsSection.tsx` (re-import button) and component test
- `src/client/i18n/{de,en}.ts`

## Deployment results

Production registry was empty before this change. Because the new endpoint is not
deployed yet, the three founders were created in production through the already
live `founders.create` admin procedure in the signed-in browser, then the
Porkbun claim was assigned to its sender with the address remembered. Verified in
the Finance → Expenses table: the founder column now shows the person and the
`Gesellschafter inaktiv` review reason is gone. On user confirmation, the missing
BIC was looked up from the IBAN's bank code in the Deutsche Bundesbank register
and set on the founder, and both private address variants found for another
founder were added.

The feature shipped in `queen-v0.37.0`. The first live re-import failed because
the stored Gmail attachment id no longer matched the API's view; `queen-v0.37.1`
made re-import fall back to the PDF's content hash. After that release the
Porkbun claim was re-imported successfully from its original mail: the single
claim was updated in place with the founder's short name in the file name and a
fresh Drive file, no duplicate was created, and no second confirmation mail was
sent. Production deployed through the release pipeline with explicit approval.

## Verification commands

`npm run lint && npm run typecheck && npm run typecheck:server && npm test -- --maxWorkers=2`
— all green (109 files, 982 tests).

## Success criteria

- An admin can check a JSON file, see every row's action, and apply it only when
  there are no errors.
- A re-import reports `unchanged` instead of duplicating founders.
- Any validation or conflict leaves the registry untouched.

## Known issues

- An import only affects future mail matching; claims already in the DB are not
  re-assigned automatically and must be assigned in the table.
- The liability account uses the model default `3500` for all three founders
  until an advisor confirms otherwise.
- `gcli` is not installed; the discovery used the connected browser instead.
