# 2026-11-26 — Receipt preview embedded where decisions happen

## Problem

The PDF preview existed only behind the claim row's `Vorschau` action. Two
places where a human actually decides were still blind: the payout approval
page listed receipts as links only, and the correction dialog showed the read
values without the document they came from. The GiroCode card also had no CSS
for its classes, so labels, values and copy buttons ran together in one line.

## Solution

- A shared `ClaimPdf` renders the proxied `claims.preview` bytes inline.
- `ReceiptPreview` adds a `Vorschau` button to each receipt on the payout page;
  `payouts.get` now returns `driveFileId` so the PDF can be fetched.
- The correction dialog is wider and two-column: fields on the left, the live
  PDF on the right (stacked on mobile).
- The payout detail list, receipt list, QR card and copy fields get real layout
  rules: QR on the left, reference/total/purpose and actions on the right,
  with labels separated from values and wrapping on narrow screens.

## Files changed

- `src/client/components/ClaimPdf.tsx` (new), `ReceiptPreview.tsx` (new)
- `src/client/pages/PayoutPage.tsx`, `src/client/components/ClaimCorrectDialog.tsx`,
  `src/client/components/FinanceDialogs.tsx`, `src/client/index.css`
- `src/server/routers/payouts.ts`
- Tests: `payoutPage.test.tsx`, `expensesSection.test.tsx`

## Verification commands

`npm run lint && npm run typecheck && npm run typecheck:server && npm test -- --maxWorkers=2`
— all green (112 files, 1001 tests).

## Deployment results

Shipped in `queen-v0.39.0`. Verified live on the released payout
`SP-2026-0002`: the receipt row has a `Vorschau` button that opens the real
PDF, and the GiroCode card shows the QR on the left with reference, total,
purpose and copy/approval actions on the right. That claim is `payoutPending`,
so its correction actions are locked by design; the embedded preview in the
correction dialog is covered by the component test.

## Success criteria / known issues

- Both decisions can be made while looking at the actual receipt.
- The GiroCode card is two-column on desktop and single-column on mobile.
