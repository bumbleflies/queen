# 2026-11-18 — Bills: a misread invoice is parsed right, and correctable by hand

## Problem

A Hetzner invoice for **12,14 €** (net 10,20 + 19 % = 1,94) showed up on
Finanzen → Belege as **2.026,00 €**, and the Bundesanzeiger invoice carried a VAT
of **997,00 €** that appears nowhere on the document. Both were filed correctly;
only the numbers read out of the PDF were wrong, and nothing in the app could fix
them (a "re-read" reproduces exactly the same misread).

The text layer of the Hetzner PDF explains all of it:

```
Service Period Total (excl. VAT) Tax Total
Project "servy" 10/2026 € 7.00 € 1.33A1 € 8.33
Storage 10/2026 € 3.20 € 0.61A1 € 3.81
Total € 10.20 € 1.94 € 12.14
VAT Reg. No.: DE812871812
```

1. `Total (excl. VAT)` is the **net** column of the table, but the gross label
   pattern matched it. The row below begins with the period `10/2026`, and the
   amount reader took `2026` plus the following `€` as money — **2 026,00 €**.
2. `VAT Reg. No.: DE…` matched the VAT label, so the digits of an identification
   number became the VAT amount (Hetzner 33 626 297 200,00 €, Bundesanzeiger
   997,00 € from `Ust-Ident-Nr. DE 122 787 997`).
3. Even without (1), the `Total` row lists net, VAT and gross in one line and the
   *first* currency amount was taken — the net.

## What changed

### The read (`src/server/lib/bills/parseBill.ts`)

- **Periods and dates are not money.** Amount tokens may not be glued to a `/`
  (`10/2026`, `16/11/2026`), and a bare 19xx/20xx/21xx is a year, not a price.
- **The currency mark counts on either side** (`€ 10,20`, `10.20 EUR`): German
  tables put it before the number, English ones after it.
- **`Total (excl. VAT)` / `exkl. MwSt.` is a net column**: such a line never
  yields a gross and never a VAT amount.
- **A tax registration line is metadata**: `VAT Reg. No.`, `Ust-Ident-Nr.`,
  `Steuernummer` are skipped entirely.
- **A total row's gross is its largest amount** (net, VAT, gross read left to
  right); the value-before-label rule (`49,15` above `Brutto-Rechnungsbetrag`)
  only applies when the label line carries no amounts of its own and is not
  followed by them, so the last line item above `Total …` can no longer win.
- **Letterhead sender lines are trimmed** at the first `•`
  (`Hetzner Online GmbH • Industriestr. 25 • 91710 …` → `Hetzner Online GmbH`),
  and `Due date of payment: 19/11/2026` is now read as a due date.

### The correction (`bills.correct`)

- `Bill.corrected` stores an admin's values beside `Bill.parse` (the read), with
  `correctedAt`/`correctedBy`. `services/billMatch.billFieldsOf` merges them —
  correction wins, an explicit `null` clears — and is the only read path for the
  table, the inbox hint and the payment matching, so a corrected amount is what
  `rematchBills` matches against.
- `bills.reread` keeps writing only `parse`, so it repairs the read without
  discarding a correction (covered by a test).
- The Belege tab gets a **Korrigieren** button per row (admin) opening a dialog
  prefilled with what the bill says today: vendor, invoice number, gross, net,
  VAT amount, VAT rate, due date. Money fields accept German input (`12,14`);
  unreadable input is refused with the offending text instead of being written.
  A corrected row is marked `manuell korrigiert`.
- Nothing is booked: a bill is still only a bill, and the correction is not a
  booking rule.

## Files changed

- `src/server/lib/bills/parseBill.ts` — amount reader (period/year/currency
  order), net-column header, tax-ID lines, gross-from-total-row, vendor line,
  `Due date of payment` (+ tests, with the real Hetzner table layout).
- `src/server/models/Bill.ts` — `corrected` (same fields as `parse` plus
  `correctedAt`/`correctedBy`); parse fields factored into a factory.
- `src/server/services/billMatch.ts` — `billFieldsOf`, `BillFieldsSource`,
  `BillFields`; `billLikeOf`/`billHintOf` go through the merge.
- `src/server/routers/bills.ts` — `list` returns the merged fields plus a
  `corrected` marker; new `correct` mutation (admin only, `NOT_FOUND` on an
  unknown bill).
- `src/client/components/BillCorrectDialog.tsx` (new),
  `src/client/components/BillsSection.tsx`, `src/client/components/FinanceDialogs.tsx`
  (`Modal` exported), `src/client/i18n/{de,en}.ts` (+ client tests).
- `AGENTS.md` (invariant), this log.

## Verification commands

```bash
npx vitest run src/server/lib/bills/__tests__/parseBill.test.ts \
  src/server/routers/__tests__/bills.test.ts \
  src/client/components/__tests__/BillsSection.test.tsx
npm run lint && npm run typecheck && npm run typecheck:server && npm test
```

The DB-backed tests need a MongoDB (CI's `pr-tests` uses
`mongodb-memory-server` per worker; this Alpine container has no mongod build, so
they were run against a scratch database on the host's `shared.mongo` over an SSH
tunnel). Result there: **767/768 green**; the one red
(`settings.test.ts` / `bills.intakeNow`) sees a `Setting{key:'drive'}` left by
another file, because a single scratch database is shared across files — both
files pass on their own and CI keeps one memory server per worker.

## Success criteria

- The Hetzner invoice reads gross **12,14 €**, invoice no. `087001370124`, due
  19.11.2026, vendor `Hetzner Online GmbH` — and no VAT from the tax number.
- The Bundesanzeiger invoice reads **49,15 €** with no invented VAT.
- An admin can correct any bill's fields; the read stays on the document, a
  re-read does not undo the correction, and the corrected amount drives the
  bill↔payment match.
- A correction books nothing and teaches no rule.

## Known issues

- The reader still leaves `netCents`/`vatCents`/`vatRate` empty on Hetzner-style
  tables: the amounts are stated in an unlabelled `Total` row and the rate sits
  under a `Tax rate` header, which the parser does not yet associate. The
  correction dialog is the intended answer; the rate is not guessed.
- Corrections are the admin's word: they are not compared against the PDF, and
  the bill's history shows only `correctedBy`/`correctedAt` (no diff of the read).

## Future enhancements

- Derive net/VAT from a stated rate when the gross row's amounts add up, instead
  of leaving them empty.
- A per-vendor read profile (Hetzner, Bundesanzeiger, Google) if more layouts
  keep needing the same rules.
