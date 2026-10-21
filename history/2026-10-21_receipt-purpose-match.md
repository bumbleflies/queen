# 2026-10-21 — Receipts matched from the Verwendungszweck

## Problem

The Finanzen inbox showed "kein Vorschlag" on every row even though the receipts were in the Belege folder (`überwiesen/2026`).

- **Vorschlag is rule-based only:** a suggestion comes from supplier rules (IBAN, purpose or name pattern). Receipts never create one, because a booking also needs an account and a VAT rate.
- **The receipt picker was broken:** `receipts.list` returns `{ id, name, link, score }`, but `BookingDialog` read `driveFileId`/`fileName`, and an `as unknown as` cast hid the mismatch. Options had no labels and a chosen receipt was never sent.
- **The ranking ignored the Verwendungszweck,** although bank texts often carry the supplier's invoice number or the receipt's file name (Spesen, sometimes with a Drive link).

## Solution

- `rankReceipts` scores the Verwendungszweck:
  - +10 when it contains the file's Drive id.
  - +5 when it contains the file name without `.pdf`.
  - +5 when it shares a whole run of ≥ 6 digits with the file name.
- `strongReceipt` picks the top candidate when its score is ≥ 5 and it is strictly ahead of the runner-up.
- `BookingDialog` uses the real field names and preselects a strong match.
- `bookings.bookBulk` attaches a strong match automatically. It lists Drive once per year and books without a receipt when Drive fails or no folder is set.

## Main files

- `src/server/lib/accounting/receipts.ts`, `src/server/routers/bookings.ts`, `src/client/components/BookingDialog.tsx`
- Tests: `receipts.test.ts`, `bookings.test.ts`, `financePage.test.tsx`

## Verification commands

```bash
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

## Success criteria

- A debit whose Verwendungszweck carries an invoice number preselects the receipt file named with that number.
- Bulk booking of rule-matched rows stores the matching receipt.

## Known issues

- Rows still need a supplier rule before a Vorschlag appears. Book one row by hand with "als Regel merken".
- A bank transaction holds one receipt, so a transfer covering two Spesen gets only the receipt that matches.

## Deployment results

- Merged to `master` (PR #132) and released in `queen-v0.20.0` (release PR #134), together with the booking rules overview (#133).
- Production: Watchtower (dev scope, 5-minute poll) recreated `finance.queen` from `:latest` at 20:23 UTC. It is healthy, `/health` returns 200, `package.json` reports `0.20.0`, and the served bundle contains the new code. Ofelia ran the daily reconcile normally this morning; the first run on 0.20.0 is at 07:30.
- servyy-test: `./servyy-test.sh --tags user.docker.shared,user.docker.finance,user.docker.env.finance` finished with 0 failures. It also brought back `shared.mongo` and `shared.redis`, which were not running on test. `finance.queen` is healthy on `0.20.0`, the DB is connected and `getTimezoneOffset()` returns `-120`. Test runs on an empty database, so this check covers startup only.
