# Accounting Phase 2 — Bank import and Buchen inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every GLS transaction ends up in the journal exactly once. Phase 1 already books invoice payments automatically. This phase pulls withdrawals from Firefly too, and adds a "Buchen" inbox where every other transaction is booked: account + VAT, supplier rules with bulk confirm, receipts linked from Drive, and a check that ledger 1800 equals the Firefly balance.

**Architecture:**
- `FireflyClient` syncs both directions into `BankTransaction` (new `direction`).
- Pure `bankPosting` turns a transaction plus a booking choice into balanced lines.
- `bankBooking.ts` writes entries through the existing `ledger.post` with source `{ kind: 'bank', refId: <fireflyJournalId> }`.
- Pure `suggest` maps transactions to supplier rules.
- Pure `rankReceipts` orders Drive PDFs.
- Receipts, supplier and missing-receipt reason live on the **BankTransaction**. It is mutable metadata, so the immutable journal entry never changes.
- A new `/bookings` page (DE/EN) holds the inbox, the booked list and suppliers.

**Tech Stack:** TypeScript, Mongoose 9, tRPC 11, zod, googleapis (Drive v3), React 19, vitest + mongodb-memory-server.

**Spec:** `docs/plans/2026-10-07-accounting.md`, section "Phase 2 detail: bank import and Buchen inbox". Read it first. Phase 1 plan for conventions: `docs/plans/2026-10-07-accounting-phase1.md`.

## Global Constraints

- **Money:** integer cents everywhere. Reuse `fireflyAmountToCents`, `parseGermanAmount` and `formatGermanEUR` from `src/server/lib/money.ts`.
- **Journal entries are immutable.** Write only via `post` / `postOnce` / `reverse` in `src/server/lib/accounting/ledger.ts`. Never use `collection` / `bulkWrite` / `insertMany` on `JournalEntry`.
- **Bank booking source:** `{ kind: 'bank', refId: <fireflyJournalId> }`. Invoice payments keep `{ kind: 'payment', refId: 'bank:<fireflyJournalId>' }`.
- **Coverage rule:** a transaction is booked iff an active `payment` entry with refId `bank:<id>` or an active `bank` entry with refId `<id>` exists.
  - An invoice-matched transaction (`matchedInvoiceId` set) can never be inbox-booked.
  - An inbox-booked transaction can never be assigned to an invoice until its entry is reversed.
- **Nothing posts without confirmation.** Rules only suggest. Bulk confirm books the selected transactions with their suggestions.
- **VAT accounts:**
  - Input VAT 0.19 → 1406, 0.07 → 1401.
  - Output VAT 0.19 → 3806, 0.07 → 3801.
  - Allowed rates: 0, 0.07, 0.19.
  - Net = `Math.round(gross / (1 + rate))`, VAT = gross − net.
- **Bank account:** 1800. A booking account may never be 1800.
- **Mutable metadata:** receipt `{ driveFileId, fileName, link }`, `receiptMissingReason` and `supplierId` live on `BankTransaction`, never on `JournalEntry`.
- **Kreditor numbers:** 70000–99999 via `Counter` `_id: 'supplier'`, never below 70000. The creditor import raises the counter to the highest imported number.
- **Withdrawals never appear in Bankabgleich.** Bank list / reconcile filters use `direction: { $ne: 'out' }`, so rows without `direction` count as incoming.
- **Ledger hooks** keep using `safeLedger`. Booking endpoints surface errors to the user (they are explicit user actions).
- **UI copy goes through i18n.** Add keys to both `src/client/i18n/de.ts` and `en.ts`; the parity test enforces it. Colours come only from CSS variables. Tables use `table.resp` + `data-l`.
- **Style:** single quotes, existing wrapping, no Prettier. Run vitest with `NODE_ENV=development` (DB tests skip silently without it).
- **Public repo:** no customer data, creditor names or real amounts in code, tests or fixtures.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Verify with** `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.

## Review Focus

1. **First sync after deploy only looks back 7 days.** Withdrawals from January to now would never arrive. `bank.syncNow({ full: true })` must resync from `QUEEN_BANK_START`. Test in Task 1 (`computeSyncWindow` with `full`).
2. **Legacy deposit rows have no `direction`.** They must still count as incoming everywhere: the Bankabgleich list, reconcile, and the nav badge. Test in Task 1 (`buildBankListFilter` + reconcile ignores `out`).
3. **A deposit ignored in Bankabgleich (e.g. a tax refund) is not an invoice payment, but it still has to be booked.** It must appear in the Buchen inbox. Test in Task 4 (inbox includes ignored deposits).
4. **Crossing paths:** booking an invoice-matched transaction, or assigning a booked transaction to an invoice, must be refused with a clear message. Test in Task 4.
5. **Bulk confirm with mixed items:** one transaction without a suggestion or with a failing booking must not stop the others. Each result is reported. Test in Task 4.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/server/services/FireflyClient.ts` (modify) | `fetchTransactions` (both directions), `fetchBalance` |
| `src/server/lib/bankSync.ts` (modify) | sync both directions, `full` window |
| `src/server/models/BankTransaction.ts` (modify) | `direction`, `supplierId`, `receipt`, `receiptMissingReason` |
| `src/server/lib/reconcile.ts`, `src/server/routers/bank.ts`, `src/server/cron/reconcile.ts` (modify) | ignore withdrawals; refuse assigning booked transactions; full resync |
| `src/server/lib/accounting/postingRules.ts` (modify) | `splitGross`, `bankPosting` |
| `src/server/models/Supplier.ts` (new) | supplier master data and rules |
| `src/server/lib/accounting/suggest.ts` (new) | pure rule matching |
| `src/server/lib/accounting/creditorImport.ts` (new) | parse/apply creditor CSV |
| `src/server/lib/numbering.ts` (modify) | `allocateSupplierNumber`, `raiseSupplierCounter` |
| `src/server/routers/suppliers.ts` (new) | supplier CRUD |
| `src/server/lib/accounting/bankBooking.ts` (new) | coverage, book / unbook, remember rule |
| `src/server/routers/bookings.ts` (new) | inbox, booked, stats, book, bookBulk, unbook, setReceipt, balanceCheck |
| `src/server/lib/accounting/receipts.ts` (new) | pure receipt ranking |
| `src/server/services/receiptsDrive.ts` (new) | list PDFs in the year folder |
| `src/server/services/driveForUser.ts` (new) | Drive client for the logged-in user (extracted from `admin.ts`) |
| `src/server/routers/receipts.ts` (new) | `receipts.list` |
| `src/client/lib/bookingPreview.ts` (new) | preview lines in the dialog |
| `src/client/components/BookingDialog.tsx` (new), `src/client/pages/BookingsPage.tsx` (new), `src/client/components/SuppliersPanel.tsx` (new) | UI |
| `src/client/main.tsx`, `src/client/components/Navigation.tsx`, `src/client/i18n/{de,en}.ts` (modify) | route, nav + badge, copy |
| `AGENTS.md`, `.env.example`, `history/…`, spec (modify) | docs |

---

### Task 1: Sync withdrawals and keep Bankabgleich incoming-only

**Files:**
- Modify: `src/server/services/FireflyClient.ts`, `src/server/lib/bankSync.ts`, `src/server/models/BankTransaction.ts`, `src/server/lib/reconcile.ts`, `src/server/routers/bank.ts`, `src/server/cron/reconcile.ts`
- Test: `src/server/services/__tests__/fireflyClient.test.ts`, `src/server/lib/__tests__/bankSync.test.ts`, `src/server/routers/__tests__/bank.test.ts`, `src/server/routers/__tests__/reconcile.test.ts`

**Interfaces:**
- Produces:
  - `type TransactionDirection = 'in' | 'out'`.
  - `FireflyTransaction` becomes `{ fireflyJournalId, date, amountCents (positive), currency, description, direction, counterpartyName?, counterpartyIban? }`. The old `sourceName` / `sourceIban` / `destinationIban` fields are removed.
  - `FireflyClient.fetchTransactions(start, end): Promise<FireflyTransaction[]>` replaces `fetchDeposits`.
  - `FireflyClient.fetchBalance(date: Date): Promise<number>` returns cents.
  - `TransactionSource { fetchTransactions(start, end) }` in `cron/reconcile.ts` replaces `DepositSource`.
  - `computeSyncWindow({ lastRunFinishedAt?, bankStart, now, full? })`.
  - `bank.syncNow` input `{ full?: boolean }`.
  - `BankTransaction.direction`.

- [ ] **Step 1: Write failing tests.**

In `fireflyClient.test.ts`:
- Rename the `describe('FireflyClient.fetchDeposits'` block to `fetchTransactions` and call `client.fetchTransactions(...)` everywhere.
- Change the expected URL query from `type=deposit` to `type=all` wherever it is asserted.
- Replace the mapped-field assertions (`sourceName` / `sourceIban` / `destinationIban`) with `counterpartyName: 'Acme GmbH'`, `counterpartyIban: 'DE02120300000000202051'` and `direction: 'in'`.

Then add:

```ts
function withdrawalSplit(overrides: Record<string, unknown> = {}) {
  return {
    type: 'withdrawal',
    date: '2026-01-30T00:00:00+00:00',
    amount: '8.24',
    currency_code: 'EUR',
    description: 'Abrechnung vom 29.01.2026',
    source_name: 'GLS',
    source_iban: 'DE02100500000054540402',
    destination_name: 'Beispiel Software Ltd',
    destination_iban: 'IE29AIBK93115212345678',
    ...overrides,
  };
}

describe('FireflyClient.fetchTransactions directions', () => {
  it('maps withdrawals to direction out with the destination as counterparty and skips transfers', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        200,
        {
          data: [
            { type: 'transactions', attributes: { transaction_journal_id: '50', transactions: [withdrawalSplit()] } },
            { type: 'transactions', attributes: { transaction_journal_id: '51', transactions: [depositSplit()] } },
            { type: 'transactions', attributes: { transaction_journal_id: '52', transactions: [depositSplit({ type: 'transfer' })] } },
          ],
          meta: { pagination: { total_pages: 1, current_page: 1 } },
        },
      ),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    const txs = await client.fetchTransactions(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-31T00:00:00Z'));
    expect(String(fetchImpl.mock.calls[0][0])).toContain('type=all');
    expect(txs).toHaveLength(2);
    expect(txs[0]).toMatchObject({
      fireflyJournalId: '50:0',
      direction: 'out',
      amountCents: 824,
      counterpartyName: 'Beispiel Software Ltd',
      counterpartyIban: 'IE29AIBK93115212345678',
    });
    expect(txs[1]).toMatchObject({ fireflyJournalId: '51:0', direction: 'in', counterpartyName: 'Acme GmbH' });
  });
});

describe('FireflyClient.fetchBalance', () => {
  it('reads current_balance for the given date as cents', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { data: { attributes: { current_balance: '1234.56' } } }),
    );
    const client = new FireflyClient({ ...opts, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await client.fetchBalance(new Date(2026, 11, 31))).toBe(123456);
    expect(String(fetchImpl.mock.calls[0][0])).toBe('http://firefly:8080/api/v1/accounts/7?date=2026-12-31');
  });
});
```

In `bankSync.test.ts`:
- Change the fixture `tx` to the new shape: replace `sourceName` / `sourceIban` / `destinationIban` with `direction: 'in'`, `counterpartyName: 'Acme GmbH'`, `counterpartyIban: 'DE02120300000000202051'`.
- Rename client mocks from `fetchDeposits` to `fetchTransactions`.
- Add `direction: 'in'` to the expected `$set`.

Then add:

```ts
it('full window starts at QUEEN_BANK_START even after earlier runs', () => {
  const now = new Date('2026-10-07T12:00:00Z');
  const lastRunFinishedAt = new Date('2026-10-06T06:30:00Z');
  expect(computeSyncWindow({ lastRunFinishedAt, bankStart, now, full: true }).from).toEqual(bankStart);
});
```

In `src/server/routers/__tests__/bank.test.ts`, add (pure, no DB):

```ts
import { buildBankListFilter } from '../bank';

describe('buildBankListFilter excludes withdrawals', () => {
  it('always filters direction != out (legacy rows without direction count as incoming)', () => {
    expect(buildBankListFilter()).toEqual({ direction: { $ne: 'out' } });
    expect(buildBankListFilter({ unmatchedOnly: true })).toEqual({
      direction: { $ne: 'out' },
      matchedInvoiceId: null,
      ignored: { $ne: true },
    });
  });
});
```

In `src/server/routers/__tests__/reconcile.test.ts`, add one DB test using that file's existing setup. A `BankTransaction` with `direction: 'out'` and a description containing a valid Verwendungszweck for an existing sent invoice must stay unmatched after `reconcilePendingTransactions()` (`matchedInvoiceId` stays null, the invoice stays `sent`).

- [ ] **Step 2: Run the tests and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/server/services/__tests__/fireflyClient.test.ts src/server/lib/__tests__/bankSync.test.ts src/server/routers/__tests__/bank.test.ts src/server/routers/__tests__/reconcile.test.ts`

Expected: FAIL (`fetchTransactions` is not a function, filter mismatch, withdrawal gets matched).

- [ ] **Step 3: Implement.**

`FireflyClient.ts`:
- Export `TransactionDirection`.
- Change `FireflyTransaction` as above.
- Add `type?: string` to `FireflySplit`.
- Replace `fetchDeposits` with:

```ts
  /** All GLS transactions in [start, end]; transfers and other types are skipped. */
  async fetchTransactions(start: Date, end: Date): Promise<FireflyTransaction[]> {
    const out: FireflyTransaction[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const url =
        `${this.baseUrl}/api/v1/accounts/${this.glsAccountId}/transactions` +
        `?type=all&start=${formatDate(start)}&end=${formatDate(end)}` +
        `&limit=${PAGE_LIMIT}&page=${page}`;
      const body = await this.getJson<FireflyDepositsResponse>(url);
      totalPages = body.meta?.pagination?.total_pages ?? 1;
      const journals = body.data ?? [];
      if (journals.length === 0) break;
      for (const journal of journals) {
        const attributes = journal.attributes;
        const journalId = attributes?.transaction_journal_id;
        (attributes?.transactions ?? []).forEach((split, splitIndex) => {
          const mapped = this.mapSplit(journalId, splitIndex, split);
          if (mapped) out.push(mapped);
        });
      }
      page += 1;
    } while (page <= totalPages);
    return out;
  }

  /** Account balance at the end of the LOCAL business date `date`, in cents. */
  async fetchBalance(date: Date): Promise<number> {
    // Local date components: `date` is a German business date (e.g. new Date(year, 11, 31));
    // formatDate() uses UTC and would shift local midnight to the previous day.
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const body = await this.getJson<{ data?: { attributes?: { current_balance?: string } } }>(
      `${this.baseUrl}/api/v1/accounts/${this.glsAccountId}?date=${day}`,
    );
    return fireflyAmountToCents(body.data?.attributes?.current_balance ?? '0');
  }
```

`mapSplit` now returns `FireflyTransaction | null`. The direction is `'in'` for `deposit` and `'out'` for `withdrawal`; any other type returns `null`. The counterparty is the source for `in` and the destination for `out`:

```ts
  private mapSplit(journalId: string | number | undefined, splitIndex: number, split: FireflySplit): FireflyTransaction | null {
    const direction = split.type === 'deposit' ? 'in' : split.type === 'withdrawal' ? 'out' : null;
    if (!direction) return null;
    return {
      fireflyJournalId: `${journalId ?? 'unknown'}:${splitIndex}`,
      date: split.date ? new Date(split.date) : new Date(0),
      amountCents: Math.abs(fireflyAmountToCents(split.amount ?? '0')),
      currency: split.currency_code ?? 'EUR',
      description: split.description ?? '',
      direction,
      counterpartyName: direction === 'in' ? split.source_name : split.destination_name,
      counterpartyIban: direction === 'in' ? split.source_iban : split.destination_iban,
    };
  }
```

Rename the `FireflyDepositsResponse` type to `FireflyTransactionsResponse`. Update the class doc comment.

`bankSync.ts`:
- `client: { fetchTransactions(start, end) }`.
- `$set` gets `direction: tx.direction`, `counterpartyName: tx.counterpartyName` and `counterpartyIban: tx.counterpartyIban`.
- `computeSyncWindow` takes `full?: boolean`; when it is true, `from = bankStart`.

`BankTransaction.ts`, add:

```ts
    direction: { type: String, enum: ['in', 'out'], required: true, default: 'in' },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier' },
    receipt: {
      type: new Schema(
        { driveFileId: { type: String }, fileName: { type: String }, link: { type: String } },
        { _id: false },
      ),
    },
    receiptMissingReason: { type: String },
```

`reconcile.ts`:
- `reconcilePendingTransactions` adds `direction: { $ne: 'out' }` to its query.
- `reconcileBankTransaction` and `assignBankTransactionToInvoice` return `{ outcome: 'unmatched', reason: 'withdrawal' }` when `bankTx.direction === 'out'`.

`bank.ts`:
- `buildBankListFilter` starts with `{ direction: { $ne: 'out' } }`.
- `syncNow` takes `.input(z.object({ full: z.boolean().optional() }).optional())` and passes `full: input?.full` to `computeSyncWindow`.

`cron/reconcile.ts`: rename `DepositSource` to `TransactionSource` with `fetchTransactions`. Update the doc comments that say "deposits" to "transactions".

Update any other test files that construct `FireflyTransaction` or mock `fetchDeposits` (grep `fetchDeposits|sourceIban|sourceName|destinationIban` under `src/`).

- [ ] **Step 4: Run the tests and verify they pass.**

Run the Step 2 command, then `npm run typecheck:server && npm test`.

Expected: all green, and no `[ledger]` noise with `--silent=false`.

- [ ] **Step 5: Commit.**

```bash
git add -A src/server
git commit -m "feat(bank): sync withdrawals from Firefly; Bankabgleich stays incoming-only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Bank posting rule (pure)

**Files:**
- Modify: `src/server/lib/accounting/postingRules.ts`
- Test: `src/server/lib/accounting/__tests__/postingRules.test.ts`

**Interfaces:**
- Consumes: `PostingLine`, `BANK`, `PostingError`, and the private `toLines` / `add` helpers in the same file.
- Produces:
  - `type BankBookingMode = 'normal' | 'vatOnly'`
  - `const BANK_VAT_RATES = [0, 0.07, 0.19] as const`
  - `splitGross(grossCents: number, vatRate: number): { netCents: number; vatCents: number }`
  - `interface BankPostingInput { direction: 'in' | 'out'; grossCents: number; account: string; vatRate: number; mode: BankBookingMode }`
  - `bankPosting(input: BankPostingInput): PostingLine[]`

- [ ] **Step 1: Write the failing tests** (append to `postingRules.test.ts`).

```ts
import { splitGross, bankPosting } from '../postingRules';

describe('splitGross', () => {
  it('splits gross half-up into net + VAT', () => {
    expect(splitGross(11900, 0.19)).toEqual({ netCents: 10000, vatCents: 1900 });
    expect(splitGross(999, 0.19)).toEqual({ netCents: 839, vatCents: 160 });
    expect(splitGross(107, 0.07)).toEqual({ netCents: 100, vatCents: 7 });
    expect(splitGross(1, 0.19)).toEqual({ netCents: 1, vatCents: 0 });
    expect(splitGross(5000, 0)).toEqual({ netCents: 5000, vatCents: 0 });
  });
});

describe('bankPosting', () => {
  it('outgoing 19 %: expense net + Vorsteuer an Bank', () => {
    expect(
      bankPosting({ direction: 'out', grossCents: 11900, account: '6837', vatRate: 0.19, mode: 'normal' }),
    ).toEqual([
      { account: '1406', debitCents: 1900, creditCents: 0 },
      { account: '1800', debitCents: 0, creditCents: 11900 },
      { account: '6837', debitCents: 10000, creditCents: 0 },
    ]);
  });

  it('outgoing 0 %: account an Bank, no VAT line', () => {
    expect(
      bankPosting({ direction: 'out', grossCents: 17500, account: '6420', vatRate: 0, mode: 'normal' }),
    ).toEqual([
      { account: '1800', debitCents: 0, creditCents: 17500 },
      { account: '6420', debitCents: 17500, creditCents: 0 },
    ]);
  });

  it('incoming 7 %: Bank an revenue net + USt', () => {
    expect(
      bankPosting({ direction: 'in', grossCents: 1070, account: '4300', vatRate: 0.07, mode: 'normal' }),
    ).toEqual([
      { account: '1800', debitCents: 1070, creditCents: 0 },
      { account: '3801', debitCents: 0, creditCents: 70 },
      { account: '4300', debitCents: 0, creditCents: 1000 },
    ]);
  });

  it('vatOnly outgoing books the whole amount to Vorsteuer (separate bank VAT debit)', () => {
    expect(
      bankPosting({ direction: 'out', grossCents: 157, account: '', vatRate: 0.19, mode: 'vatOnly' }),
    ).toEqual([
      { account: '1406', debitCents: 157, creditCents: 0 },
      { account: '1800', debitCents: 0, creditCents: 157 },
    ]);
  });

  it('vatOnly incoming books the whole amount to Umsatzsteuer', () => {
    expect(
      bankPosting({ direction: 'in', grossCents: 300, account: '', vatRate: 0.19, mode: 'vatOnly' }),
    ).toEqual([
      { account: '1800', debitCents: 300, creditCents: 0 },
      { account: '3806', debitCents: 0, creditCents: 300 },
    ]);
  });

  it.each([
    ['zero amount', { grossCents: 0 }],
    ['fractional amount', { grossCents: 1.5 }],
    ['unknown rate', { vatRate: 0.16 }],
    ['booking to the bank account itself', { account: '1800' }],
    ['missing account in normal mode', { account: '' }],
    ['vatOnly with rate 0', { mode: 'vatOnly', vatRate: 0 }],
  ])('rejects %s', (_name, override) => {
    expect(() =>
      bankPosting({
        direction: 'out',
        grossCents: 1000,
        account: '6300',
        vatRate: 0.19,
        mode: 'normal',
        ...(override as object),
      }),
    ).toThrowError(PostingError);
  });
});
```

- [ ] **Step 2: Run them and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/server/lib/accounting/__tests__/postingRules.test.ts`

Expected: FAIL (`splitGross` is not exported).

- [ ] **Step 3: Implement** (append to `postingRules.ts`).

```ts
export type BankBookingMode = 'normal' | 'vatOnly';
export const BANK_VAT_RATES = [0, 0.07, 0.19] as const;

const INPUT_VAT: Record<string, string> = { '0.19': '1406', '0.07': '1401' };
const OUTPUT_VAT: Record<string, string> = { '0.19': '3806', '0.07': '3801' };

/** Gross bank amount → net + VAT, half-up on the net. */
export function splitGross(grossCents: number, vatRate: number): { netCents: number; vatCents: number } {
  const netCents = Math.round(grossCents / (1 + vatRate));
  return { netCents, vatCents: grossCents - netCents };
}

export interface BankPostingInput {
  direction: 'in' | 'out';
  grossCents: number;
  account: string;
  vatRate: number;
  mode: BankBookingMode;
}

/**
 * Book one bank transaction. Outgoing: account (net) + Vorsteuer an Bank.
 * Incoming: Bank an account (net) + Umsatzsteuer. `vatOnly` books the whole
 * amount to the VAT account (e.g. a bank's separate "Mehrwertsteuerbelast").
 */
export function bankPosting(input: BankPostingInput): PostingLine[] {
  const { direction, grossCents, account, vatRate, mode } = input;
  if (!Number.isInteger(grossCents) || grossCents <= 0) {
    throw new PostingError(`Bank amount must be positive integer cents, got ${grossCents}`);
  }
  if (!(BANK_VAT_RATES as readonly number[]).includes(vatRate)) {
    throw new PostingError(`Unsupported VAT rate ${vatRate}`);
  }
  const sign = direction === 'out' ? 1 : -1; // debit side of the counter account
  const vatAccount = (direction === 'out' ? INPUT_VAT : OUTPUT_VAT)[String(vatRate)];
  const signed = new Map<string, number>();
  add(signed, BANK, -sign * grossCents);

  if (mode === 'vatOnly') {
    if (!vatAccount) throw new PostingError('vatOnly needs a VAT rate above 0');
    add(signed, vatAccount, sign * grossCents);
    return toLines(signed);
  }

  if (!account) throw new PostingError('Booking account is required');
  if (account === BANK) throw new PostingError('Cannot book a bank transaction to the bank account');
  const { netCents, vatCents } = splitGross(grossCents, vatRate);
  add(signed, account, sign * netCents);
  if (vatCents !== 0 && vatAccount) add(signed, vatAccount, sign * vatCents);
  return toLines(signed);
}
```

- [ ] **Step 4: Run them and verify they pass.** Use the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/server/lib/accounting/postingRules.ts src/server/lib/accounting/__tests__/postingRules.test.ts
git commit -m "feat(ledger): bank posting rule with VAT split and vat-only mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Suppliers, rule suggestion and creditor import

**Files:**
- Create: `src/server/models/Supplier.ts`, `src/server/lib/accounting/suggest.ts`, `src/server/lib/accounting/creditorImport.ts`, `src/server/routers/suppliers.ts`
- Modify: `src/server/lib/numbering.ts`, `src/server/routers/admin.ts`, `src/server/trpc.ts`
- Test: `src/server/lib/accounting/__tests__/suggest.test.ts`, `src/server/lib/accounting/__tests__/creditorImport.test.ts`, `src/server/routers/__tests__/suppliers.test.ts`

**Interfaces:**
- Consumes: `BankBookingMode` (Task 2); `parseCsv` (`src/server/lib/sheetImport.ts`); the `Counter` model; the `Account` model; test helpers `adminCaller`, `skipIfNoDb`, `initLedgerModels`, `resetLedgerDb` (`src/server/routers/__tests__/helpers/ledgerFixtures.ts`).
- Produces:
  - `Supplier` model `{ kreditorNumber, name, ibans: string[], namePatterns: string[], purposePatterns: string[], defaultAccount?, defaultVatRate?, defaultMode: 'normal'|'vatOnly', archived }`.
  - `normalizeIban(s: string): string`.
  - `interface SuggestTx { counterpartyName?: string | null; counterpartyIban?: string | null; description: string }`.
  - `interface SuggestSupplier { _id: unknown; kreditorNumber: number; name: string; ibans: string[]; namePatterns: string[]; purposePatterns: string[]; defaultAccount?: string | null; defaultVatRate?: number | null; defaultMode?: string | null; archived?: boolean | null }`.
  - `interface Suggestion { supplierId: string; kreditorNumber: number; supplierName: string; account?: string; vatRate?: number; mode: BankBookingMode; matchedBy: 'iban' | 'purpose' | 'name' }`.
  - `suggest(tx: SuggestTx, suppliers: SuggestSupplier[]): Suggestion | null`.
  - `allocateSupplierNumber(): Promise<number>`.
  - `raiseSupplierCounter(atLeast: number): Promise<void>`.
  - `parseCreditorsCsv(csv: string): { rows: { kreditorNumber: number; name: string }[]; errors: string[] }`.
  - `applyCreditorImport(rows, dryRun: boolean): Promise<{ created: number; existing: number }>`.
  - tRPC `suppliers.list({ includeArchived? })`, `suppliers.create(input)`, `suppliers.update({ id, ...input })`, `suppliers.setArchived({ id, archived })`.
  - `admin.importCreditors({ csv, dryRun = true })` → `{ rows: number; created: number; existing: number; errors: string[] }`.

- [ ] **Step 1: Write the failing pure tests.**

`src/server/lib/accounting/__tests__/suggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { suggest, normalizeIban, type SuggestSupplier } from '../suggest';

const base = { namePatterns: [], purposePatterns: [], ibans: [], archived: false };
const suppliers: SuggestSupplier[] = [
  { ...base, _id: 'a', kreditorNumber: 70001, name: 'Hausbank', purposePatterns: ['Abrechnung vom'], defaultAccount: '6855', defaultVatRate: 0, defaultMode: 'normal' },
  { ...base, _id: 'b', kreditorNumber: 70002, name: 'Hausbank USt', purposePatterns: ['Umsatzsteuer auf'], defaultVatRate: 0.19, defaultMode: 'vatOnly' },
  { ...base, _id: 'c', kreditorNumber: 70003, name: 'Software Ltd', ibans: ['IE29 AIBK 9311 5212 3456 78'], defaultAccount: '6837', defaultVatRate: 0 },
  { ...base, _id: 'd', kreditorNumber: 70004, name: 'Kammer', namePatterns: ['kammer'], defaultAccount: '6420', defaultVatRate: 0 },
  { ...base, _id: 'e', kreditorNumber: 70005, name: 'Alt', namePatterns: ['software'], archived: true, defaultAccount: '6300' },
];

describe('normalizeIban', () => {
  it('strips spaces and upper-cases', () => {
    expect(normalizeIban(' ie29 aibk 9311 5212 3456 78 ')).toBe('IE29AIBK93115212345678');
  });
});

describe('suggest', () => {
  it('matches by IBAN first', () => {
    expect(
      suggest({ counterpartyName: 'Software Ltd', counterpartyIban: 'IE29AIBK93115212345678', description: 'INV-1' }, suppliers),
    ).toMatchObject({ supplierId: 'c', kreditorNumber: 70003, account: '6837', vatRate: 0, mode: 'normal', matchedBy: 'iban' });
  });

  it('matches by purpose pattern, case-insensitive, whitespace-collapsed', () => {
    expect(suggest({ description: 'ABRECHNUNG   VOM 29.01.2026' }, suppliers)).toMatchObject({ supplierId: 'a', matchedBy: 'purpose' });
    expect(suggest({ description: '19% Umsatzsteuer auf EUR 8,24-' }, suppliers)).toMatchObject({ supplierId: 'b', mode: 'vatOnly', vatRate: 0.19 });
  });

  it('matches by name pattern last and ignores archived suppliers', () => {
    expect(suggest({ counterpartyName: 'IHK Kammer Süd', description: 'Beitrag' }, suppliers)).toMatchObject({ supplierId: 'd', matchedBy: 'name' });
    expect(suggest({ counterpartyName: 'Other Software GmbH', description: 'x' }, suppliers)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(suggest({ counterpartyName: 'Unbekannt', description: 'Gutschrift' }, suppliers)).toBeNull();
  });
});
```

`src/server/lib/accounting/__tests__/creditorImport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCreditorsCsv } from '../creditorImport';

describe('parseCreditorsCsv', () => {
  it('reads creditorName/creditorId columns in any order', () => {
    expect(parseCreditorsCsv('creditorId,creditorName\n70001,Bank A\n70002,"Amt, Stadt"\n')).toEqual({
      rows: [
        { kreditorNumber: 70001, name: 'Bank A' },
        { kreditorNumber: 70002, name: 'Amt, Stadt' },
      ],
      errors: [],
    });
  });

  it('reports missing headers, bad numbers, empty names and duplicates', () => {
    expect(parseCreditorsCsv('name,id\n1,x').errors).toEqual(['Kopfzeile braucht creditorName und creditorId']);
    expect(parseCreditorsCsv('creditorName,creditorId\nA,123\n,70002\nB,70003\nC,70003').errors).toEqual([
      'Zeile 2: Kreditornummer 123 außerhalb 70000–99999',
      'Zeile 3: Name fehlt',
      'Zeile 5: Kreditornummer 70003 doppelt',
    ]);
  });
});
```

- [ ] **Step 2: Write the failing router tests** in `src/server/routers/__tests__/suppliers.test.ts`.

```ts
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { adminCaller, initLedgerModels, resetLedgerDb, skipIfNoDb } from './helpers/ledgerFixtures';

beforeAll(async () => {
  await initLedgerModels();
});

beforeEach(async () => {
  await resetLedgerDb();
  await Supplier.deleteMany({});
  await Counter.deleteMany({ _id: 'supplier' });
});

describe('suppliers', () => {
  it('create allocates Kreditor numbers from 70000 and validates the default account', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const a = await caller.suppliers.create({ name: 'A', defaultAccount: '6855', defaultVatRate: 0 });
    const b = await caller.suppliers.create({ name: 'B' });
    expect([a.kreditorNumber, b.kreditorNumber]).toEqual([70000, 70001]);
    await expect(caller.suppliers.create({ name: 'C', defaultAccount: '9999' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('update normalises IBANs and archive hides from list', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const s = await caller.suppliers.create({ name: 'A' });
    const updated = await caller.suppliers.update({ id: String(s._id), ibans: ['de02 1203 0000 0000 2020 51'] });
    expect(updated.ibans).toEqual(['DE02120300000000202051']);
    await caller.suppliers.setArchived({ id: String(s._id), archived: true });
    expect(await caller.suppliers.list()).toHaveLength(0);
    expect(await caller.suppliers.list({ includeArchived: true })).toHaveLength(1);
  });

  it('importCreditors: dry run writes nothing; apply creates missing and raises the counter', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const csv = 'creditorName,creditorId\nBank A,70001\nAmt B,70009\n';
    const dry = await caller.admin.importCreditors({ csv });
    expect(dry).toEqual({ rows: 2, created: 2, existing: 0, errors: [] });
    expect(await Supplier.countDocuments()).toBe(0);
    await caller.admin.importCreditors({ csv, dryRun: false });
    const again = await caller.admin.importCreditors({ csv, dryRun: false });
    expect(again).toMatchObject({ created: 0, existing: 2 });
    const next = await caller.suppliers.create({ name: 'Neu' });
    expect(next.kreditorNumber).toBe(70010);
  });

  it('importCreditors with errors writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const res = await adminCaller().admin.importCreditors({ csv: 'creditorName,creditorId\n,70001', dryRun: false });
    expect(res.errors).toHaveLength(1);
    expect(await Supplier.countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/server/lib/accounting/__tests__/suggest.test.ts src/server/lib/accounting/__tests__/creditorImport.test.ts src/server/routers/__tests__/suppliers.test.ts`

Expected: FAIL (modules missing).

- [ ] **Step 4: Implement.**

`src/server/models/Supplier.ts`:

```ts
import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const supplierSchema = new Schema(
  {
    kreditorNumber: { type: Number, required: true, unique: true, min: 70000, max: 99999 },
    name: { type: String, required: true },
    ibans: { type: [String], required: true, default: [] },
    namePatterns: { type: [String], required: true, default: [] },
    purposePatterns: { type: [String], required: true, default: [] },
    defaultAccount: { type: String },
    defaultVatRate: { type: Number },
    defaultMode: { type: String, enum: ['normal', 'vatOnly'], required: true, default: 'normal' },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type SupplierDoc = InferSchemaType<typeof supplierSchema> & { _id: mongoose.Types.ObjectId };

export const Supplier =
  (mongoose.models.Supplier as mongoose.Model<SupplierDoc> | undefined) ??
  mongoose.model<SupplierDoc>('Supplier', supplierSchema);
```

`src/server/lib/accounting/suggest.ts`:

```ts
import type { BankBookingMode } from './postingRules';

export interface SuggestTx {
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
}

export interface SuggestSupplier {
  _id: unknown;
  kreditorNumber: number;
  name: string;
  ibans: string[];
  namePatterns: string[];
  purposePatterns: string[];
  defaultAccount?: string | null;
  defaultVatRate?: number | null;
  defaultMode?: string | null;
  archived?: boolean | null;
}

export interface Suggestion {
  supplierId: string;
  kreditorNumber: number;
  supplierName: string;
  account?: string;
  vatRate?: number;
  mode: BankBookingMode;
  matchedBy: 'iban' | 'purpose' | 'name';
}

export function normalizeIban(s: string): string {
  return s.replace(/\s+/g, '').toUpperCase();
}

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function containsAny(haystack: string, patterns: string[]): boolean {
  return patterns.some((p) => norm(p) !== '' && haystack.includes(norm(p)));
}

/** Rule match for one bank transaction: IBAN → Verwendungszweck pattern → name pattern. */
export function suggest(tx: SuggestTx, suppliers: SuggestSupplier[]): Suggestion | null {
  const active = suppliers
    .filter((s) => !s.archived)
    .sort((a, b) => a.kreditorNumber - b.kreditorNumber);
  const iban = tx.counterpartyIban ? normalizeIban(tx.counterpartyIban) : '';
  const purpose = norm(tx.description);
  const name = norm(tx.counterpartyName);

  const checks: [Suggestion['matchedBy'], (s: SuggestSupplier) => boolean][] = [
    ['iban', (s) => iban !== '' && s.ibans.some((i) => normalizeIban(i) === iban)],
    ['purpose', (s) => containsAny(purpose, s.purposePatterns)],
    ['name', (s) => name !== '' && containsAny(name, s.namePatterns)],
  ];
  for (const [matchedBy, test] of checks) {
    const hit = active.find(test);
    if (hit) {
      return {
        supplierId: String(hit._id),
        kreditorNumber: hit.kreditorNumber,
        supplierName: hit.name,
        account: hit.defaultAccount ?? undefined,
        vatRate: hit.defaultVatRate ?? undefined,
        mode: hit.defaultMode === 'vatOnly' ? 'vatOnly' : 'normal',
        matchedBy,
      };
    }
  }
  return null;
}
```

`src/server/lib/numbering.ts`, append:

```ts
const SUPPLIER_FLOOR = 69999; // first allocated Kreditor number is 70000

/** Raise the supplier counter so the next allocation is above `atLeast`. */
export async function raiseSupplierCounter(atLeast: number): Promise<void> {
  await Counter.updateOne(
    { _id: 'supplier' },
    { $max: { seq: Math.max(atLeast, SUPPLIER_FLOOR) } },
    { upsert: true },
  );
}

/** Next Kreditor number (70000–99999), atomic. */
export async function allocateSupplierNumber(): Promise<number> {
  await raiseSupplierCounter(SUPPLIER_FLOOR);
  const doc = await Counter.findOneAndUpdate(
    { _id: 'supplier' },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  const seq = doc?.seq ?? SUPPLIER_FLOOR + 1;
  if (seq > 99999) throw new Error('Kreditornummern erschöpft (max. 99999)');
  return seq;
}
```

`src/server/lib/accounting/creditorImport.ts`:

```ts
import { parseCsv } from '../sheetImport';
import { Supplier } from '../../models/Supplier';
import { raiseSupplierCounter } from '../numbering';

export interface CreditorRow {
  kreditorNumber: number;
  name: string;
}

/** Sheet export `creditorName,creditorId` (any column order) → rows + German errors. */
export function parseCreditorsCsv(csv: string): { rows: CreditorRow[]; errors: string[] } {
  const [header, ...data] = parseCsv(csv);
  const nameCol = header?.findIndex((h) => h.trim() === 'creditorName') ?? -1;
  const idCol = header?.findIndex((h) => h.trim() === 'creditorId') ?? -1;
  if (nameCol < 0 || idCol < 0) return { rows: [], errors: ['Kopfzeile braucht creditorName und creditorId'] };

  const rows: CreditorRow[] = [];
  const errors: string[] = [];
  const seen = new Set<number>();
  data.forEach((r, i) => {
    const line = i + 2;
    const name = (r[nameCol] ?? '').trim();
    const raw = (r[idCol] ?? '').trim();
    const kreditorNumber = Number(raw);
    if (!Number.isInteger(kreditorNumber) || kreditorNumber < 70000 || kreditorNumber > 99999) {
      errors.push(`Zeile ${line}: Kreditornummer ${raw} außerhalb 70000–99999`);
      return;
    }
    if (!name) {
      errors.push(`Zeile ${line}: Name fehlt`);
      return;
    }
    if (seen.has(kreditorNumber)) {
      errors.push(`Zeile ${line}: Kreditornummer ${kreditorNumber} doppelt`);
      return;
    }
    seen.add(kreditorNumber);
    rows.push({ kreditorNumber, name });
  });
  return { rows, errors };
}

/** Create missing suppliers by Kreditor number; existing ones are left untouched (renames survive). */
export async function applyCreditorImport(
  rows: CreditorRow[],
  dryRun: boolean,
): Promise<{ created: number; existing: number }> {
  const existingNumbers = new Set(
    (await Supplier.find({ kreditorNumber: { $in: rows.map((r) => r.kreditorNumber) } }).select('kreditorNumber')).map(
      (s) => s.kreditorNumber,
    ),
  );
  const missing = rows.filter((r) => !existingNumbers.has(r.kreditorNumber));
  if (!dryRun) {
    for (const r of missing) await Supplier.create({ kreditorNumber: r.kreditorNumber, name: r.name });
    if (rows.length > 0) await raiseSupplierCounter(Math.max(...rows.map((r) => r.kreditorNumber)));
  }
  return { created: missing.length, existing: rows.length - missing.length };
}
```

`src/server/routers/suppliers.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Supplier } from '../models/Supplier';
import { Account } from '../models/Account';
import { allocateSupplierNumber } from '../lib/numbering';
import { normalizeIban } from '../lib/accounting/suggest';
import { BANK_VAT_RATES } from '../lib/accounting/postingRules';

const fields = z.object({
  name: z.string().trim().min(1),
  ibans: z.array(z.string()).optional(),
  namePatterns: z.array(z.string()).optional(),
  purposePatterns: z.array(z.string()).optional(),
  defaultAccount: z.string().regex(/^\d{4,5}$/).nullable().optional(),
  defaultVatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)).nullable().optional(),
  defaultMode: z.enum(['normal', 'vatOnly']).optional(),
});

function clean(list: string[] | undefined, fn: (s: string) => string = (s) => s.trim()): string[] | undefined {
  return list?.map(fn).filter((s) => s !== '');
}

async function assertAccount(account: string | null | undefined): Promise<void> {
  if (account && !(await Account.exists({ number: account, archived: false }))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unbekanntes oder archiviertes Konto: ${account}` });
  }
}

export const suppliersRouter = router({
  list: adminProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) =>
      Supplier.find(input?.includeArchived ? {} : { archived: false }).sort({ kreditorNumber: 1 }),
    ),

  create: adminProcedure.input(fields).mutation(async ({ input }) => {
    await assertAccount(input.defaultAccount);
    return Supplier.create({
      ...input,
      ibans: clean(input.ibans, normalizeIban) ?? [],
      namePatterns: clean(input.namePatterns) ?? [],
      purposePatterns: clean(input.purposePatterns) ?? [],
      kreditorNumber: await allocateSupplierNumber(),
    });
  }),

  update: adminProcedure
    .input(fields.partial().extend({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      await assertAccount(patch.defaultAccount);
      const supplier = await Supplier.findById(id);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kreditor nicht gefunden' });
      if (patch.name !== undefined) supplier.name = patch.name;
      if (patch.ibans !== undefined) supplier.ibans = clean(patch.ibans, normalizeIban) ?? [];
      if (patch.namePatterns !== undefined) supplier.namePatterns = clean(patch.namePatterns) ?? [];
      if (patch.purposePatterns !== undefined) supplier.purposePatterns = clean(patch.purposePatterns) ?? [];
      if (patch.defaultAccount !== undefined) supplier.defaultAccount = patch.defaultAccount ?? undefined;
      if (patch.defaultVatRate !== undefined) supplier.defaultVatRate = patch.defaultVatRate ?? undefined;
      if (patch.defaultMode !== undefined) supplier.defaultMode = patch.defaultMode;
      await supplier.save();
      return supplier;
    }),

  setArchived: adminProcedure
    .input(z.object({ id: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const supplier = await Supplier.findById(input.id);
      if (!supplier) throw new TRPCError({ code: 'NOT_FOUND', message: 'Kreditor nicht gefunden' });
      supplier.archived = input.archived;
      await supplier.save();
      return supplier;
    }),
});
```

`admin.ts`: import `parseCreditorsCsv` and `applyCreditorImport`, then add:

```ts
  /** One-off import of the Sheet's creditor list (CSV export). Dry run by default; errors → nothing written. */
  importCreditors: adminProcedure
    .input(z.object({ csv: z.string().min(1), dryRun: z.boolean().default(true) }))
    .mutation(async ({ input }) => {
      const { rows, errors } = parseCreditorsCsv(input.csv);
      if (errors.length > 0) return { rows: rows.length, created: 0, existing: 0, errors };
      const res = await applyCreditorImport(rows, input.dryRun);
      return { rows: rows.length, ...res, errors };
    }),
```

`trpc.ts`: mount `suppliers: suppliersRouter`.

- [ ] **Step 5: Run the tests and verify they pass.** Use the Step 3 command, then `npm run typecheck:server && npm run lint`. Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/server
git commit -m "feat(ledger): suppliers with booking rules, suggestion engine and creditor import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Booking bank transactions (service + bookings router)

**Files:**
- Create: `src/server/lib/accounting/bankBooking.ts`, `src/server/routers/bookings.ts`
- Modify: `src/server/routers/bank.ts` (assign guard), `src/server/trpc.ts`
- Test: `src/server/routers/__tests__/bookings.test.ts`

**Interfaces:**
- Consumes:
  - `bankPosting`, `BankBookingMode`, `PostingError` (Task 2).
  - `suggest`, `normalizeIban`, the `Supplier` model, `allocateSupplierNumber` (Task 3).
  - `post`, `reverse`, `findActiveBySource`, `LedgerError` (ledger.ts).
  - The `BankTransaction` fields from Task 1.
  - `FireflyClient.fetchBalance` and `readFireflyEnv` (Task 1 / existing).
- Produces:
  - `findCoverage(fireflyJournalId: string): Promise<{ kind: 'payment' | 'bank'; entryId: string } | null>`.
  - `defaultBookingText(tx: { counterpartyName?: string | null; description: string }, supplierName?: string): string`.
  - `class BookingError extends Error { code: 'NOT_FOUND' | 'MATCHED' | 'ALREADY_BOOKED' | 'NOT_BOOKED' | 'SUPPLIER_NOT_FOUND' }`.
  - `interface BookBankInput { bankTxId: string; account: string; vatRate: number; mode: BankBookingMode; supplierId?: string; text?: string; rememberRule?: boolean; receipt?: { driveFileId: string; fileName: string; link: string } | null; receiptMissingReason?: string | null; createdBy: string }`.
  - `bookBankTransaction(input: BookBankInput)` → `{ entry, tx }`.
  - `unbookBankTransaction(bankTxId: string, reason: string, createdBy: string)` → `{ reversal }`.
  - tRPC `bookings.inbox({ year })` → `InboxRow[]`, where `InboxRow = { id, fireflyJournalId, date, direction, amountCents, counterpartyName, counterpartyIban, description, ignored, receipt, receiptMissingReason, suggestion: Suggestion | null }`.
  - tRPC `bookings.booked({ year })` → `BookedRow[]`, where `BookedRow = InboxRow minus suggestion, plus { entryId, entryNumber, lines, supplierName }`.
  - tRPC `bookings.stats({ year })` → `{ open, booked, missingReceipts }`.
  - tRPC `bookings.book(input)`, `bookings.bookBulk({ bankTxIds })` → `{ bankTxId, ok, entryNumber?, error? }[]`, `bookings.unbook({ bankTxId, reason })`, `bookings.setReceipt({ bankTxId, receipt, receiptMissingReason })`.
  - tRPC `bookings.balanceCheck({ year })` → `{ asOf, ledgerCents, bankCents: number | null, diffCents: number | null, error?: string }`.

- [ ] **Step 1: Write the failing tests** in `src/server/routers/__tests__/bookings.test.ts`.

```ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { Supplier } from '../../models/Supplier';
import { Counter } from '../../models/Counter';
import { trialBalance } from '../../lib/accounting/balances';
import { defaultBookingText } from '../../lib/accounting/bankBooking';
import { adminCaller, initLedgerModels, resetLedgerDb, sentInvoice, skipIfNoDb } from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({ enqueueFileInvoice: vi.fn(async () => {}) }));

let seq = 0;
async function tx(over: Record<string, unknown> = {}) {
  seq += 1;
  return BankTransaction.create({
    fireflyJournalId: `${900 + seq}:0`,
    date: new Date(2026, 0, 30),
    amountCents: 11900,
    description: 'Lizenz Januar',
    counterpartyName: 'Software Ltd',
    direction: 'out',
    ...over,
  });
}

beforeAll(async () => {
  await initLedgerModels();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await resetLedgerDb();
  await Supplier.deleteMany({});
  await Counter.deleteMany({ _id: 'supplier' });
});

describe('defaultBookingText', () => {
  it('prefers the supplier name and trims to 200 chars', () => {
    expect(defaultBookingText({ counterpartyName: 'X', description: 'Rechnung 1' }, 'Lieferant')).toBe('Lieferant · Rechnung 1');
    expect(defaultBookingText({ description: 'a'.repeat(300) })).toHaveLength(200);
  });
});

describe('bookings', () => {
  it('book posts Aufwand + Vorsteuer an Bank and removes the tx from the inbox', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(t._id)]);
    const res = await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0.19, mode: 'normal' });
    expect(res.entryNumber).toMatch(/^2026-\d{5}$/);
    expect(await caller.bookings.inbox({ year: 2026 })).toEqual([]);
    const booked = await caller.bookings.booked({ year: 2026 });
    expect(booked).toHaveLength(1);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(-11900);
    expect(tb.rows.find((r) => r.account === '1406')?.balanceCents).toBe(1900);
  });

  it('refuses double booking, booking an invoice-matched tx, and assigning a booked tx to an invoice', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx({ direction: 'in', description: 'Erstattung' });
    await caller.bookings.book({ bankTxId: String(t._id), account: '4930', vatRate: 0, mode: 'normal' });
    await expect(
      caller.bookings.book({ bankTxId: String(t._id), account: '4930', vatRate: 0, mode: 'normal' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const invoice = await sentInvoice(caller);
    await expect(
      caller.bank.assign({ bankTxId: String(t._id), invoiceId: String(invoice._id) }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const paid = await tx({ direction: 'in', amountCents: invoice.totals.grossCents });
    await caller.bank.assign({ bankTxId: String(paid._id), invoiceId: String(invoice._id) });
    await expect(
      caller.bookings.book({ bankTxId: String(paid._id), account: '4930', vatRate: 0, mode: 'normal' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('inbox includes deposits ignored in Bankabgleich and excludes covered invoice payments', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const ignored = await tx({ direction: 'in', ignored: true, description: 'Steuererstattung' });
    const ids = (await caller.bookings.inbox({ year: 2026 })).map((r) => r.id);
    expect(ids).toContain(String(ignored._id));
  });

  it('rememberRule creates a supplier that suggests the same booking next time', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const first = await tx({ counterpartyIban: 'IE29 AIBK 9311 5212 3456 78' });
    await caller.bookings.book({ bankTxId: String(first._id), account: '6837', vatRate: 0, mode: 'normal', rememberRule: true });
    const supplier = await Supplier.findOne({});
    expect(supplier).toMatchObject({ kreditorNumber: 70000, name: 'Software Ltd', defaultAccount: '6837', defaultVatRate: 0 });
    expect(supplier?.ibans).toEqual(['IE29AIBK93115212345678']);
    await tx({ counterpartyIban: 'IE29AIBK93115212345678', date: new Date(2026, 1, 28) });
    const [row] = await caller.bookings.inbox({ year: 2026 });
    expect(row.suggestion).toMatchObject({ kreditorNumber: 70000, account: '6837', matchedBy: 'iban' });
  });

  it('bookBulk books items with a suggestion and reports the others without stopping', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.suppliers.create({ name: 'Bank', purposePatterns: ['Abrechnung vom'], defaultAccount: '6855', defaultVatRate: 0 });
    const a = await tx({ description: 'Abrechnung vom 29.01.2026', amountCents: 824 });
    const b = await tx({ description: 'Abrechnung vom 27.02.2026', amountCents: 824, date: new Date(2026, 1, 28) });
    const c = await tx({ description: 'Unbekannt' });
    const results = await caller.bookings.bookBulk({ bankTxIds: [String(a._id), String(c._id), String(b._id)] });
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(results[1].error).toMatch(/Kein Vorschlag/);
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(c._id)]);
  });

  it('unbook reverses the entry and returns the tx to the inbox; setReceipt stores metadata', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    await caller.bookings.book({
      bankTxId: String(t._id),
      account: '6837',
      vatRate: 0.19,
      mode: 'normal',
      receipt: { driveFileId: 'f1', fileName: '20260130 - Lizenz.pdf', link: 'https://drive/f1' },
    });
    expect((await caller.bookings.stats({ year: 2026 })).missingReceipts).toBe(0);
    await caller.bookings.setReceipt({ bankTxId: String(t._id), receipt: null, receiptMissingReason: 'Eigenbeleg folgt' });
    expect((await BankTransaction.findById(t._id))?.receiptMissingReason).toBe('Eigenbeleg folgt');
    await caller.bookings.unbook({ bankTxId: String(t._id), reason: 'falsches Konto' });
    expect((await caller.bookings.inbox({ year: 2026 })).map((r) => r.id)).toEqual([String(t._id)]);
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.every((r) => r.balanceCents === 0)).toBe(true);
  });

  it('stats counts open, booked and missing receipts', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    await tx();
    await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0, mode: 'normal' });
    expect(await caller.bookings.stats({ year: 2026 })).toEqual({ open: 1, booked: 1, missingReceipts: 1 });
  });

  it('balanceCheck reports the ledger 1800 balance and an error when Firefly is not configured', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const t = await tx();
    await caller.bookings.book({ bankTxId: String(t._id), account: '6837', vatRate: 0, mode: 'normal' });
    const res = await caller.bookings.balanceCheck({ year: 2026 });
    expect(res.ledgerCents).toBe(-11900);
    expect(res.bankCents).toBeNull();
    expect(res.error).toMatch(/Firefly/);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/server/routers/__tests__/bookings.test.ts`

Expected: FAIL (`bookings` router missing).

- [ ] **Step 3: Implement `src/server/lib/accounting/bankBooking.ts`.**

```ts
import { BankTransaction } from '../../models/BankTransaction';
import { Supplier } from '../../models/Supplier';
import { allocateSupplierNumber } from '../numbering';
import { findActiveBySource, post, reverse } from './ledger';
import { bankPosting, type BankBookingMode } from './postingRules';
import { normalizeIban } from './suggest';

export type BookingErrorCode = 'NOT_FOUND' | 'MATCHED' | 'ALREADY_BOOKED' | 'NOT_BOOKED' | 'SUPPLIER_NOT_FOUND';

export class BookingError extends Error {
  readonly code: BookingErrorCode;
  constructor(code: BookingErrorCode, message: string) {
    super(message);
    this.name = 'BookingError';
    this.code = code;
  }
}

/** Coverage rule: an active invoice payment or an active inbox booking. */
export async function findCoverage(
  fireflyJournalId: string,
): Promise<{ kind: 'payment' | 'bank'; entryId: string } | null> {
  const payment = await findActiveBySource('payment', `bank:${fireflyJournalId}`);
  if (payment) return { kind: 'payment', entryId: String(payment._id) };
  const bank = await findActiveBySource('bank', fireflyJournalId);
  if (bank) return { kind: 'bank', entryId: String(bank._id) };
  return null;
}

export function defaultBookingText(
  tx: { counterpartyName?: string | null; description: string },
  supplierName?: string,
): string {
  const who = supplierName ?? tx.counterpartyName ?? 'Bank';
  return `${who} · ${tx.description}`.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export interface BookBankInput {
  bankTxId: string;
  account: string;
  vatRate: number;
  mode: BankBookingMode;
  supplierId?: string;
  text?: string;
  rememberRule?: boolean;
  receipt?: { driveFileId: string; fileName: string; link: string } | null;
  receiptMissingReason?: string | null;
  createdBy: string;
}

export async function bookBankTransaction(input: BookBankInput) {
  const tx = await BankTransaction.findById(input.bankTxId);
  if (!tx) throw new BookingError('NOT_FOUND', 'Banktransaktion nicht gefunden');
  if (tx.matchedInvoiceId) {
    throw new BookingError('MATCHED', 'Transaktion ist einer Rechnung zugeordnet — Zahlung dort lösen');
  }
  if (await findCoverage(tx.fireflyJournalId)) {
    throw new BookingError('ALREADY_BOOKED', 'Transaktion ist bereits gebucht');
  }
  let supplier = input.supplierId ? await Supplier.findById(input.supplierId) : null;
  if (input.supplierId && !supplier) throw new BookingError('SUPPLIER_NOT_FOUND', 'Kreditor nicht gefunden');

  const lines = bankPosting({
    direction: tx.direction === 'out' ? 'out' : 'in',
    grossCents: tx.amountCents,
    account: input.account,
    vatRate: input.vatRate,
    mode: input.mode,
  });
  const entry = await post({
    date: tx.date,
    text: input.text?.trim() || defaultBookingText(tx, supplier?.name),
    lines,
    source: { kind: 'bank', refId: tx.fireflyJournalId },
    createdBy: input.createdBy,
  });

  if (input.rememberRule) supplier = await rememberRule(tx, input, supplier);
  if (supplier) tx.supplierId = supplier._id;
  if (input.receipt !== undefined) tx.receipt = input.receipt ?? undefined;
  if (input.receiptMissingReason !== undefined) tx.receiptMissingReason = input.receiptMissingReason ?? undefined;
  await tx.save();
  return { entry, tx };
}

/** Create or extend a supplier so the next matching transaction gets the same suggestion. */
async function rememberRule(
  tx: { counterpartyName?: string | null; counterpartyIban?: string | null; description: string },
  input: Pick<BookBankInput, 'account' | 'vatRate' | 'mode'>,
  supplier: Awaited<ReturnType<typeof Supplier.findById>>,
) {
  const s =
    supplier ??
    new Supplier({
      kreditorNumber: await allocateSupplierNumber(),
      name: tx.counterpartyName?.trim() || tx.description.slice(0, 60),
    });
  const iban = tx.counterpartyIban ? normalizeIban(tx.counterpartyIban) : '';
  if (iban) {
    if (!s.ibans.includes(iban)) s.ibans.push(iban);
  } else if (tx.counterpartyName?.trim()) {
    if (!s.namePatterns.includes(tx.counterpartyName.trim())) s.namePatterns.push(tx.counterpartyName.trim());
  } else {
    const pattern = tx.description.slice(0, 40).trim();
    if (pattern && !s.purposePatterns.includes(pattern)) s.purposePatterns.push(pattern);
  }
  if (input.mode === 'normal') s.defaultAccount = input.account;
  s.defaultVatRate = input.vatRate;
  s.defaultMode = input.mode;
  await s.save();
  return s;
}

export async function unbookBankTransaction(bankTxId: string, reason: string, createdBy: string) {
  const tx = await BankTransaction.findById(bankTxId);
  if (!tx) throw new BookingError('NOT_FOUND', 'Banktransaktion nicht gefunden');
  const coverage = await findCoverage(tx.fireflyJournalId);
  if (coverage?.kind !== 'bank') throw new BookingError('NOT_BOOKED', 'Transaktion ist nicht im Buchen-Eingang gebucht');
  const { reversal } = await reverse(coverage.entryId, { reason, createdBy });
  return { reversal };
}
```

- [ ] **Step 4: Implement `src/server/routers/bookings.ts`.**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { BankTransaction } from '../models/BankTransaction';
import { JournalEntry } from '../models/JournalEntry';
import { Supplier } from '../models/Supplier';
import { BookingError, bookBankTransaction, unbookBankTransaction } from '../lib/accounting/bankBooking';
import { BANK_VAT_RATES, PostingError } from '../lib/accounting/postingRules';
import { LedgerError } from '../lib/accounting/ledger';
import { suggest } from '../lib/accounting/suggest';
import { FireflyClient } from '../services/FireflyClient';
import { readFireflyEnv } from '../lib/fireflyEnv';

const yearInput = z.object({ year: z.number().int().min(2000).max(2100) });
const receiptInput = z.object({ driveFileId: z.string().min(1), fileName: z.string().min(1), link: z.string().min(1) });

function yearRange(year: number) {
  return { $gte: new Date(year, 0, 1), $lt: new Date(year + 1, 0, 1) };
}

/** BookingError / LedgerError / PostingError → TRPCError with a German message. */
function toTrpc(err: unknown): never {
  if (err instanceof BookingError) {
    const code = err.code === 'NOT_FOUND' || err.code === 'SUPPLIER_NOT_FOUND' ? 'NOT_FOUND'
      : err.code === 'MATCHED' || err.code === 'ALREADY_BOOKED' ? 'CONFLICT' : 'BAD_REQUEST';
    throw new TRPCError({ code, message: err.message });
  }
  if (err instanceof LedgerError || err instanceof PostingError) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
  }
  throw err;
}

/** Active coverage per fireflyJournalId: 'payment' | 'bank' (+ entry). */
async function coverageMap(refIds: string[]) {
  const entries = await JournalEntry.find({
    active: true,
    $or: [
      { 'source.kind': 'bank', 'source.refId': { $in: refIds } },
      { 'source.kind': 'payment', 'source.refId': { $in: refIds.map((r) => `bank:${r}`) } },
    ],
  });
  const map = new Map<string, (typeof entries)[number]>();
  for (const e of entries) {
    const ref = e.source?.kind === 'payment' ? String(e.source.refId).slice('bank:'.length) : String(e.source?.refId);
    map.set(ref, e);
  }
  return map;
}

function row(tx: InstanceType<typeof BankTransaction>) {
  return {
    id: String(tx._id),
    fireflyJournalId: tx.fireflyJournalId,
    date: tx.date,
    direction: (tx.direction === 'out' ? 'out' : 'in') as 'in' | 'out',
    amountCents: tx.amountCents,
    counterpartyName: tx.counterpartyName ?? null,
    counterpartyIban: tx.counterpartyIban ?? null,
    description: tx.description,
    ignored: !!tx.ignored,
    receipt: tx.receipt ?? null,
    receiptMissingReason: tx.receiptMissingReason ?? null,
  };
}

async function loadYear(year: number) {
  const txs = await BankTransaction.find({ date: yearRange(year) }).sort({ date: 1, fireflyJournalId: 1 });
  const coverage = await coverageMap(txs.map((t) => t.fireflyJournalId));
  return { txs, coverage };
}

const bookFields = {
  account: z.string(),
  vatRate: z.number().refine((r) => (BANK_VAT_RATES as readonly number[]).includes(r)),
  mode: z.enum(['normal', 'vatOnly']),
  supplierId: z.string().optional(),
  text: z.string().max(200).optional(),
  rememberRule: z.boolean().optional(),
  receipt: receiptInput.nullable().optional(),
  receiptMissingReason: z.string().max(200).nullable().optional(),
};

export const bookingsRouter = router({
  inbox: adminProcedure.input(yearInput).query(async ({ input }) => {
    const [{ txs, coverage }, suppliers] = await Promise.all([loadYear(input.year), Supplier.find({ archived: false })]);
    return txs
      .filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId))
      .map((t) => ({ ...row(t), suggestion: suggest(t, suppliers) }));
  }),

  booked: adminProcedure.input(yearInput).query(async ({ input }) => {
    const { txs, coverage } = await loadYear(input.year);
    const supplierIds = txs.map((t) => t.supplierId).filter(Boolean);
    const names = new Map((await Supplier.find({ _id: { $in: supplierIds } })).map((s) => [String(s._id), s.name]));
    return txs
      .filter((t) => coverage.get(t.fireflyJournalId)?.source?.kind === 'bank')
      .map((t) => {
        const e = coverage.get(t.fireflyJournalId)!;
        return {
          ...row(t),
          entryId: String(e._id),
          entryNumber: e.entryNumber,
          lines: e.lines.map((l) => ({ account: l.account, debitCents: l.debitCents, creditCents: l.creditCents })),
          supplierName: t.supplierId ? (names.get(String(t.supplierId)) ?? null) : null,
        };
      })
      .reverse();
  }),

  stats: adminProcedure.input(yearInput).query(async ({ input }) => {
    const { txs, coverage } = await loadYear(input.year);
    const bankBooked = txs.filter((t) => coverage.get(t.fireflyJournalId)?.source?.kind === 'bank');
    return {
      open: txs.filter((t) => !t.matchedInvoiceId && !coverage.has(t.fireflyJournalId)).length,
      booked: bankBooked.length,
      missingReceipts: bankBooked.filter((t) => !t.receipt?.driveFileId && !t.receiptMissingReason).length,
    };
  }),

  book: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1), ...bookFields }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { entry } = await bookBankTransaction({ ...input, createdBy: ctx.user.sub });
        return { entryNumber: entry.entryNumber, entryId: String(entry._id) };
      } catch (err) {
        toTrpc(err);
      }
    }),

  bookBulk: adminProcedure
    .input(z.object({ bankTxIds: z.array(z.string().min(1)).min(1).max(200) }))
    .mutation(async ({ input, ctx }) => {
      const suppliers = await Supplier.find({ archived: false });
      const results: { bankTxId: string; ok: boolean; entryNumber?: string; error?: string }[] = [];
      for (const bankTxId of input.bankTxIds) {
        const tx = await BankTransaction.findById(bankTxId);
        const s = tx ? suggest(tx, suppliers) : null;
        if (!tx || !s || (s.mode === 'normal' && !s.account) || s.vatRate === undefined) {
          results.push({ bankTxId, ok: false, error: 'Kein Vorschlag — bitte einzeln buchen' });
          continue;
        }
        try {
          const { entry } = await bookBankTransaction({
            bankTxId,
            account: s.account ?? '',
            vatRate: s.vatRate,
            mode: s.mode,
            supplierId: s.supplierId,
            createdBy: ctx.user.sub,
          });
          results.push({ bankTxId, ok: true, entryNumber: entry.entryNumber });
        } catch (err) {
          results.push({ bankTxId, ok: false, error: (err as Error).message });
        }
      }
      return results;
    }),

  unbook: adminProcedure
    .input(z.object({ bankTxId: z.string().min(1), reason: z.string().trim().min(1) }))
    .mutation(async ({ input, ctx }) => {
      try {
        const { reversal } = await unbookBankTransaction(input.bankTxId, input.reason, ctx.user.sub);
        return { reversalNumber: reversal.entryNumber };
      } catch (err) {
        toTrpc(err);
      }
    }),

  setReceipt: adminProcedure
    .input(
      z.object({
        bankTxId: z.string().min(1),
        receipt: receiptInput.nullable(),
        receiptMissingReason: z.string().max(200).nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const tx = await BankTransaction.findById(input.bankTxId);
      if (!tx) throw new TRPCError({ code: 'NOT_FOUND', message: 'Banktransaktion nicht gefunden' });
      tx.receipt = input.receipt ?? undefined;
      if (input.receiptMissingReason !== undefined) tx.receiptMissingReason = input.receiptMissingReason ?? undefined;
      await tx.save();
      return row(tx);
    }),

  balanceCheck: adminProcedure.input(yearInput).query(async ({ input }) => {
    const entries = await JournalEntry.find({ fiscalYear: input.year, 'lines.account': '1800' }).select('lines');
    const ledgerCents = entries
      .flatMap((e) => e.lines)
      .filter((l) => l.account === '1800')
      .reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    const endOfYear = new Date(input.year, 11, 31);
    const asOf = new Date() < endOfYear ? new Date() : endOfYear;
    try {
      const { baseUrl, pat, glsAccountId } = readFireflyEnv();
      const bankCents = await new FireflyClient({ baseUrl, pat, glsAccountId }).fetchBalance(asOf);
      return { asOf, ledgerCents, bankCents, diffCents: ledgerCents - bankCents };
    } catch (err) {
      return { asOf, ledgerCents, bankCents: null, diffCents: null, error: (err as Error).message };
    }
  }),
});
```

> If TypeScript rejects `InstanceType<typeof BankTransaction>`, type `row` with `HydratedDocument<BankTransactionDoc>` from mongoose, as `reconcile.ts` does.

`trpc.ts`: mount `bookings: bookingsRouter`.

`bank.ts` `assign`: after loading `tx`, add the checks below (import `findActiveBySource` from `../lib/accounting/ledger`):

```ts
      if (tx.direction === 'out') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Ausgaben können keiner Rechnung zugeordnet werden' });
      }
      if (await findActiveBySource('bank', tx.fireflyJournalId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Transaktion ist bereits gebucht — erst die Buchung stornieren',
        });
      }
```

- [ ] **Step 5: Run the tests and verify they pass.** Use the Step 2 command, then `npm run typecheck:server && npm run lint && npm test`. Expected: all green and pristine.

- [ ] **Step 6: Commit.**

```bash
git add src/server
git commit -m "feat(ledger): book bank transactions from an inbox with rules, bulk confirm and balance check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Receipts from Drive

**Files:**
- Create: `src/server/lib/accounting/receipts.ts`, `src/server/services/receiptsDrive.ts`, `src/server/services/driveForUser.ts`, `src/server/routers/receipts.ts`
- Modify: `src/server/routers/admin.ts` (use `driveForUser`), `src/server/trpc.ts`, `.env.example`
- Test: `src/server/lib/accounting/__tests__/receipts.test.ts`, `src/server/services/__tests__/receiptsDrive.test.ts`

**Interfaces:**
- Consumes: `getGoogleAccessTokenForUser`, `createOAuth2Client` (existing), the `BankTransaction` model, the `Supplier` model.
- Produces:
  - `interface ReceiptFile { id: string; name: string; link: string }`.
  - `amountTokens(cents: number): string[]`.
  - `rankReceipts(files: ReceiptFile[], tx: { date: Date; amountCents: number; counterpartyName?: string | null }, supplierName?: string): (ReceiptFile & { score: number })[]`.
  - `interface DriveFilesLike { files: { list(params: { q: string; fields?: string; spaces?: string; pageSize?: number }): Promise<{ data: { files?: { id?: string | null; name?: string | null; webViewLink?: string | null }[] | null } }> } }`.
  - `listReceiptFiles(drive: DriveFilesLike, rootFolderId: string, year: number): Promise<ReceiptFile[]>`.
  - `driveForUser(userId: string): Promise<DriveFilesLike>`.
  - tRPC `receipts.list({ year, bankTxId? })` → `(ReceiptFile & { score: number })[]`.

- [ ] **Step 1: Write the failing tests.**

`src/server/lib/accounting/__tests__/receipts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { amountTokens, rankReceipts } from '../receipts';

const f = (name: string) => ({ id: name, name, link: `https://drive/${name}` });

describe('amountTokens', () => {
  it('renders German and dotted forms incl. thousands', () => {
    expect(amountTokens(123456)).toEqual(['1234,56', '1234.56', '1.234,56']);
    expect(amountTokens(824)).toEqual(['8,24', '8.24']);
  });
});

describe('rankReceipts', () => {
  const tx = { date: new Date(2026, 0, 30), amountCents: 11900, counterpartyName: 'Software Ltd' };

  it('ranks amount, date proximity and name tokens', () => {
    const ranked = rankReceipts(
      [f('20250105 - Other.pdf'), f('20260129 - 70003 - Software - Lizenz 119,00.pdf'), f('202601 - Software.pdf'), f('random.pdf')],
      tx,
    );
    expect(ranked.map((r) => r.name)).toEqual([
      '20260129 - 70003 - Software - Lizenz 119,00.pdf',
      '202601 - Software.pdf',
      '20250105 - Other.pdf',
      'random.pdf',
    ]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[3].score).toBe(0);
  });

  it('uses the supplier name when given', () => {
    const ranked = rankReceipts([f('a.pdf'), f('kammer beitrag.pdf')], { ...tx, counterpartyName: null }, 'Kammer');
    expect(ranked[0].name).toBe('kammer beitrag.pdf');
  });
});
```

`src/server/services/__tests__/receiptsDrive.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { listReceiptFiles } from '../receiptsDrive';

describe('listReceiptFiles', () => {
  it('finds the year subfolder and lists its PDFs', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: { files: [{ id: 'y2026', name: '2026' }] } })
      .mockResolvedValueOnce({ data: { files: [{ id: 'p1', name: 'a.pdf', webViewLink: 'https://drive/p1' }] } });
    const files = await listReceiptFiles({ files: { list } }, 'root', 2026);
    expect(files).toEqual([{ id: 'p1', name: 'a.pdf', link: 'https://drive/p1' }]);
    expect(list.mock.calls[0][0].q).toContain("'root' in parents");
    expect(list.mock.calls[0][0].q).toContain("name = '2026'");
    expect(list.mock.calls[1][0].q).toContain("'y2026' in parents");
    expect(list.mock.calls[1][0].q).toContain("mimeType = 'application/pdf'");
  });

  it('returns [] when the year folder does not exist', async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: { files: [] } });
    expect(await listReceiptFiles({ files: { list } }, 'root', 2027)).toEqual([]);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/server/lib/accounting/__tests__/receipts.test.ts src/server/services/__tests__/receiptsDrive.test.ts`

Expected: FAIL (modules missing).

- [ ] **Step 3: Implement.**

`src/server/lib/accounting/receipts.ts`:

```ts
export interface ReceiptFile {
  id: string;
  name: string;
  link: string;
}

export function amountTokens(cents: number): string[] {
  const euros = Math.floor(Math.abs(cents) / 100);
  const rest = String(Math.abs(cents) % 100).padStart(2, '0');
  const tokens = [`${euros},${rest}`, `${euros}.${rest}`];
  if (euros >= 1000) tokens.push(`${euros.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${rest}`);
  return tokens;
}

const DAY = 24 * 60 * 60 * 1000;

function dateScore(name: string, date: Date): number {
  const full = name.match(/(20\d{2})-?(\d{2})-?(\d{2})/);
  if (full) {
    const d = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
    return Math.abs(d.getTime() - date.getTime()) <= 10 * DAY ? 2 : 0;
  }
  const month = name.match(/(20\d{2})-?(\d{2})(?!\d)/);
  if (month) {
    return Number(month[1]) === date.getFullYear() && Number(month[2]) === date.getMonth() + 1 ? 1 : 0;
  }
  return 0;
}

function nameScore(fileName: string, who: string | null | undefined): number {
  const tokens = (who ?? '').toLowerCase().split(/[^a-z0-9äöüß]+/).filter((t) => t.length >= 3);
  const lower = fileName.toLowerCase();
  return Math.min(2, tokens.filter((t) => lower.includes(t)).length);
}

/** Best receipt candidates first: amount in name (+3), date ±10 days (+2) / same month (+1), name tokens (≤ +2). */
export function rankReceipts(
  files: ReceiptFile[],
  tx: { date: Date; amountCents: number; counterpartyName?: string | null },
  supplierName?: string,
): (ReceiptFile & { score: number })[] {
  const amounts = amountTokens(tx.amountCents);
  return files
    .map((f) => ({
      ...f,
      score:
        (amounts.some((a) => f.name.includes(a)) ? 3 : 0) +
        dateScore(f.name, tx.date) +
        nameScore(f.name, supplierName ?? tx.counterpartyName),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
```

`src/server/services/receiptsDrive.ts`:

```ts
import type { ReceiptFile } from '../lib/accounting/receipts';

export interface DriveFilesLike {
  files: {
    list(params: { q: string; fields?: string; spaces?: string; pageSize?: number }): Promise<{
      data: { files?: { id?: string | null; name?: string | null; webViewLink?: string | null }[] | null };
    }>;
  };
}

function q(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** PDFs in `<root>/<year>/` (the "überwiesen" folder layout). */
export async function listReceiptFiles(drive: DriveFilesLike, rootFolderId: string, year: number): Promise<ReceiptFile[]> {
  const folders = await drive.files.list({
    q: `${q(rootFolderId)} in parents and name = ${q(String(year))} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const yearFolder = folders.data.files?.[0]?.id;
  if (!yearFolder) return [];
  const res = await drive.files.list({
    q: `${q(yearFolder)} in parents and mimeType = 'application/pdf' and trashed = false`,
    fields: 'files(id, name, webViewLink)',
    spaces: 'drive',
    pageSize: 1000,
  });
  return (res.data.files ?? [])
    .filter((f) => f.id && f.name)
    .map((f) => ({ id: f.id!, name: f.name!, link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` }));
}
```

`src/server/services/driveForUser.ts`. This moves the body of `driveResolver` in `admin.ts` into a reusable helper:

```ts
import { google } from 'googleapis';
import { getGoogleAccessTokenForUser } from './AuthService';
import { createOAuth2Client } from './DriveService';
import type { DriveFilesLike } from './receiptsDrive';

/** Drive v3 client acting as the logged-in user (their stored refresh token). */
export async function driveForUser(userId: string): Promise<DriveFilesLike> {
  const { accessToken, refreshToken } = await getGoogleAccessTokenForUser(userId);
  const auth = createOAuth2Client(refreshToken);
  auth.setCredentials({ refresh_token: refreshToken, access_token: accessToken });
  return google.drive({ version: 'v3', auth }) as unknown as DriveFilesLike;
}
```

In `admin.ts`, `driveResolver` becomes:
`return createInvoicePdfFinder((await driveForUser(userId)) as unknown as DriveListLike, folderId);`
Drop the now-unused imports.

`src/server/routers/receipts.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { BankTransaction } from '../models/BankTransaction';
import { Supplier } from '../models/Supplier';
import { rankReceipts } from '../lib/accounting/receipts';
import { listReceiptFiles } from '../services/receiptsDrive';
import { driveForUser } from '../services/driveForUser';

export const receiptsRouter = router({
  list: adminProcedure
    .input(z.object({ year: z.number().int().min(2000).max(2100), bankTxId: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      const root = process.env.QUEEN_RECEIPTS_FOLDER_ID;
      if (!root) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'QUEEN_RECEIPTS_FOLDER_ID ist nicht gesetzt' });
      }
      let files;
      try {
        files = await listReceiptFiles(await driveForUser(ctx.user.sub), root, input.year);
      } catch (err) {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: `Drive nicht erreichbar: ${(err as Error).message}` });
      }
      const tx = input.bankTxId ? await BankTransaction.findById(input.bankTxId) : null;
      if (!tx) return files.map((f) => ({ ...f, score: 0 })).sort((a, b) => a.name.localeCompare(b.name));
      const supplier = tx.supplierId ? await Supplier.findById(tx.supplierId) : null;
      return rankReceipts(files, tx, supplier?.name);
    }),
});
```

`trpc.ts`: mount `receipts: receiptsRouter`.

`.env.example`: below `GOOGLE_DRIVE_INVOICES_FOLDER_ID` add:

```
# Drive folder with paid incoming invoices ("Eingangsrechnungen / überwiesen"); receipts are read from its <year>/ subfolders.
QUEEN_RECEIPTS_FOLDER_ID=
```

- [ ] **Step 4: Run the tests and verify they pass.** Use the Step 2 command, then `npm run typecheck:server && npm run lint && npm test`. Expected: PASS. The importSheet / linkDriveFiles tests must still pass after the `driveForUser` extraction.

- [ ] **Step 5: Commit.**

```bash
git add src/server .env.example
git commit -m "feat(ledger): list and rank Drive receipts for bank bookings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Buchen page — inbox, booking dialog, bulk confirm, booked list

**Files:**
- Create: `src/client/lib/bookingPreview.ts`, `src/client/components/BookingDialog.tsx`, `src/client/pages/BookingsPage.tsx`
- Modify: `src/client/main.tsx`, `src/client/components/Navigation.tsx`, `src/client/i18n/de.ts`, `src/client/i18n/en.ts`
- Test: `src/client/__tests__/bookingPreview.test.ts`, `src/client/__tests__/bookings-i18n.test.tsx`

**Interfaces:**
- Consumes:
  - tRPC `bookings.*` (Task 4), `receipts.list` (Task 5), `suppliers.list` (Task 3), `accounts.list` (Phase 1).
  - `bankPosting` and `PostingError` from `src/server/lib/accounting/postingRules.ts`. The client already imports server libs, e.g. `lineTotals.ts` imports `money.ts`.
  - `useLanguage` from `src/client/i18n/LanguageContext.tsx`, `useToast` from `src/client/components/Toast`, and `formatEUR` / `formatDate` from `src/client/lib/format.ts`.
- Produces:
  - `previewBankPosting(input: { direction: 'in'|'out'; amountCents: number; account: string; vatRate: number; mode: 'normal'|'vatOnly' }): { lines: { account: string; debitCents: number; creditCents: number }[]; error: string | null }`.
  - Route `/bookings`.
  - Nav item `nav.bookings` with a badge showing `bookings.stats.open` for the current year.

- [ ] **Step 1: Write the failing tests.**

`src/client/__tests__/bookingPreview.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { previewBankPosting } from '../lib/bookingPreview';

describe('previewBankPosting', () => {
  it('returns lines for a valid booking', () => {
    expect(previewBankPosting({ direction: 'out', amountCents: 11900, account: '6837', vatRate: 0.19, mode: 'normal' })).toEqual({
      lines: [
        { account: '1406', debitCents: 1900, creditCents: 0 },
        { account: '1800', debitCents: 0, creditCents: 11900 },
        { account: '6837', debitCents: 10000, creditCents: 0 },
      ],
      error: null,
    });
  });

  it('returns the error instead of throwing', () => {
    const res = previewBankPosting({ direction: 'out', amountCents: 100, account: '', vatRate: 0.19, mode: 'normal' });
    expect(res.lines).toEqual([]);
    expect(res.error).toMatch(/account/i);
  });
});
```

`src/client/__tests__/bookings-i18n.test.tsx`. Follow the pattern of `src/client/__tests__/ledger-i18n.test.tsx`: mock `../lib/trpc` with `useQuery` stubs for `bookings.inbox`, `bookings.booked`, `bookings.stats`, `bookings.balanceCheck`, `suppliers.list`, `accounts.list` and `receipts.list`, returning empty data; `useMutation` stubs return `{ mutateAsync: vi.fn(), isPending: false }`; and `useUtils` returns `{ bookings: { invalidate: vi.fn() }, invalidate: vi.fn() }`. Render `<BookingsPage />` inside `LanguageProvider` + `MemoryRouter`. Assert that the heading `Buchen` and the tab `Eingang` are shown, then click the `EN` switch from the Navigation pattern (or call the provider's `setLang` through a test helper the existing test uses) and assert `Book` and `Inbox`.

- [ ] **Step 2: Run the tests and verify they fail.**

Run: `NODE_ENV=development npx vitest run src/client/__tests__/bookingPreview.test.ts src/client/__tests__/bookings-i18n.test.tsx`

Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `src/client/lib/bookingPreview.ts`.**

```ts
import { bankPosting, type BankBookingMode, type PostingLine } from '../../server/lib/accounting/postingRules';

export function previewBankPosting(input: {
  direction: 'in' | 'out';
  amountCents: number;
  account: string;
  vatRate: number;
  mode: BankBookingMode;
}): { lines: PostingLine[]; error: string | null } {
  try {
    return {
      lines: bankPosting({ direction: input.direction, grossCents: input.amountCents, account: input.account, vatRate: input.vatRate, mode: input.mode }),
      error: null,
    };
  } catch (err) {
    return { lines: [], error: (err as Error).message };
  }
}
```

- [ ] **Step 4: Add i18n keys** to `de.ts`, and the same keys with English text to `en.ts`:

| key | de | en |
|---|---|---|
| `nav.bookings` | Buchen | Book |
| `bookings.title` | Buchen | Book |
| `bookings.sub` | Banktransaktionen ins Journal buchen | Book bank transactions into the journal |
| `bookings.tab.inbox` | Eingang | Inbox |
| `bookings.tab.booked` | Gebucht | Booked |
| `bookings.tab.suppliers` | Kreditoren | Suppliers |
| `bookings.balance.ledger` | Konto 1800 | Account 1800 |
| `bookings.balance.bank` | GLS laut Firefly | GLS per Firefly |
| `bookings.balance.diff` | Differenz | Difference |
| `bookings.balance.ok` | Bank und Buchhaltung stimmen überein | Bank and ledger agree |
| `bookings.balance.unavailable` | Bankstand nicht abrufbar | Bank balance unavailable |
| `bookings.open` | offen | open |
| `bookings.missingReceipts` | Belege fehlen | receipts missing |
| `bookings.col.date` | Datum | Date |
| `bookings.col.counterparty` | Gegenpartei | Counterparty |
| `bookings.col.purpose` | Verwendungszweck | Purpose |
| `bookings.col.amount` | Betrag | Amount |
| `bookings.col.suggestion` | Vorschlag | Suggestion |
| `bookings.col.entry` | Buchung | Entry |
| `bookings.col.receipt` | Beleg | Receipt |
| `bookings.noSuggestion` | kein Vorschlag | no suggestion |
| `bookings.book` | Buchen | Book |
| `bookings.bulk` | Ausgewählte mit Vorschlag buchen | Book selected with suggestion |
| `bookings.bulkDone` | gebucht | booked |
| `bookings.bulkFailed` | nicht gebucht | not booked |
| `bookings.empty` | Keine offenen Transaktionen. | No open transactions. |
| `bookings.emptyBooked` | Noch keine Buchungen. | No bookings yet. |
| `bookings.unbook` | Stornieren | Reverse |
| `bookings.unbookReason` | Grund für die Stornobuchung? | Reason for the reversal? |
| `bookings.receipt.missing` | fehlt | missing |
| `bookings.receipt.choose` | Beleg wählen | Choose receipt |
| `bookings.receipt.none` | Kein Beleg (Eigenbeleg) | No receipt (own record) |
| `bookings.receipt.reason` | Begründung | Reason |
| `bookings.receipt.unavailable` | Belege nicht abrufbar | Receipts unavailable |
| `bookings.dialog.title` | Transaktion buchen | Book transaction |
| `bookings.dialog.account` | Konto | Account |
| `bookings.dialog.vat` | USt-Satz | VAT rate |
| `bookings.dialog.mode` | Art | Type |
| `bookings.dialog.mode.normal` | Netto + Steuer | Net + tax |
| `bookings.dialog.mode.vatOnly` | Nur Steuer | Tax only |
| `bookings.dialog.supplier` | Kreditor | Supplier |
| `bookings.dialog.supplierNone` | — keiner — | — none — |
| `bookings.dialog.text` | Buchungstext | Description |
| `bookings.dialog.remember` | Als Regel merken | Remember as rule |
| `bookings.dialog.preview` | Vorschau | Preview |
| `bookings.dialog.debit` | Soll | Debit |
| `bookings.dialog.credit` | Haben | Credit |
| `bookings.dialog.save` | Buchen | Book |
| `bookings.booked` | Gebucht | Booked |

- [ ] **Step 5: Implement `src/client/components/BookingDialog.tsx`.**

The dialog is a `section.card` rendered inline above the table, the same way `LedgerPage`'s entry form is shown. Requirements:

- **Props:** `{ year: number; tx: InboxRowLike; onDone: () => void }` with `InboxRowLike = { id; direction; amountCents; date; counterpartyName; description; suggestion: { supplierId; account?; vatRate?; mode } | null }`.
- **State:**
  - `account` (initially `suggestion?.account ?? ''`)
  - `vatRate` (`suggestion?.vatRate ?? 0.19`)
  - `mode` (`suggestion?.mode ?? 'normal'`)
  - `supplierId` (`suggestion?.supplierId ?? ''`)
  - `text` (`''`; the server default text applies when empty)
  - `remember` (`!suggestion`)
  - `receiptId` (`''`), `missing` (`false`), `missingReason` (`''`)
- **Account field:** `<input list="booking-accounts">` with a `<datalist>` of `accounts.list` entries (`${number} ${name}`), disabled when `mode === 'vatOnly'`.
- **VAT field:** `<select>` 0 / 7 / 19 % (values `0`, `0.07`, `0.19`).
- **Mode field:** `<select>` with `normal` / `vatOnly`.
- **Supplier field:** `<select>` from `suppliers.list`, with the first option `bookings.dialog.supplierNone`.
- **Receipt field:** `trpc.receipts.list.useQuery({ year, bankTxId: tx.id }, { retry: false })`. Show a `<select>` of the ranked files (top 30, label = file name). If the query errors, show `bookings.receipt.unavailable` in muted text. A checkbox `bookings.receipt.none` reveals a reason input.
- **Preview:** `previewBankPosting({ direction: tx.direction, amountCents: tx.amountCents, account, vatRate, mode })`, shown as a small table (account / Soll / Haben with `formatEUR`) or the error in `var(--danger)`.
- **Submit** (disabled while pending or when the preview has an error) calls:
  ```
  bookings.book.mutateAsync({ bankTxId: tx.id, account, vatRate, mode, supplierId: supplierId || undefined, text: text || undefined, rememberRule: remember, receipt: chosen ? { driveFileId, fileName, link } : undefined, receiptMissingReason: missing ? missingReason || null : undefined })
  ```
  Then `utils.bookings.invalidate()`, a toast with `${t('bookings.booked')} ${entryNumber}`, and `onDone()`. Errors go through `toast.error(message)`.
- Every label goes through `t()`. Use the existing form classes (`grid-form`, `lab`, `field`, `row acts`, `btn`, `btn ghost`), as `LedgerPage` does.

- [ ] **Step 6: Implement `src/client/pages/BookingsPage.tsx`.**

**Header** (`page-head`):
- Title `bookings.title`, subtitle `bookings.sub`.
- A year `<select>` (current year and the years from `ledger.fiscalYears`).
- **Balance banner** (`section.card`) from `bookings.balanceCheck({ year })`:
  - `Konto 1800` = `formatEUR(ledgerCents)`.
  - `GLS laut Firefly` = `formatEUR(bankCents)`, or `bookings.balance.unavailable` plus the `error` in muted text.
  - Difference in `var(--danger)` when non-zero, otherwise `bookings.balance.ok`.
  - Next to it, `stats.open` + `bookings.open` and `stats.missingReceipts` + `bookings.missingReceipts`.

**Tabs:** chips for `inbox` | `booked` | `suppliers`, using the `LedgerPage` chip markup. Keep `SuppliersPanel` out of this task: the suppliers tab renders `null` until Task 7 replaces it.

**Inbox tab** (`table.resp`):
- Columns: a checkbox, date, counterparty (name; IBAN muted beneath), purpose (truncated to 80 chars with a `title` holding the full text), signed amount, suggestion, and a "Buchen" button.
  - Signed amount: `out` shown negative via `formatEUR(-amountCents)`, `in` positive.
  - Suggestion: `${supplierName} → ${account ?? 'USt'} · ${vatRate*100} %`, or muted `bookings.noSuggestion`.
  - The "Buchen" button opens `BookingDialog` for that row.
- Each `<td>` carries `data-l`.
- A header checkbox selects every row that has a suggestion.
- Bulk button `bookings.bulk (n)`, disabled when nothing is selected. It calls `bookBulk.mutateAsync({ bankTxIds })`, invalidates, toasts `${okCount} bookings.bulkDone`, and when there are failures renders them below the table (`id → error`, using the counterparty name).
- Empty state: `bookings.empty`.

**Booked tab:**
- Columns: date, entry number, counterparty / supplier name, signed amount, lines summary (`S 6837 100,00 €` per line, as in LedgerPage), and receipt.
  - Receipt: a link `<a href={receipt.link} target="_blank" rel="noreferrer">` with the file name, or the missing reason in muted text, or a `bookings.receipt.missing` badge `b-over`.
- Actions:
  - "Beleg" toggles an inline receipt picker. It uses the same `receipts.list` query and calls `bookings.setReceipt`.
  - "Stornieren" uses `window.prompt(t('bookings.unbookReason'))` and then calls `bookings.unbook`.
- Empty state: `bookings.emptyBooked`.

Queries use `{ enabled: tab === … }` as in LedgerPage. After every mutation, call `utils.bookings.invalidate()` and `utils.ledger.invalidate()`.

- [ ] **Step 7: Wire up the route and nav.**

`main.tsx`: `<Route path="/bookings" element={<BookingsPage />} />` after `/bank`.

`Navigation.tsx`:
- Add `'bookings'` to `IconName`, with the icon `<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5" />`.
- Add a nav item before `/ledger`:
  ```ts
  { to: '/bookings', labelKey: 'nav.bookings', shortKey: 'nav.bookings', icon: 'bookings', badge: 'bookings' }
  ```
- Extend the badge logic. `badge: 'bookings'` shows `trpc.bookings.stats.useQuery({ year: new Date().getFullYear() }).data?.open` when it is > 0, rendered like the existing bank badge.
- Update `src/client/__tests__/i18n-rollout.test.tsx`'s trpc mock with `bookings: { stats: { useQuery: () => ({ data: { open: 0 } }) } }` so the Navigation test keeps passing.

- [ ] **Step 8: Run the tests and verify they pass.**

Run: `npm run typecheck && npm run lint && NODE_ENV=development npx vitest run src/client`

Expected: PASS, including the i18n parity test.

- [ ] **Step 9: Commit.**

```bash
git add src/client
git commit -m "feat(ui): Buchen page with inbox, booking dialog, bulk confirm and receipts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Suppliers panel and creditor import UI

**Files:**
- Create: `src/client/components/SuppliersPanel.tsx`
- Modify: `src/client/pages/BookingsPage.tsx` (render the panel in the suppliers tab), `src/client/i18n/de.ts`, `src/client/i18n/en.ts`
- Test: `src/client/__tests__/suppliersPanel.test.tsx`

**Interfaces:**
- Consumes: tRPC `suppliers.list`, `suppliers.create`, `suppliers.update`, `suppliers.setArchived` and `admin.importCreditors` (Task 3); `accounts.list`.
- Produces: `<SuppliersPanel />`.

- [ ] **Step 1: Write the failing test** in `src/client/__tests__/suppliersPanel.test.tsx`.

Mock `../lib/trpc`:
- `suppliers.list.useQuery` returns `{ data: [{ _id: 's1', kreditorNumber: 70001, name: 'Bank A', ibans: [], namePatterns: [], purposePatterns: ['Abrechnung vom'], defaultAccount: '6855', defaultVatRate: 0, defaultMode: 'normal', archived: false }] }`.
- `accounts.list.useQuery` returns `{ data: [] }`.
- `useMutation` stubs record calls.
- `useUtils` returns `{ suppliers: { invalidate: vi.fn() } }`.

Render inside `LanguageProvider`. Assert that `70001` and `Bank A` and `Abrechnung vom` are shown. Click the import button (`suppliers.import`), paste `creditorName,creditorId\nX,70002` into the textarea, click `suppliers.import.check`, and assert `importCreditors.mutateAsync` was called with `{ csv: 'creditorName,creditorId\nX,70002', dryRun: true }`.

- [ ] **Step 2: Run it and verify it fails.**

Run: `NODE_ENV=development npx vitest run src/client/__tests__/suppliersPanel.test.tsx`

Expected: FAIL (module missing).

- [ ] **Step 3: Add i18n keys** (de / en):

| key | de | en |
|---|---|---|
| `suppliers.number` | Kreditor-Nr. | Supplier no. |
| `suppliers.name` | Name | Name |
| `suppliers.rules` | Regeln | Rules |
| `suppliers.defaults` | Standardbuchung | Default booking |
| `suppliers.new` | Neuer Kreditor | New supplier |
| `suppliers.edit` | Bearbeiten | Edit |
| `suppliers.archive` | Archivieren | Archive |
| `suppliers.ibans` | IBANs (eine pro Zeile) | IBANs (one per line) |
| `suppliers.namePatterns` | Namensmuster (eins pro Zeile) | Name patterns (one per line) |
| `suppliers.purposePatterns` | Verwendungszweck-Muster (eins pro Zeile) | Purpose patterns (one per line) |
| `suppliers.save` | Speichern | Save |
| `suppliers.empty` | Noch keine Kreditoren. | No suppliers yet. |
| `suppliers.import` | Kreditoren importieren | Import suppliers |
| `suppliers.import.hint` | CSV aus dem Sheet (Spalten creditorName, creditorId) einfügen | Paste the Sheet CSV (columns creditorName, creditorId) |
| `suppliers.import.check` | Prüfen | Check |
| `suppliers.import.apply` | Importieren | Import |
| `suppliers.import.result` | neu / vorhanden | new / existing |

- [ ] **Step 4: Implement `SuppliersPanel.tsx`.**

**List** (`table.resp`):
- Columns:
  - Kreditor-Nr.
  - Name
  - Rules: IBANs, name patterns and purpose patterns joined with `, ` and muted; empty → `—`.
  - Defaults: `account · vat% · mode`.
  - Actions: Edit and Archive.

**Form** ("Neuer Kreditor" / "Bearbeiten"):
- Fields: name; three textareas (one entry per line → `string[]`, empty lines dropped); default account (input + datalist from `accounts.list`); VAT select (0 / 7 / 19 / none); mode select.
- Save calls `suppliers.create` or `suppliers.update`, then `utils.suppliers.invalidate()`, then a toast. Errors go to `toast.error`.

**Import** (toggled section):
- A textarea with `suppliers.import.hint`.
- "Prüfen" calls `importCreditors({ csv, dryRun: true })` and shows `rows`, `created / existing`, and the `errors` list in `var(--danger)`.
- "Importieren" is enabled only after a check with zero errors. It calls `importCreditors({ csv, dryRun: false })`, then invalidates and toasts.

In `BookingsPage.tsx`, render `<SuppliersPanel />` when `tab === 'suppliers'`.

- [ ] **Step 5: Run the tests and verify they pass.**

Run: `npm run typecheck && npm run lint && NODE_ENV=development npx vitest run src/client`

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/client
git commit -m "feat(ui): suppliers panel with rules editing and creditor import

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, invariants and full verification

**Files:**
- Modify: `AGENTS.md`, `docs/plans/2026-10-07-accounting.md` (Phase 2 section), `history/README.md`
- Create: `history/2026-10-07_accounting-bank-booking-phase2.md`

- [ ] **Step 1: AGENTS.md.** Add these points to the Ledger invariant bullet / refId conventions:
  - **Bank bookings** use source `{ kind: 'bank', refId: <fireflyJournalId> }`.
  - **Coverage rule:** a transaction is booked iff there is an active `payment` entry `bank:<id>` or an active `bank` entry `<id>`. An invoice-matched transaction is never inbox-booked, and a booked transaction is never assigned to an invoice.
  - **Receipt, supplier and missing-receipt reason** live on `BankTransaction` (mutable metadata). The journal entry stays immutable.
  - **Withdrawals** (`direction: 'out'`) never appear in Bankabgleich or reconcile. Filters use `direction: { $ne: 'out' }`.
  - **Rules only suggest.** Every posting is confirmed individually or through bulk confirm.

  In the Stack & layout table, add `bookings`, `suppliers` and `receipts` to the routers row. Add the go-live step "after deploy run `bank.syncNow({ full: true })` once" to the ledger go-live order.

- [ ] **Step 2: Update the spec's Phase 2 section** (`docs/plans/2026-10-07-accounting.md`). It must reflect the rulings made while planning:
  - Receipt, supplier and missing reason are stored on `BankTransaction`, not on the journal entry, because the entry is immutable and a receipt is often linked later.
  - `bookingState` is derived from coverage, not stored.
  - A full resync is done via `bank.syncNow({ full: true })`.
  - The "Beleg fehlt" count is shown on the Buchen page.

- [ ] **Step 3: Write the history log** `history/2026-10-07_accounting-bank-booking-phase2.md`, using the format of `history/2026-10-07_accounting-ledger-phase1.md`: problem, solution, main files, process, deployment results (fill in at deploy time), verification commands, success criteria, known issues and future enhancements. Deployment notes must include:
  - set `QUEEN_RECEIPTS_FOLDER_ID` in the servyy-container queen env template
  - run `bank.syncNow({ full: true })` once
  - import creditors on the Buchen → Kreditoren tab
  - book January first to train the rules
  - check the balance banner

  Add a row to `history/README.md`.

- [ ] **Step 4: Full verification.**

Run: `npm run lint && npm run typecheck && npm run typecheck:server && npm test`

Expected: all green. Also run `NODE_ENV=development npx vitest run --silent=false 2>&1 | grep -c "\[ledger\]"`; expected `0`.

- [ ] **Step 5: Commit.**

```bash
git add AGENTS.md docs/plans/2026-10-07-accounting.md history/
git commit -m "docs: bank booking invariants, phase 2 history and spec rulings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Push, PR and deploy are the controller's decision. They are not part of this task.
