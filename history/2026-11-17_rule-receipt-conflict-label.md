# 2026-11-17 — A rule/receipt conflict shows two labels, not two identical ones

## Problem

The booking dialog for an outgoing transaction (`Google Cloud EMEA Limited`,
04.11.2026) asked:

> **Regel und Beleg widersprechen sich. Wähle, was gebucht werden soll.**
> [Use the rule · 6837 · 19 %] [Use the receipt · 6837 · 19 %]

Both sides read `6837 · 19 %`, so the question looked pointless and the user
reported "rule and receipt are the same, why the choice?".

## Root cause — a real conflict, an incomplete label

The conflict itself is correct; only the label was wrong.

`readingToSuggestion()` (`lib/accounting/receiptReading.ts`) sets
`mode: 'reverseCharge'` and forces `REVERSE_CHARGE_RATE` (0.19) when the reading
says `reverseCharge: true`, keeping the receipt's own account (6837) — and Google
Cloud EMEA Limited is an Irish vendor, which is exactly a §13b receipt. The rule
side — learned earlier from a booking of the same vendor — therefore carried
`{ account: '6837', vatRate: 0.19, mode: 'normal' }`, the only state that renders
the same string as the receipt side. `suggestionConflict()` reported a conflict on
`mode` alone; `splitKey` and the account/rate comparisons agreed.

That difference is a real posting difference: `normal` books net to 6837 plus
Vorsteuer 1406, `reverseCharge` books the gross to 6837 plus 1407 against 3837
(`bankPosting`). `autoBook`/bulk booking must keep refusing it.

The defect was in the display. `BookingDialog.describe()` and
`FinancePage.label()` rendered `split ≥ 2 → "Aufteilung auf n Konten"`,
`mode === 'vatOnly' → "nur USt"`, else `` `${account} · ${rate * 100} %` `` —
neither rendered `reverseCharge` (`§13b`), although both i18n files already had
`finance.outcome.reverseCharge`. A split-vs-split conflict had the same issue:
both sides read `Aufteilung auf 2 Konten`, whatever their parts. And two `vatOnly`
sides at different rates both read `nur USt`.

Decisive evidence: `suggestionConflict()` can only report a conflict when account,
rate or mode differ (the totals already agree). Two identical labels therefore
leave `mode` as the only possible difference: with equal labels the account is
equal and the rendered rate is equal, and `vatOnly`/split sides render a third
and a fourth string. `undefined` rates cannot be the cause either — they rendered
`0 %`, which is visibly different from `19 %` — and the split branch only conflicts
when the `splitKey` (accounts, rates, amounts, modes) differs. A spurious-conflict
fix was therefore not needed; `suggestionConflict()` and the `conflict` semantics
are untouched.

## Fix

- **One shared formatter** `src/client/lib/bookingLabel.ts` → `formatBooking()`:
  - `normal`: `6837 · 19 %` (account name when the caller has one: `6837 Lizenzen · 19 %`);
  - `reverseCharge`: `6837 · 19 % · §13b`;
  - `vatOnly`: `nur USt · 19 %` (no account — the rate keeps two rows apart);
  - no VAT rate on the rule: `6837 · USt-Satz offen` (previously a false `0 %`);
  - a split: `Aufteilung auf 2 Konten · 6837 19 % · 83,30 € + 6830 7 % · 35,70 €`,
    every part with account, rate, amount and `§13b` where it applies — so two
    splits never collide, not even when they differ only in how the amount is
    distributed.
- `BookingDialog.describe()` and `FinancePage`'s conflict line and row outcome
  both call it, so they cannot drift again. The dialog's side buttons, its
  preselection and its preview are unchanged.
- The row outcome no longer repeats the receipt's VAT lines under a split: the
  split label already carries account, rate and amount per part.
- Posting, auto-booking, bulk booking and `bookings.ts` are untouched.

## Files changed

- `src/client/lib/bookingLabel.ts` (new) — `formatBooking()`.
- `src/client/components/BookingDialog.tsx` — `describe()` → `formatBooking`.
- `src/client/pages/FinancePage.tsx` — conflict label and row outcome → `formatBooking`.
- `src/client/i18n/de.ts`, `src/client/i18n/en.ts` — `finance.outcome.rateOpen`.
- `src/client/__tests__/bookingLabel.test.ts` (new), `src/client/__tests__/financePage.test.tsx`
  — the reported case and a split-vs-split case assert different side labels.
- `src/server/lib/accounting/__tests__/suggestionConflict.test.ts` — pins the
  reported combination as a real conflict (`6837` / `0.19` normal vs
  `6837` / `0.19` reverse charge).
- `AGENTS.md` — the conflict clause now requires distinguishable labels.

## Verification

```bash
NODE_ENV=development npx vitest run src/client/__tests__/financePage.test.tsx \
  src/client/__tests__/bookingLabel.test.ts src/client/__tests__/i18n.test.tsx \
  src/server/lib/accounting/__tests__/suggestionConflict.test.ts
npm run lint && npm run typecheck && npm run typecheck:server && npm run build
```

Before the fix, `financePage.test.tsx` failed twice: the conflict line rendered
`Regel: 6837 · 19 % · Beleg: 6837 · 19 %` (identical), and a split-vs-split asked
`Aufteilung auf 2 Konten` on both sides. After it, both cases read differently and
the existing "a conflict is not bookable in one click" test still passes.

## Success criteria

- A rule `6837 / 19 % normal` against a receipt `6837 / 19 % §13b` shows
  `6837 · 19 %` versus `6837 · 19 % · §13b` in the row and on the two dialog
  buttons; picking a side books that side.
- Two splits of the same size render their parts; two different splits never
  render the same string.
- A genuine conflict is still a conflict: one-click, bulk and auto booking refuse
  it (`conflict` unchanged).

## Known issues

- Very wide splits make a long button/row line; the buttons wrap and the parts are
  short (`6837 19 % · 83,30 €`), so it stays readable rather than truncated —
  truncation would let two different bookings read alike again.

## Future enhancements

- If splits ever exceed four parts, move the parts into a tooltip (`title`) while
  keeping the full text in the accessible name.
