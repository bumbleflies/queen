# Founder expenses — design summary

Date: 2026-11-23

## Problem

Founders pay company expenses privately and forward the receipts by mail. The
old flow lived in a spreadsheet and in inboxes: amounts were retyped, the
reimbursement was booked as if it were a vendor invoice, and there was no
reliable link between a receipt, the liability and the bank transfer that
settled it.

## Solution in three increments

1. **Registry + intake.** An admin-managed founder registry holds the addresses
   that map an incoming mail to a person, the workspace login address, the
   payout target and the SKR04 liability account. The hourly intake reads the
   expenses mailbox, files each PDF under `<receipts>/Spesen/<year>/`, stores a
   conservative read of the document on a claim, and replies once in the
   sender's own thread with a claim link behind login.
2. **Confidence + booking.** A claim becomes a payable only when booked. A
   single pure confidence check decides what may auto-book (complete read,
   active founder, existing account, open fiscal year, no duplicate, configured
   limit). Booking posts the expense against the founder's liability; a
   correction reverses the live entry and rebooks from the human's values.
3. **Payout + settlement (this increment).** One draft per founder aggregates
   open booked claims into a payout with a gapless reference and a purpose. An
   admin releases it, which locks the claims and posts a German reply mail with
   an authenticated deep link. The page shows an EPC/GiroCode QR only after
   login. The daily reconcile matches the outgoing bank row by reference, then
   by payout target + exact amount, then by a legacy Spesen purpose; a match
   posts the bank ↔ liability settlement, attaches the receipt and marks every
   claim and the payout settled.

## Invariants

- A received claim is not a payment; only booking creates a liability.
- The payout never books an expense — only the matched bank row settles it.
- Exact amounts everywhere; a mismatch or a tie is never guessed.
- Dividend-like purposes never match a founder reimbursement.
- Founder payout targets never create or extend a supplier rule, are never
  auto-booked, and never produce an expense suggestion.
- Entries are immutable; corrections are reversals.
- The QR is an EPC string rendered in the browser; there is no public,
  tokenized payout page. Approval is the authenticated `release` action.
- Mail failures only warn; they never un-release a payout or fail a reconcile.

## Data flow

```
expenses mailbox → claim (read + PDF) → booked claim (liability)
      → payout draft → released (mail + QR) → matched bank row
      → expense_payout entry → settled payout + settled claims
```

## Non-goals

- No Google group creation, no mailbox provisioning, no deployment changes.
- No new public API surface, no tokenized links, no images rendered server-side.
- No change to the ledger's available-cash formula: a settlement moves cash and
  the matching liability by the same amount.
