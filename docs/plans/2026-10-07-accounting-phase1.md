# Accounting Phase 1 — Ledger Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give queen an immutable SKR04 double-entry journal. Invoices, credit notes and payments post to it automatically, opening/manual entries can be entered in the UI, and the Journal / Saldenliste / Kontoblatt are visible on a new "Buchhaltung" page.

**Architecture:** Pure posting rules (`lib/accounting/postingRules.ts`) turn domain events into balanced lines. `lib/accounting/ledger.ts` is the **only** write path: it validates, allocates a gapless per-year entry number and inserts. Corrections are reversals. Existing invoice/reconcile flows call thin hooks (`ledgerHooks.ts`) that never block invoice CRUD; `admin.ledgerBackfill` repairs anything a hook missed. Reports are pure aggregations (`balances.ts`).

**Tech Stack:** TypeScript, Mongoose 9, tRPC 11, zod, React 19, vitest + mongodb-memory-server.

**Spec:** `docs/plans/2026-10-07-accounting.md` (Phase 1 section). Read it first.

## Global Constraints

- Money = **integer cents** everywhere; reuse `lineNetCents` / `lineVatCents` / `parseGermanAmount` / `formatGermanEUR` from `src/server/lib/money.ts`.
- Journal entries are **never updated or deleted**. The only permitted mutation of an existing entry is `active=false` + `reversedBy` set by `reverse()`.
- Entry number format `YYYY-NNNNN`, gapless per fiscal year, via `Counter` `_id: 'journal:YYYY'` (atomic `$inc`).
- Fiscal year = calendar year of the entry date (`date.getFullYear()`, local time, same as `numbering.ts`).
- Posting to a fiscal year with `status: 'closed'` is rejected.
- Public repo: **no company figures** in code, tests or fixtures. Opening balances are only entered via the UI.
- A ledger failure must never fail invoice/bank CRUD: hooks catch, log `[ledger] … failed — run admin.ledgerBackfill`, and return.
- Revenue accounts by VAT rate: 0.19 → 4400 + USt 3806; 0.07 → 4300 + USt 3801; 0 → 4110 (no USt). Receivables 1200, Bank 1800.
- UI copy is German, like the rest of the app.
- Verify with `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.

## Review Focus

1. **Credit note one-cent drift:** a credit note must post the exact mirror of its original invoice (1200 credit = original gross), even when per-line VAT rounding of negated lines would differ. Test in Task 2 (posting from original lines with `negate`) and Task 5 (cancel → trial balance per invoice nets to 0).
2. **Hook retried / double-click:** calling the invoice or payment hook twice must not create a second entry. Test in Task 5 (`postInvoiceEntry` twice → 1 entry).
3. **Payment unassigned then reassigned:** the reversal must free the source so reassigning posts a fresh payment entry. Test in Task 3 (`postOnce` after `reverse` creates a new entry) and Task 5 (assign → unassign → assign = 3 entries, 1 active payment).
4. **Backdated invoice into a closed year / invoice dated before the books start:** must not crash `markSent`; backfill lists it instead of posting. Test in Task 5 (closed FY → markSent still succeeds, no entry) and Task 6 (pre-year invoice payment → `skipped`).
5. **Mutating a posted entry by accident** (`entry.save()` after changing text, `deleteMany`): must throw. Test in Task 3.

---

## File structure

| File | Responsibility |
|------|----------------|
| `src/server/lib/accounting/skr04.ts` (new) | Seed list of SKR04 accounts (generic, no figures) |
| `src/server/lib/accounting/seedAccounts.ts` (new) | Idempotent upsert of the seed list |
| `src/server/models/Account.ts` (new) | Account model |
| `src/server/routers/accounts.ts` (new) | list / create / setArchived |
| `src/server/lib/accounting/postingRules.ts` (new) | Pure: invoice/payment/reversal → balanced lines |
| `src/server/models/JournalEntry.ts` (new) | Entry model + immutability guards + idempotency index |
| `src/server/models/FiscalYear.ts` (new) | Fiscal year settings + status |
| `src/server/lib/accounting/ledger.ts` (new) | `validateLines`, `post`, `postOnce`, `reverse`, `ensureFiscalYear` |
| `src/server/lib/accounting/balances.ts` (new) | Pure: `trialBalance`, `accountLedger` |
| `src/server/lib/accounting/ledgerHooks.ts` (new) | `postInvoiceEntry`, `postPaymentEntry`, `reversePaymentEntry`, `safeLedger` |
| `src/server/lib/accounting/backfill.ts` (new) | `backfillLedger(year)` |
| `src/server/routers/ledger.ts` (new) | list / get / trialBalance / accountLedger / fiscalYears / postManual / reverse |
| `src/server/routers/invoices.ts` (modify) | call hooks in markSent / markPaid / cancel |
| `src/server/lib/reconcile.ts` (modify) | call hooks in `applyPayment` / `reversePayment` |
| `src/server/routers/admin.ts` (modify) | `ledgerBackfill` |
| `src/server/trpc.ts` (modify) | mount `accounts`, `ledger` |
| `src/server/index.ts` (modify) | seed accounts after Mongo connects |
| `src/client/lib/entryForm.ts` (new) | Pure: parse form rows → lines + totals |
| `src/client/pages/LedgerPage.tsx` (new) | Journal / Saldenliste / Konto tabs + entry form |
| `src/client/main.tsx`, `src/client/components/Navigation.tsx` (modify) | route + nav item |
| `AGENTS.md` (modify) | ledger invariants |

---

### Task 1: Accounts (seed, model, router)

**Files:**
- Create: `src/server/lib/accounting/skr04.ts`, `src/server/lib/accounting/seedAccounts.ts`, `src/server/models/Account.ts`, `src/server/routers/accounts.ts`
- Modify: `src/server/trpc.ts`, `src/server/index.ts`
- Test: `src/server/routers/__tests__/accounts.test.ts`

**Interfaces:**
- Produces: `ACCOUNT_TYPES`, `type AccountType`, `SKR04_ACCOUNTS: AccountSeed[]`, `Account` model (`number, name, type, vatRate?, archived`), `seedAccounts(): Promise<number>` (returns upserted count), tRPC `accounts.list({includeArchived?})`, `accounts.create({number,name,type,vatRate?})`, `accounts.setArchived({number,archived})`.

- [ ] **Step 1: Write the failing test** — `src/server/routers/__tests__/accounts.test.ts`

```ts
import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { appRouter } from '../../trpc';
import { Account } from '../../models/Account';
import { seedAccounts } from '../../lib/accounting/seedAccounts';
import { SKR04_ACCOUNTS } from '../../lib/accounting/skr04';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.init();
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.deleteMany({});
});

describe('accounts', () => {
  it('seedAccounts is idempotent', async (ctx) => {
    skipIfNoDb(ctx);
    expect(await seedAccounts()).toBe(SKR04_ACCOUNTS.length);
    expect(await seedAccounts()).toBe(0);
    expect(await Account.countDocuments()).toBe(SKR04_ACCOUNTS.length);
  });

  it('seed does not overwrite a renamed account', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    await Account.updateOne({ number: '1800' }, { name: 'GLS Bank' });
    await seedAccounts();
    expect((await Account.findOne({ number: '1800' }))?.name).toBe('GLS Bank');
  });

  it('list is sorted by number and hides archived by default', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    const caller = adminCaller();
    await caller.accounts.setArchived({ number: '6600', archived: true });
    const list = await caller.accounts.list();
    const numbers = list.map((a) => a.number);
    expect(numbers).toEqual([...numbers].sort());
    expect(numbers).not.toContain('6600');
    const all = await caller.accounts.list({ includeArchived: true });
    expect(all.map((a) => a.number)).toContain('6600');
  });

  it('create rejects duplicates and bad numbers', async (ctx) => {
    skipIfNoDb(ctx);
    await seedAccounts();
    const caller = adminCaller();
    const created = await caller.accounts.create({ number: '6815', name: 'Bürobedarf', type: 'expense' });
    expect(created.number).toBe('6815');
    await expect(
      caller.accounts.create({ number: '6815', name: 'x', type: 'expense' }),
    ).rejects.toThrowError(/exists/);
    await expect(
      caller.accounts.create({ number: '68A', name: 'x', type: 'expense' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/routers/__tests__/accounts.test.ts`
Expected: FAIL — cannot resolve `../../models/Account`.

- [ ] **Step 3: Implement**

`src/server/lib/accounting/skr04.ts`:

```ts
/** SKR04 accounts queen books against. Generic chart data only — never company figures. */
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountSeed {
  number: string;
  name: string;
  type: AccountType;
  vatRate?: number;
}

export const SKR04_ACCOUNTS: AccountSeed[] = [
  { number: '1200', name: 'Forderungen aus Lieferungen und Leistungen', type: 'asset' },
  { number: '1401', name: 'Abziehbare Vorsteuer 7 %', type: 'asset', vatRate: 0.07 },
  { number: '1406', name: 'Abziehbare Vorsteuer 19 %', type: 'asset', vatRate: 0.19 },
  { number: '1800', name: 'Bank', type: 'asset' },
  { number: '2900', name: 'Gezeichnetes Kapital', type: 'equity' },
  { number: '2930', name: 'Gesetzliche Rücklage', type: 'equity' },
  { number: '2970', name: 'Gewinnvortrag vor Verwendung', type: 'equity' },
  { number: '2978', name: 'Verlustvortrag vor Verwendung', type: 'equity' },
  { number: '3020', name: 'Steuerrückstellungen', type: 'liability' },
  { number: '3035', name: 'Gewerbesteuerrückstellung § 4 Abs. 5b EStG', type: 'liability' },
  { number: '3040', name: 'Körperschaftsteuerrückstellung', type: 'liability' },
  { number: '3300', name: 'Verbindlichkeiten aus Lieferungen und Leistungen', type: 'liability' },
  { number: '3500', name: 'Sonstige Verbindlichkeiten', type: 'liability' },
  { number: '3501', name: 'Sonstige Verbindlichkeiten (bis 1 Jahr)', type: 'liability' },
  { number: '3801', name: 'Umsatzsteuer 7 %', type: 'liability', vatRate: 0.07 },
  { number: '3806', name: 'Umsatzsteuer 19 %', type: 'liability', vatRate: 0.19 },
  { number: '3820', name: 'Umsatzsteuer-Vorauszahlungen', type: 'liability' },
  { number: '3840', name: 'Umsatzsteuer laufendes Jahr', type: 'liability' },
  { number: '3841', name: 'Umsatzsteuer Vorjahr', type: 'liability' },
  { number: '4110', name: 'Sonstige steuerfreie Umsätze Inland', type: 'revenue', vatRate: 0 },
  { number: '4300', name: 'Erlöse 7 % USt', type: 'revenue', vatRate: 0.07 },
  { number: '4400', name: 'Erlöse 19 % USt', type: 'revenue', vatRate: 0.19 },
  { number: '4930', name: 'Erträge aus der Auflösung von Rückstellungen', type: 'revenue' },
  { number: '6260', name: 'Sofortabschreibung geringwertiger Wirtschaftsgüter', type: 'expense' },
  { number: '6300', name: 'Sonstige betriebliche Aufwendungen', type: 'expense' },
  { number: '6420', name: 'Beiträge', type: 'expense' },
  { number: '6600', name: 'Werbekosten', type: 'expense' },
  { number: '6640', name: 'Bewirtungskosten', type: 'expense' },
  { number: '6820', name: 'Zeitschriften, Bücher, digitale Medien', type: 'expense' },
  { number: '6821', name: 'Fortbildungskosten', type: 'expense' },
  { number: '6837', name: 'Aufwendungen für Lizenzen, Konzessionen', type: 'expense' },
  { number: '6855', name: 'Nebenkosten des Geldverkehrs', type: 'expense' },
  { number: '6960', name: 'Periodenfremde Aufwendungen', type: 'expense' },
  { number: '7600', name: 'Körperschaftsteuer', type: 'expense' },
  { number: '7608', name: 'Solidaritätszuschlag', type: 'expense' },
  { number: '7610', name: 'Gewerbesteuer', type: 'expense' },
  { number: '7641', name: 'Gewerbesteuer Nachzahlung/Erstattung Vorjahre', type: 'expense' },
  { number: '9000', name: 'Saldenvorträge Sachkonten', type: 'equity' },
];
```

`src/server/models/Account.ts`:

```ts
import mongoose, { Schema, type InferSchemaType } from 'mongoose';
import { ACCOUNT_TYPES } from '../lib/accounting/skr04';

const accountSchema = new Schema(
  {
    number: { type: String, required: true, unique: true, match: /^\d{4,5}$/ },
    name: { type: String, required: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    vatRate: { type: Number },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);

export type AccountDoc = InferSchemaType<typeof accountSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const Account =
  (mongoose.models.Account as mongoose.Model<AccountDoc> | undefined) ??
  mongoose.model<AccountDoc>('Account', accountSchema);
```

`src/server/lib/accounting/seedAccounts.ts`:

```ts
import { Account } from '../../models/Account';
import { SKR04_ACCOUNTS } from './skr04';

/** Insert missing seed accounts; never touches existing ones (renames survive). */
export async function seedAccounts(): Promise<number> {
  const res = await Account.bulkWrite(
    SKR04_ACCOUNTS.map((a) => ({
      updateOne: {
        filter: { number: a.number },
        update: { $setOnInsert: { ...a, archived: false } },
        upsert: true,
      },
    })),
  );
  return res.upsertedCount;
}
```

`src/server/routers/accounts.ts`:

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Account } from '../models/Account';
import { ACCOUNT_TYPES } from '../lib/accounting/skr04';

export const accountsRouter = router({
  list: adminProcedure
    .input(z.object({ includeArchived: z.boolean().optional() }).optional())
    .query(async ({ input }) =>
      Account.find(input?.includeArchived ? {} : { archived: false }).sort({ number: 1 }),
    ),

  create: adminProcedure
    .input(
      z.object({
        number: z.string().regex(/^\d{4,5}$/),
        name: z.string().min(1),
        type: z.enum(ACCOUNT_TYPES),
        vatRate: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (await Account.exists({ number: input.number })) {
        throw new TRPCError({ code: 'CONFLICT', message: `Account ${input.number} exists` });
      }
      return Account.create({ ...input, archived: false });
    }),

  setArchived: adminProcedure
    .input(z.object({ number: z.string().min(1), archived: z.boolean() }))
    .mutation(async ({ input }) => {
      const account = await Account.findOneAndUpdate(
        { number: input.number },
        { archived: input.archived },
        { new: true },
      );
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      return account;
    }),
});
```

`src/server/trpc.ts`: add `import { accountsRouter } from './routers/accounts';` and `accounts: accountsRouter,` in `appRouter`.

`src/server/index.ts`: inside the `connectMongo().then(() => { … })` callback, after `setDbStatus('connected');` add:

```ts
    seedAccounts()
      .then((n) => n > 0 && console.log(`Seeded ${n} SKR04 accounts`))
      .catch((err) => console.error('Account seed failed:', err));
```

with `import { seedAccounts } from './lib/accounting/seedAccounts';` at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/routers/__tests__/accounts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/accounting src/server/models/Account.ts src/server/routers/accounts.ts src/server/routers/__tests__/accounts.test.ts src/server/trpc.ts src/server/index.ts
git commit -m "feat(ledger): SKR04 account seed and accounts router"
```

---

### Task 2: Posting rules (pure)

**Files:**
- Create: `src/server/lib/accounting/postingRules.ts`
- Test: `src/server/lib/accounting/__tests__/postingRules.test.ts`

**Interfaces:**
- Consumes: `lineNetCents(quantity, unitNetCents)`, `lineVatCents(netCents, vatRate)` from `src/server/lib/money.ts`.
- Produces:
  - `interface PostingLine { account: string; debitCents: number; creditCents: number }`
  - `interface PostingLineInput { quantity: number; unitNetCents: number; vatRate: number }`
  - `const RECEIVABLES = '1200'`, `const BANK = '1800'`
  - `class PostingError extends Error`
  - `invoicePosting(lines: PostingLineInput[], options?: { negate?: boolean }): PostingLine[]`
  - `paymentPosting(amountCents: number): PostingLine[]`
  - `reversalLines(lines: PostingLine[]): PostingLine[]`
  - Output lines are sorted by account, zero-sum accounts dropped, each line one-sided.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  invoicePosting,
  paymentPosting,
  reversalLines,
  PostingError,
  type PostingLine,
} from '../postingRules';

function sums(lines: PostingLine[]) {
  return lines.reduce(
    (s, l) => ({ debit: s.debit + l.debitCents, credit: s.credit + l.creditCents }),
    { debit: 0, credit: 0 },
  );
}

describe('invoicePosting', () => {
  it('19 % single line → 1200 / 4400 + 3806', () => {
    expect(invoicePosting([{ quantity: 1, unitNetCents: 10000, vatRate: 0.19 }])).toEqual([
      { account: '1200', debitCents: 11900, creditCents: 0 },
      { account: '3806', debitCents: 0, creditCents: 1900 },
      { account: '4400', debitCents: 0, creditCents: 10000 },
    ]);
  });

  it('mixed rates split revenue and USt per rate; 0 % has no USt line', () => {
    const lines = invoicePosting([
      { quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
      { quantity: 2, unitNetCents: 2500, vatRate: 0 },
      { quantity: 1, unitNetCents: 1000, vatRate: 0.07 },
    ]);
    expect(lines).toEqual([
      { account: '1200', debitCents: 16970, creditCents: 0 },
      { account: '3801', debitCents: 0, creditCents: 70 },
      { account: '3806', debitCents: 0, creditCents: 1900 },
      { account: '4110', debitCents: 0, creditCents: 5000 },
      { account: '4300', debitCents: 0, creditCents: 1000 },
      { account: '4400', debitCents: 0, creditCents: 10000 },
    ]);
    const s = sums(lines);
    expect(s.debit).toBe(s.credit);
  });

  it('discount lines net per account with per-line VAT rounding', () => {
    expect(
      invoicePosting([
        { quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
        { quantity: 1, unitNetCents: -2500, vatRate: 0.19 },
      ]),
    ).toEqual([
      { account: '1200', debitCents: 8925, creditCents: 0 },
      { account: '3806', debitCents: 0, creditCents: 1425 },
      { account: '4400', debitCents: 0, creditCents: 7500 },
    ]);
  });

  it('negate mirrors the original exactly (credit note, no 1-cent drift)', () => {
    // 0.5 × 333 = 166.5 → 167 net; VAT 31.73 → 32. Negating the *lines* would round differently.
    const original = [{ quantity: 0.5, unitNetCents: 333, vatRate: 0.19 }];
    const posted = invoicePosting(original);
    const mirrored = invoicePosting(original, { negate: true });
    expect(mirrored).toEqual(reversalLines(posted));
  });

  it('rejects unknown VAT rates', () => {
    expect(() => invoicePosting([{ quantity: 1, unitNetCents: 100, vatRate: 0.16 }])).toThrowError(
      PostingError,
    );
  });
});

describe('paymentPosting', () => {
  it('Bank an Forderungen', () => {
    expect(paymentPosting(11900)).toEqual([
      { account: '1800', debitCents: 11900, creditCents: 0 },
      { account: '1200', debitCents: 0, creditCents: 11900 },
    ]);
  });

  it('rejects zero, negative and fractional amounts', () => {
    for (const bad of [0, -1, 1.5]) expect(() => paymentPosting(bad)).toThrowError(PostingError);
  });
});

describe('reversalLines', () => {
  it('swaps debit and credit', () => {
    expect(reversalLines([{ account: '1800', debitCents: 5, creditCents: 0 }])).toEqual([
      { account: '1800', debitCents: 0, creditCents: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/lib/accounting/__tests__/postingRules.test.ts`
Expected: FAIL — cannot resolve `../postingRules`.

- [ ] **Step 3: Implement** — `src/server/lib/accounting/postingRules.ts`

```ts
import { lineNetCents, lineVatCents } from '../money';

/** One side of a journal line; exactly one of debit/credit is > 0. */
export interface PostingLine {
  account: string;
  debitCents: number;
  creditCents: number;
}

export interface PostingLineInput {
  quantity: number;
  unitNetCents: number;
  vatRate: number;
}

export const RECEIVABLES = '1200';
export const BANK = '1800';

const REVENUE_BY_RATE: Record<string, { revenue: string; vat?: string }> = {
  '0.19': { revenue: '4400', vat: '3806' },
  '0.07': { revenue: '4300', vat: '3801' },
  '0': { revenue: '4110' },
};

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

function add(signed: Map<string, number>, account: string, cents: number): void {
  signed.set(account, (signed.get(account) ?? 0) + cents);
}

/** Signed cents per account (debit > 0) → sorted one-sided lines, zero balances dropped. */
function toLines(signed: Map<string, number>): PostingLine[] {
  return [...signed.entries()]
    .filter(([, cents]) => cents !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, cents]) => ({
      account,
      debitCents: cents > 0 ? cents : 0,
      creditCents: cents < 0 ? -cents : 0,
    }));
}

/**
 * Forderung an Erlös + USt, per line with the same rounding as `invoiceTotals`,
 * so the 1200 amount always equals the invoice's stored gross. For a credit
 * note pass the ORIGINAL invoice's lines with `negate` — negating the computed
 * amounts (not the inputs) mirrors the original exactly.
 */
export function invoicePosting(
  lines: PostingLineInput[],
  options: { negate?: boolean } = {},
): PostingLine[] {
  const sign = options.negate ? -1 : 1;
  const signed = new Map<string, number>();
  for (const line of lines) {
    const accounts = REVENUE_BY_RATE[String(line.vatRate)];
    if (!accounts) throw new PostingError(`No revenue account for VAT rate ${line.vatRate}`);
    const net = lineNetCents(line.quantity, line.unitNetCents);
    const vat = lineVatCents(net, line.vatRate);
    add(signed, RECEIVABLES, sign * (net + vat));
    add(signed, accounts.revenue, -sign * net);
    if (accounts.vat) add(signed, accounts.vat, -sign * vat);
  }
  return toLines(signed);
}

/** Bank an Forderungen for a customer payment. */
export function paymentPosting(amountCents: number): PostingLine[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new PostingError(`Payment amount must be positive integer cents, got ${amountCents}`);
  }
  return [
    { account: BANK, debitCents: amountCents, creditCents: 0 },
    { account: RECEIVABLES, debitCents: 0, creditCents: amountCents },
  ];
}

/** Mirror lines for a Storno entry. */
export function reversalLines(lines: PostingLine[]): PostingLine[] {
  return lines.map((l) => ({
    account: l.account,
    debitCents: l.creditCents,
    creditCents: l.debitCents,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/lib/accounting/__tests__/postingRules.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/accounting/postingRules.ts src/server/lib/accounting/__tests__/postingRules.test.ts
git commit -m "feat(ledger): pure posting rules for invoices, credit notes and payments"
```

---

### Task 3: Journal, fiscal year and the ledger write path

**Files:**
- Create: `src/server/models/JournalEntry.ts`, `src/server/models/FiscalYear.ts`, `src/server/lib/accounting/ledger.ts`
- Test: `src/server/lib/accounting/__tests__/ledger.test.ts`

**Interfaces:**
- Consumes: `PostingLine`, `reversalLines` (Task 2); `Account` model, `seedAccounts` (Task 1); `Counter` model (`src/server/models/Counter.ts`).
- Produces:
  - `SOURCE_KINDS` = `['opening','invoice','credit_note','payment','bank','manual','vat_close','tax_provision','appropriation','closing','reversal'] as const`, `type SourceKind`
  - `JournalEntry` model: `entryNumber, date, fiscalYear, text, lines: PostingLine[], source: {kind, refId?}, active: boolean, reverses?, reversedBy?, createdBy`
  - `FiscalYear` model: `year, status: 'open'|'closing'|'closed', vatMethod: 'soll', vatPeriod: 'quarter'|'month'|'year', hebesatz, closedAt?`
  - `interface EntryDraft { date: Date; text: string; lines: PostingLine[]; source: { kind: SourceKind; refId?: string }; createdBy: string; reverses?: Types.ObjectId }`
  - `class LedgerError extends Error { code: LedgerErrorCode }` with codes `'EMPTY'|'INVALID_AMOUNT'|'UNBALANCED'|'UNKNOWN_ACCOUNT'|'YEAR_CLOSED'|'DUPLICATE'|'NOT_FOUND'|'ALREADY_REVERSED'|'NOT_REVERSIBLE'`
  - `validateLines(lines: PostingLine[]): void` (pure, throws `LedgerError`)
  - `ensureFiscalYear(year: number)` → FiscalYear doc
  - `findActiveBySource(kind: SourceKind, refId: string)` → entry | null
  - `post(draft: EntryDraft)` → created entry (throws `DUPLICATE` if an active entry has the same `source.kind`+`refId`)
  - `postOnce(draft: EntryDraft): Promise<{ entry; created: boolean }>`
  - `reverse(entryId: string, opts: { reason: string; createdBy: string; date?: Date }): Promise<{ original; reversal }>`

- [ ] **Step 1: Write the failing test** — `src/server/lib/accounting/__tests__/ledger.test.ts`

```ts
import { describe, it, expect, beforeEach, beforeAll, type TaskContext } from 'vitest';
import mongoose from 'mongoose';
import { Account } from '../../../models/Account';
import { Counter } from '../../../models/Counter';
import { FiscalYear } from '../../../models/FiscalYear';
import { JournalEntry } from '../../../models/JournalEntry';
import { seedAccounts } from '../seedAccounts';
import {
  LedgerError,
  validateLines,
  post,
  postOnce,
  reverse,
  type EntryDraft,
} from '../ledger';

function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

const draft = (over: Partial<EntryDraft> = {}): EntryDraft => ({
  date: new Date(2026, 2, 10),
  text: 'Test',
  lines: [
    { account: '1800', debitCents: 1000, creditCents: 0 },
    { account: '1200', debitCents: 0, creditCents: 1000 },
  ],
  source: { kind: 'manual' },
  createdBy: 'test',
  ...over,
});

beforeAll(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([Account.init(), JournalEntry.init(), FiscalYear.init()]);
});

beforeEach(async () => {
  if (mongoose.connection.readyState !== 1) return;
  await Account.deleteMany({});
  await seedAccounts();
  await JournalEntry.collection.deleteMany({}); // bypasses the immutability guard
  await FiscalYear.deleteMany({});
  await Counter.deleteMany({ _id: /^journal:/ });
});

describe('validateLines (pure)', () => {
  const l = (account: string, debitCents: number, creditCents: number) => ({
    account,
    debitCents,
    creditCents,
  });
  it('accepts a balanced entry', () => {
    expect(() => validateLines([l('1800', 5, 0), l('1200', 0, 5)])).not.toThrow();
  });
  it.each([
    ['single line', [l('1800', 5, 0)], 'EMPTY'],
    ['unbalanced', [l('1800', 5, 0), l('1200', 0, 4)], 'UNBALANCED'],
    ['two-sided line', [l('1800', 5, 5), l('1200', 0, 0)], 'INVALID_AMOUNT'],
    ['negative', [l('1800', -5, 0), l('1200', 0, -5)], 'INVALID_AMOUNT'],
    ['fractional', [l('1800', 0.5, 0), l('1200', 0, 0.5)], 'INVALID_AMOUNT'],
  ])('rejects %s', (_name, lines, code) => {
    try {
      validateLines(lines);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LedgerError);
      expect((err as LedgerError).code).toBe(code);
    }
  });
});

describe('post', () => {
  it('allocates gapless numbers per fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    const a = await post(draft());
    const b = await post(draft());
    const c = await post(draft({ date: new Date(2027, 0, 2) }));
    expect([a.entryNumber, b.entryNumber, c.entryNumber]).toEqual([
      '2026-00001',
      '2026-00002',
      '2027-00001',
    ]);
    expect(a.fiscalYear).toBe(2026);
    expect(a.active).toBe(true);
    expect(await FiscalYear.findOne({ year: 2026 })).not.toBeNull();
  });

  it('rejects unknown and archived accounts', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(
      post(
        draft({
          lines: [
            { account: '9999', debitCents: 1, creditCents: 0 },
            { account: '1200', debitCents: 0, creditCents: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
    await Account.updateOne({ number: '1200' }, { archived: true });
    await expect(post(draft())).rejects.toMatchObject({ code: 'UNKNOWN_ACCOUNT' });
  });

  it('rejects postings into a closed fiscal year', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'closed' });
    await expect(post(draft({ date: new Date(2025, 11, 31) }))).rejects.toMatchObject({
      code: 'YEAR_CLOSED',
    });
  });

  it('rejects a second active entry for the same source; postOnce returns the existing one', async (ctx) => {
    skipIfNoDb(ctx);
    const source = { kind: 'payment' as const, refId: 'bank:1:0' };
    const first = await post(draft({ source }));
    await expect(post(draft({ source }))).rejects.toMatchObject({ code: 'DUPLICATE' });
    const again = await postOnce(draft({ source }));
    expect(again.created).toBe(false);
    expect(String(again.entry._id)).toBe(String(first._id));
    expect(await JournalEntry.countDocuments()).toBe(1);
  });
});

describe('reverse', () => {
  it('posts a mirror entry, deactivates the original and frees the source', async (ctx) => {
    skipIfNoDb(ctx);
    const source = { kind: 'payment' as const, refId: 'bank:2:0' };
    const original = await post(draft({ source }));
    const { reversal } = await reverse(String(original._id), { reason: 'falsch', createdBy: 't' });
    expect(reversal.lines).toEqual([
      { account: '1800', debitCents: 0, creditCents: 1000 },
      { account: '1200', debitCents: 1000, creditCents: 0 },
    ]);
    expect(String(reversal.reverses)).toBe(String(original._id));
    const reloaded = await JournalEntry.findById(original._id);
    expect(reloaded?.active).toBe(false);
    expect(String(reloaded?.reversedBy)).toBe(String(reversal._id));
    const reposted = await postOnce(draft({ source }));
    expect(reposted.created).toBe(true);
  });

  it('refuses double reversal and reversing a reversal', async (ctx) => {
    skipIfNoDb(ctx);
    const original = await post(draft());
    const { reversal } = await reverse(String(original._id), { reason: 'x', createdBy: 't' });
    await expect(
      reverse(String(original._id), { reason: 'x', createdBy: 't' }),
    ).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });
    await expect(
      reverse(String(reversal._id), { reason: 'x', createdBy: 't' }),
    ).rejects.toMatchObject({ code: 'NOT_REVERSIBLE' });
  });
});

describe('immutability', () => {
  it('rejects edits and deletes of posted entries', async (ctx) => {
    skipIfNoDb(ctx);
    const entry = await post(draft());
    entry.text = 'changed';
    await expect(entry.save()).rejects.toThrowError(/immutable/);
    await expect(JournalEntry.deleteMany({})).rejects.toThrowError(/immutable/);
    await expect(JournalEntry.updateOne({}, { text: 'x' })).rejects.toThrowError(/immutable/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/lib/accounting/__tests__/ledger.test.ts`
Expected: FAIL — cannot resolve `../../../models/FiscalYear`.

- [ ] **Step 3: Implement**

`src/server/models/FiscalYear.ts`:

```ts
import mongoose, { Schema, type InferSchemaType } from 'mongoose';

const fiscalYearSchema = new Schema(
  {
    year: { type: Number, required: true, unique: true },
    status: { type: String, enum: ['open', 'closing', 'closed'], required: true, default: 'open' },
    vatMethod: { type: String, enum: ['soll'], required: true, default: 'soll' },
    vatPeriod: {
      type: String,
      enum: ['quarter', 'month', 'year'],
      required: true,
      default: 'quarter',
    },
    hebesatz: { type: Number, required: true, default: 490 },
    closedAt: { type: Date },
  },
  { timestamps: true },
);

export type FiscalYearDoc = InferSchemaType<typeof fiscalYearSchema> & {
  _id: mongoose.Types.ObjectId;
};

export const FiscalYear =
  (mongoose.models.FiscalYear as mongoose.Model<FiscalYearDoc> | undefined) ??
  mongoose.model<FiscalYearDoc>('FiscalYear', fiscalYearSchema);
```

`src/server/models/JournalEntry.ts`:

```ts
import mongoose, { Schema, type InferSchemaType } from 'mongoose';

export const SOURCE_KINDS = [
  'opening',
  'invoice',
  'credit_note',
  'payment',
  'bank',
  'manual',
  'vat_close',
  'tax_provision',
  'appropriation',
  'closing',
  'reversal',
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

const IMMUTABLE = 'Journal entries are immutable; use reverse()';
// The only fields reverse() may change on a posted entry.
const MUTABLE_AFTER_POST = new Set(['active', 'reversedBy', 'updatedAt']);

const lineSchema = new Schema(
  {
    account: { type: String, required: true },
    debitCents: { type: Number, required: true, default: 0 },
    creditCents: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const journalEntrySchema = new Schema(
  {
    entryNumber: { type: String, required: true, unique: true },
    date: { type: Date, required: true },
    fiscalYear: { type: Number, required: true, index: true },
    text: { type: String, required: true },
    lines: { type: [lineSchema], required: true },
    source: {
      kind: { type: String, enum: SOURCE_KINDS, required: true },
      refId: { type: String },
    },
    // false once reversed; only active entries count for idempotency.
    active: { type: Boolean, required: true, default: true },
    reverses: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: String, required: true },
  },
  { timestamps: true },
);

journalEntrySchema.index({ 'lines.account': 1, fiscalYear: 1 });
journalEntrySchema.index(
  { 'source.kind': 1, 'source.refId': 1 },
  {
    unique: true,
    partialFilterExpression: { active: true, 'source.refId': { $exists: true } },
  },
);

journalEntrySchema.pre('save', function () {
  if (this.isNew) return;
  const changed = this.modifiedPaths().filter((p) => !MUTABLE_AFTER_POST.has(p));
  if (changed.length > 0) throw new Error(`${IMMUTABLE} (tried to change ${changed.join(', ')})`);
});

for (const op of [
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const) {
  journalEntrySchema.pre(op, () => {
    throw new Error(IMMUTABLE);
  });
}

export type JournalEntryDoc = InferSchemaType<typeof journalEntrySchema> & {
  _id: mongoose.Types.ObjectId;
};

export const JournalEntry =
  (mongoose.models.JournalEntry as mongoose.Model<JournalEntryDoc> | undefined) ??
  mongoose.model<JournalEntryDoc>('JournalEntry', journalEntrySchema);
```

> Note: `deleteOne` registers for both query and document middleware by default in Mongoose. A thrown error in a sync pre hook rejects the operation. If Mongoose 9 complains about the `op` union in the `for` loop, register each hook explicitly instead.

`src/server/lib/accounting/ledger.ts`:

```ts
import type { Types } from 'mongoose';
import { Account } from '../../models/Account';
import { Counter } from '../../models/Counter';
import { FiscalYear } from '../../models/FiscalYear';
import { JournalEntry, type SourceKind } from '../../models/JournalEntry';
import { reversalLines, type PostingLine } from './postingRules';

export type LedgerErrorCode =
  | 'EMPTY'
  | 'INVALID_AMOUNT'
  | 'UNBALANCED'
  | 'UNKNOWN_ACCOUNT'
  | 'YEAR_CLOSED'
  | 'DUPLICATE'
  | 'NOT_FOUND'
  | 'ALREADY_REVERSED'
  | 'NOT_REVERSIBLE';

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

export interface EntryDraft {
  date: Date;
  text: string;
  lines: PostingLine[];
  source: { kind: SourceKind; refId?: string };
  createdBy: string;
  reverses?: Types.ObjectId;
}

/** Structural checks: ≥ 2 one-sided non-negative integer lines, Σdebit = Σcredit. */
export function validateLines(lines: PostingLine[]): void {
  if (lines.length < 2) throw new LedgerError('EMPTY', 'An entry needs at least two lines');
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    const ints = Number.isInteger(l.debitCents) && Number.isInteger(l.creditCents);
    if (!ints || l.debitCents < 0 || l.creditCents < 0) {
      throw new LedgerError('INVALID_AMOUNT', `Line ${l.account}: amounts must be non-negative cents`);
    }
    if (l.debitCents > 0 === l.creditCents > 0) {
      throw new LedgerError('INVALID_AMOUNT', `Line ${l.account}: exactly one side must be > 0`);
    }
    debit += l.debitCents;
    credit += l.creditCents;
  }
  if (debit !== credit) {
    throw new LedgerError('UNBALANCED', `Soll ${debit} ≠ Haben ${credit}`);
  }
}

export async function ensureFiscalYear(year: number) {
  const fy = await FiscalYear.findOneAndUpdate(
    { year },
    { $setOnInsert: { year } },
    { upsert: true, new: true },
  );
  return fy!;
}

export async function findActiveBySource(kind: SourceKind, refId: string) {
  return JournalEntry.findOne({ 'source.kind': kind, 'source.refId': refId, active: true });
}

async function allocateEntryNumber(year: number): Promise<string> {
  const doc = await Counter.findOneAndUpdate(
    { _id: `journal:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, new: true },
  ).lean();
  return `${year}-${String(doc?.seq ?? 1).padStart(5, '0')}`;
}

/**
 * The only way to write a journal entry. All checks run BEFORE the number is
 * allocated so rejected drafts never leave a gap. (A concurrent duplicate that
 * loses the unique-index race after allocation can still leave one; queen has
 * a single operator, so this is accepted and documented.)
 */
export async function post(draft: EntryDraft) {
  validateLines(draft.lines);

  const numbers = [...new Set(draft.lines.map((l) => l.account))];
  const found = await Account.find({ number: { $in: numbers }, archived: false }).select('number');
  const known = new Set(found.map((a) => a.number));
  const missing = numbers.filter((n) => !known.has(n));
  if (missing.length > 0) {
    throw new LedgerError('UNKNOWN_ACCOUNT', `Unknown or archived account(s): ${missing.join(', ')}`);
  }

  const year = draft.date.getFullYear();
  const fy = await ensureFiscalYear(year);
  if (fy.status === 'closed') {
    throw new LedgerError('YEAR_CLOSED', `Fiscal year ${year} is closed`);
  }

  if (draft.source.refId && (await findActiveBySource(draft.source.kind, draft.source.refId))) {
    throw new LedgerError(
      'DUPLICATE',
      `Already posted: ${draft.source.kind} ${draft.source.refId}`,
    );
  }

  const entryNumber = await allocateEntryNumber(year);
  return JournalEntry.create({ ...draft, fiscalYear: year, entryNumber, active: true });
}

/** Idempotent post for automatic sources: returns the active entry if one exists. */
export async function postOnce(draft: EntryDraft) {
  if (draft.source.refId) {
    const existing = await findActiveBySource(draft.source.kind, draft.source.refId);
    if (existing) return { entry: existing, created: false };
  }
  return { entry: await post(draft), created: true };
}

/** GoBD correction: post the mirror entry and retire the original. */
export async function reverse(
  entryId: string,
  opts: { reason: string; createdBy: string; date?: Date },
) {
  const original = await JournalEntry.findById(entryId);
  if (!original) throw new LedgerError('NOT_FOUND', 'Journal entry not found');
  if (original.source.kind === 'reversal') {
    throw new LedgerError('NOT_REVERSIBLE', 'A reversal cannot be reversed; post the entry again');
  }
  if (!original.active || original.reversedBy) {
    throw new LedgerError('ALREADY_REVERSED', `${original.entryNumber} is already reversed`);
  }

  const reversal = await post({
    date: opts.date ?? new Date(),
    text: `Storno ${original.entryNumber}: ${opts.reason}`,
    lines: reversalLines(original.lines),
    source: { kind: 'reversal', refId: String(original._id) },
    createdBy: opts.createdBy,
    reverses: original._id,
  });

  original.active = false;
  original.reversedBy = reversal._id;
  await original.save();
  return { original, reversal };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/lib/accounting/__tests__/ledger.test.ts`
Expected: PASS. If `JournalEntry.collection.deleteMany` leaves the unique index from a previous run inconsistent, run the file alone once more — the in-memory DB is fresh per process.

- [ ] **Step 5: Commit**

```bash
git add src/server/models/JournalEntry.ts src/server/models/FiscalYear.ts src/server/lib/accounting/ledger.ts src/server/lib/accounting/__tests__/ledger.test.ts
git commit -m "feat(ledger): immutable journal with gapless numbering and reversal"
```

---

### Task 4: Balances (pure)

**Files:**
- Create: `src/server/lib/accounting/balances.ts`
- Test: `src/server/lib/accounting/__tests__/balances.test.ts`

**Interfaces:**
- Consumes: `PostingLine` (Task 2).
- Produces:
  - `interface BalanceRow { account: string; debitCents: number; creditCents: number; balanceCents: number }` (balance = debit − credit)
  - `trialBalance(entries: { lines: PostingLine[] }[]): { rows: BalanceRow[]; debitCents: number; creditCents: number }`
  - `interface LedgerRow { entryId: string; entryNumber: string; date: Date; text: string; debitCents: number; creditCents: number; runningCents: number }`
  - `accountLedger(account: string, entries: LedgerEntryLike[]): LedgerRow[]` where `LedgerEntryLike = { _id: unknown; entryNumber: string; date: Date; text: string; lines: PostingLine[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { trialBalance, accountLedger } from '../balances';

const e = (
  id: string,
  entryNumber: string,
  date: Date,
  lines: [string, number, number][],
) => ({
  _id: id,
  entryNumber,
  date,
  text: entryNumber,
  lines: lines.map(([account, debitCents, creditCents]) => ({ account, debitCents, creditCents })),
});

const entries = [
  e('b', '2026-00002', new Date(2026, 1, 1), [
    ['1800', 500, 0],
    ['1200', 0, 500],
  ]),
  e('a', '2026-00001', new Date(2026, 0, 15), [
    ['1200', 1190, 0],
    ['4400', 0, 1000],
    ['3806', 0, 190],
  ]),
];

describe('trialBalance', () => {
  it('sums per account, sorted, totals balance', () => {
    const tb = trialBalance(entries);
    expect(tb.rows).toEqual([
      { account: '1200', debitCents: 1190, creditCents: 500, balanceCents: 690 },
      { account: '1800', debitCents: 500, creditCents: 0, balanceCents: 500 },
      { account: '3806', debitCents: 0, creditCents: 190, balanceCents: -190 },
      { account: '4400', debitCents: 0, creditCents: 1000, balanceCents: -1000 },
    ]);
    expect(tb.debitCents).toBe(1690);
    expect(tb.creditCents).toBe(1690);
  });

  it('empty journal → no rows, zero totals', () => {
    expect(trialBalance([])).toEqual({ rows: [], debitCents: 0, creditCents: 0 });
  });
});

describe('accountLedger', () => {
  it('orders by date then number with a running balance', () => {
    expect(accountLedger('1200', entries)).toEqual([
      {
        entryId: 'a',
        entryNumber: '2026-00001',
        date: new Date(2026, 0, 15),
        text: '2026-00001',
        debitCents: 1190,
        creditCents: 0,
        runningCents: 1190,
      },
      {
        entryId: 'b',
        entryNumber: '2026-00002',
        date: new Date(2026, 1, 1),
        text: '2026-00002',
        debitCents: 0,
        creditCents: 500,
        runningCents: 690,
      },
    ]);
  });

  it('sums several lines of one entry on the same account', () => {
    const rows = accountLedger('1800', [
      e('c', '2026-00003', new Date(2026, 2, 1), [
        ['1800', 100, 0],
        ['1800', 50, 0],
        ['1200', 0, 150],
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ debitCents: 150, creditCents: 0, runningCents: 150 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/lib/accounting/__tests__/balances.test.ts`
Expected: FAIL — cannot resolve `../balances`.

- [ ] **Step 3: Implement** — `src/server/lib/accounting/balances.ts`

```ts
import type { PostingLine } from './postingRules';

export interface BalanceRow {
  account: string;
  debitCents: number;
  creditCents: number;
  /** debit − credit; negative = credit balance */
  balanceCents: number;
}

/** Summen- und Saldenliste. Reversed entries and their reversals both count and net out. */
export function trialBalance(entries: { lines: PostingLine[] }[]): {
  rows: BalanceRow[];
  debitCents: number;
  creditCents: number;
} {
  const byAccount = new Map<string, BalanceRow>();
  let debitCents = 0;
  let creditCents = 0;
  for (const entry of entries) {
    for (const l of entry.lines) {
      const row = byAccount.get(l.account) ?? {
        account: l.account,
        debitCents: 0,
        creditCents: 0,
        balanceCents: 0,
      };
      row.debitCents += l.debitCents;
      row.creditCents += l.creditCents;
      row.balanceCents = row.debitCents - row.creditCents;
      byAccount.set(l.account, row);
      debitCents += l.debitCents;
      creditCents += l.creditCents;
    }
  }
  const rows = [...byAccount.values()].sort((a, b) => a.account.localeCompare(b.account));
  return { rows, debitCents, creditCents };
}

export interface LedgerEntryLike {
  _id: unknown;
  entryNumber: string;
  date: Date;
  text: string;
  lines: PostingLine[];
}

export interface LedgerRow {
  entryId: string;
  entryNumber: string;
  date: Date;
  text: string;
  debitCents: number;
  creditCents: number;
  runningCents: number;
}

/** Kontoblatt: entries touching `account`, by date then number, with running balance. */
export function accountLedger(account: string, entries: LedgerEntryLike[]): LedgerRow[] {
  const sorted = [...entries].sort(
    (a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime() ||
      a.entryNumber.localeCompare(b.entryNumber),
  );
  const rows: LedgerRow[] = [];
  let running = 0;
  for (const entry of sorted) {
    const mine = entry.lines.filter((l) => l.account === account);
    if (mine.length === 0) continue;
    const debitCents = mine.reduce((s, l) => s + l.debitCents, 0);
    const creditCents = mine.reduce((s, l) => s + l.creditCents, 0);
    running += debitCents - creditCents;
    rows.push({
      entryId: String(entry._id),
      entryNumber: entry.entryNumber,
      date: entry.date,
      text: entry.text,
      debitCents,
      creditCents,
      runningCents: running,
    });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/lib/accounting/__tests__/balances.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/lib/accounting/balances.ts src/server/lib/accounting/__tests__/balances.test.ts
git commit -m "feat(ledger): trial balance and account ledger aggregations"
```

---

### Task 5: Hook invoices and payments into the ledger

**Files:**
- Create: `src/server/lib/accounting/ledgerHooks.ts`, `src/server/routers/__tests__/helpers/ledgerFixtures.ts` (shared test helpers; not matched by the `*.test.ts` include)
- Modify: `src/server/routers/invoices.ts` (`markSent`, `markPaid`, `cancel`), `src/server/lib/reconcile.ts` (`applyPayment`, `reversePayment`)
- Test: `src/server/routers/__tests__/ledgerHooks.test.ts`

**Interfaces:**
- Consumes: `postOnce`, `reverse`, `findActiveBySource` (Task 3); `invoicePosting`, `paymentPosting`, `PostingLineInput` (Task 2); `trialBalance` (Task 4).
- Produces:
  - `postInvoiceEntry(args: { invoice: { _id: unknown; kind: string; invoiceNumber: string; customerNumber: number; invoiceDate?: Date | null }; lines: PostingLineInput[]; negate: boolean; createdBy: string })` → `{ entry, created }`. Source = `{ kind: 'invoice'|'credit_note', refId: String(invoice._id) }`.
  - `postPaymentEntry(args: { refId: string; date: Date; amountCents: number; text: string; createdBy: string })` → `{ entry, created }`. Source kind `'payment'`. `refId` is `bank:<fireflyJournalId>` for bank matches and `markPaid:<invoiceId>` for manual "mark paid".
  - `reversePaymentEntry(refId: string, reason: string, createdBy: string): Promise<void>` (no-op when nothing is active)
  - `safeLedger(label: string, fn: () => Promise<unknown>): Promise<void>` (never throws)

- [ ] **Step 1: Write the shared fixtures and the failing test**

`src/server/routers/__tests__/helpers/ledgerFixtures.ts` (also used by Task 6):

```ts
import mongoose from 'mongoose';
import type { TaskContext } from 'vitest';
import { appRouter } from '../../../trpc';
import { Account } from '../../../models/Account';
import { BankTransaction } from '../../../models/BankTransaction';
import { Client } from '../../../models/Client';
import { Counter } from '../../../models/Counter';
import { FiscalYear } from '../../../models/FiscalYear';
import { Invoice } from '../../../models/Invoice';
import { InvoiceLine } from '../../../models/InvoiceLine';
import { JournalEntry } from '../../../models/JournalEntry';
import { seedAccounts } from '../../../lib/accounting/seedAccounts';

export const INVOICE_DATE = new Date(2026, 2, 10);

export function skipIfNoDb(ctx: TaskContext): void {
  if (mongoose.connection.readyState !== 1) ctx.skip();
}

export function adminCaller() {
  return appRouter.createCaller({
    user: { sub: 'admin-id-1', email: 'admin@example.de', role: 'admin' },
    serviceAuth: false,
  });
}

export async function initLedgerModels(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([Account.init(), JournalEntry.init(), FiscalYear.init()]);
}

/** Empty every collection the ledger tests touch and re-seed SKR04. */
export async function resetLedgerDb(): Promise<void> {
  if (mongoose.connection.readyState !== 1) return;
  await Promise.all([
    Client.deleteMany({}),
    Invoice.deleteMany({}),
    InvoiceLine.deleteMany({}),
    BankTransaction.deleteMany({}),
    FiscalYear.deleteMany({}),
    Account.deleteMany({}),
    Counter.deleteMany({ _id: /^journal:/ }),
    JournalEntry.collection.deleteMany({}), // bypasses the immutability guard
  ]);
  await seedAccounts();
}

/** Client + draft with a rounding-sensitive line + a normal line, marked sent. */
export async function sentInvoice(
  caller: ReturnType<typeof adminCaller>,
  invoiceDate = INVOICE_DATE,
) {
  const client = await caller.clients.create({ name: 'Acme GmbH', invoiceAddress: 'Musterstr. 1' });
  const draft = await caller.invoices.createDraft({
    clientId: (client as any)._id.toString(),
    title: 'Beratung',
    servicePeriod: '03.2026',
  });
  const id = (draft as any)._id.toString();
  await caller.invoices.setLines({
    id,
    lines: [
      { position: '1', description: 'Beratung', quantity: 0.5, unitNetCents: 333, vatRate: 0.19 },
      { position: '2', description: 'Workshop', quantity: 1, unitNetCents: 10000, vatRate: 0.19 },
    ],
  });
  await caller.invoices.markSent({ id, invoiceDate });
  return (await Invoice.findById(id))!;
}
```

`src/server/routers/__tests__/ledgerHooks.test.ts`:

```ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { BankTransaction } from '../../models/BankTransaction';
import { FiscalYear } from '../../models/FiscalYear';
import { InvoiceLine } from '../../models/InvoiceLine';
import { JournalEntry } from '../../models/JournalEntry';
import { postInvoiceEntry } from '../../lib/accounting/ledgerHooks';
import { trialBalance } from '../../lib/accounting/balances';
import {
  INVOICE_DATE,
  adminCaller,
  initLedgerModels,
  resetLedgerDb,
  sentInvoice,
  skipIfNoDb,
} from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({
  enqueueFileInvoice: vi.fn(async (_invoiceId: string) => {}),
}));

beforeAll(initLedgerModels);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetLedgerDb();
});

describe('ledger hooks', () => {
  it('markSent posts one invoice entry whose 1200 debit equals the gross', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await sentInvoice(adminCaller());
    const entries = await JournalEntry.find({ 'source.kind': 'invoice' });
    expect(entries).toHaveLength(1);
    expect(entries[0].date.getTime()).toBe(INVOICE_DATE.getTime());
    const receivable = entries[0].lines.find((l) => l.account === '1200');
    expect(receivable?.debitCents).toBe(invoice.totals.grossCents);
  });

  it('a retried hook does not post twice', async (ctx) => {
    skipIfNoDb(ctx);
    const invoice = await sentInvoice(adminCaller());
    const lines = await InvoiceLine.find({ invoiceId: invoice._id });
    const again = await postInvoiceEntry({ invoice, lines, negate: false, createdBy: 't' });
    expect(again.created).toBe(false);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'invoice' })).toBe(1);
  });

  it('cancel posts a credit note that exactly mirrors the invoice', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    await caller.invoices.cancel({ id: invoice._id.toString(), reason: 'Fehler' });
    const entries = await JournalEntry.find({});
    expect(entries.map((e) => e.source.kind).sort()).toEqual(['credit_note', 'invoice']);
    const tb = trialBalance(entries);
    expect(tb.rows.every((r) => r.balanceCents === 0)).toBe(true);
  });

  it('bank assign posts a payment; unassign reverses it; reassign posts again', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const tx = await BankTransaction.create({
      fireflyJournalId: '77:0',
      date: new Date(2026, 3, 1),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    const bankTxId = tx._id.toString();
    await caller.bank.assign({ bankTxId, invoiceId: invoice._id.toString() });
    await caller.bank.unassign({ bankTxId });
    await caller.bank.assign({ bankTxId, invoiceId: invoice._id.toString() });

    const payments = await JournalEntry.find({ 'source.kind': 'payment' });
    expect(payments).toHaveLength(2);
    expect(payments.filter((p) => p.active)).toHaveLength(1);
    expect(await JournalEntry.countDocuments({ 'source.kind': 'reversal' })).toBe(1);

    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(0);
    expect(tb.rows.find((r) => r.account === '1800')?.balanceCents).toBe(
      invoice.totals.grossCents,
    );
  });

  it('markPaid posts the open amount as a markPaid payment', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    await caller.invoices.markPaid({ id: invoice._id.toString(), paidAt: new Date(2026, 3, 2) });
    const entry = await JournalEntry.findOne({
      'source.kind': 'payment',
      'source.refId': `markPaid:${invoice._id}`,
    });
    expect(entry?.lines[0]).toEqual({
      account: '1800',
      debitCents: invoice.totals.grossCents,
      creditCents: 0,
    });
  });

  it('markSent into a closed year still succeeds and posts nothing', async (ctx) => {
    skipIfNoDb(ctx);
    await FiscalYear.create({ year: 2025, status: 'closed' });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoice = await sentInvoice(adminCaller(), new Date(2025, 11, 20));
    expect(invoice.status).toBe('sent');
    expect(await JournalEntry.countDocuments()).toBe(0);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('[ledger]'), expect.anything());
    errors.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/routers/__tests__/ledgerHooks.test.ts`
Expected: FAIL — cannot resolve `../../lib/accounting/ledgerHooks`.

- [ ] **Step 3: Implement hooks** — `src/server/lib/accounting/ledgerHooks.ts`

```ts
import { findActiveBySource, postOnce, reverse } from './ledger';
import { invoicePosting, paymentPosting, type PostingLineInput } from './postingRules';

interface InvoiceForPosting {
  _id: unknown;
  kind: string;
  invoiceNumber: string;
  customerNumber: number;
  invoiceDate?: Date | null;
}

/**
 * Forderung an Erlös/USt for an issued invoice or credit note. For a credit
 * note pass the ORIGINAL invoice's lines with `negate: true`.
 */
export async function postInvoiceEntry(args: {
  invoice: InvoiceForPosting;
  lines: PostingLineInput[];
  negate: boolean;
  createdBy: string;
}) {
  const { invoice } = args;
  if (!invoice.invoiceDate) throw new Error(`Invoice ${invoice.invoiceNumber} has no invoiceDate`);
  const kind = invoice.kind === 'credit_note' ? 'credit_note' : 'invoice';
  const label = kind === 'credit_note' ? 'Stornorechnung' : 'Rechnung';
  return postOnce({
    date: invoice.invoiceDate,
    text: `${label} ${invoice.invoiceNumber} · Kd ${invoice.customerNumber}`,
    lines: invoicePosting(args.lines, { negate: args.negate }),
    source: { kind, refId: String(invoice._id) },
    createdBy: args.createdBy,
  });
}

/** Bank an Forderungen. refId: `bank:<fireflyJournalId>` or `markPaid:<invoiceId>`. */
export async function postPaymentEntry(args: {
  refId: string;
  date: Date;
  amountCents: number;
  text: string;
  createdBy: string;
}) {
  return postOnce({
    date: args.date,
    text: args.text,
    lines: paymentPosting(args.amountCents),
    source: { kind: 'payment', refId: args.refId },
    createdBy: args.createdBy,
  });
}

export async function reversePaymentEntry(
  refId: string,
  reason: string,
  createdBy: string,
): Promise<void> {
  const entry = await findActiveBySource('payment', refId);
  if (entry) await reverse(String(entry._id), { reason, createdBy });
}

/**
 * Ledger side effects must never fail invoice/bank CRUD: log and move on;
 * `admin.ledgerBackfill` posts whatever is missing.
 */
export async function safeLedger(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[ledger] ${label} failed — run admin.ledgerBackfill:`, (err as Error).message);
  }
}
```

- [ ] **Step 4: Wire into `src/server/routers/invoices.ts`**

Add the import:

```ts
import { postInvoiceEntry, postPaymentEntry, safeLedger } from '../lib/accounting/ledgerHooks';
```

In `markSent`, after `await invoice.save();` and before `await enqueueFileInvoice(...)`:

```ts
      await safeLedger(`invoice ${invoice.invoiceNumber}`, () =>
        postInvoiceEntry({ invoice, lines, negate: false, createdBy: ctx.user.sub }),
      );
```

In `markPaid`, change the handler signature to `async ({ input, ctx })` and, after `await invoice.save();`:

```ts
      const paidSoFar = invoice.payments.reduce((sum, p) => sum + p.amountCents, 0);
      const openCents = invoice.totals.grossCents - paidSoFar;
      if (invoice.kind === 'invoice' && openCents > 0) {
        await safeLedger(`markPaid ${invoice.invoiceNumber}`, () =>
          postPaymentEntry({
            refId: `markPaid:${invoice._id}`,
            date: invoice.paidAt!,
            amountCents: openCents,
            text: `Zahlung ${invoice.invoiceNumber} (manuell)`,
            createdBy: ctx.user.sub,
          }),
        );
      }
```

In `cancel`, change the handler signature to `async ({ input, ctx })` and, after the credit note's lines are inserted (before `enqueueFileInvoice(creditNote…)`):

```ts
      await safeLedger(`credit note ${creditNote.invoiceNumber}`, () =>
        postInvoiceEntry({ invoice: creditNote, lines, negate: true, createdBy: ctx.user.sub }),
      );
```

(`lines` is the original invoice's lines, already loaded in `cancel`.)

- [ ] **Step 5: Wire into `src/server/lib/reconcile.ts`**

Add the import:

```ts
import { postPaymentEntry, reversePaymentEntry, safeLedger } from './accounting/ledgerHooks';
```

At the end of `applyPayment`, after `await bankTx.save();`:

```ts
  await safeLedger(`payment ${bankTx.fireflyJournalId}`, () =>
    postPaymentEntry({
      refId: `bank:${bankTx.fireflyJournalId}`,
      date: bankTx.date,
      amountCents: bankTx.amountCents,
      text: `Zahlung ${invoice.invoiceNumber} · ${bankTx.counterpartyName ?? ''}`.trim(),
      createdBy: matchMethod === 'manual' ? 'admin' : 'reconcile',
    }),
  );
```

At the end of `reversePayment`, after `await invoice.save();`:

```ts
  await safeLedger(`unassign ${bankTxId}`, () =>
    reversePaymentEntry(`bank:${bankTxId}`, 'Zahlung zurückgenommen', 'admin'),
  );
```

- [ ] **Step 6: Run the new test and the existing suites it touches**

Run: `npx vitest run src/server/routers/__tests__/ledgerHooks.test.ts src/server/routers/__tests__/invoices.test.ts src/server/routers/__tests__/bank.test.ts src/server/routers/__tests__/reconcile.test.ts src/server/lib/__tests__/reconcile.test.ts`
Expected: PASS. If an existing test asserts `console.error` is not called, the hook may log because accounts are not seeded there. Seed them with `await seedAccounts()` in that file's `beforeAll` rather than silencing the log.

- [ ] **Step 7: Commit**

```bash
git add src/server/lib/accounting/ledgerHooks.ts src/server/routers/__tests__/helpers src/server/routers/invoices.ts src/server/lib/reconcile.ts src/server/routers/__tests__/ledgerHooks.test.ts
git commit -m "feat(ledger): post invoices, credit notes and payments automatically"
```

---

### Task 6: Ledger router + backfill

**Files:**
- Create: `src/server/routers/ledger.ts`, `src/server/lib/accounting/backfill.ts`
- Modify: `src/server/trpc.ts`, `src/server/routers/admin.ts`
- Test: `src/server/routers/__tests__/ledger.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - tRPC `ledger.list({ year, account? })` → entries sorted by `entryNumber`
  - `ledger.get({ id })`
  - `ledger.trialBalance({ year })` → `{ rows: (BalanceRow & { name: string })[]; debitCents; creditCents }`
  - `ledger.accountLedger({ year, account })` → `LedgerRow[]`
  - `ledger.fiscalYears()` → FiscalYear docs (desc)
  - `ledger.postManual({ kind: 'manual'|'opening', date, text, lines })` → entry. Opening is dated 01.01. of `date`'s year, refId `opening:<year>`, at most one active per year.
  - `ledger.reverse({ id, reason })` → `{ original, reversal }`. Only `manual` and `opening` entries; automatic ones are corrected through their source (cancel invoice, unassign payment).
  - `backfillLedger(year: number, opts: { dryRun: boolean; createdBy: string }): Promise<BackfillReport>` with `interface BackfillReport { invoices: number; creditNotes: number; payments: number; skipped: { ref: string; reason: string }[] }`
  - tRPC `admin.ledgerBackfill({ year, dryRun = true })` → `BackfillReport`

- [ ] **Step 1: Write the failing test** — `src/server/routers/__tests__/ledger.test.ts`

```ts
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { BankTransaction } from '../../models/BankTransaction';
import { JournalEntry } from '../../models/JournalEntry';
import { trialBalance } from '../../lib/accounting/balances';
import {
  adminCaller,
  initLedgerModels,
  resetLedgerDb,
  sentInvoice,
  skipIfNoDb,
} from './helpers/ledgerFixtures';

vi.mock('../../jobs/queue', () => ({
  enqueueFileInvoice: vi.fn(async (_invoiceId: string) => {}),
}));

beforeAll(initLedgerModels);

beforeEach(async () => {
  vi.clearAllMocks();
  await resetLedgerDb();
});

const opening = {
  kind: 'opening' as const,
  date: new Date(2026, 5, 1), // any date in the year → stored as 01.01.
  text: 'Eröffnungsbilanz',
  lines: [
    { account: '1800', debitCents: 50000, creditCents: 0 },
    { account: '2900', debitCents: 0, creditCents: 20000 },
    { account: '2970', debitCents: 0, creditCents: 30000 },
  ],
};

describe('ledger router', () => {
  it('postManual opening is dated 01.01. and only allowed once per year', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const entry = await caller.ledger.postManual(opening);
    expect(new Date(entry.date).getTime()).toBe(new Date(2026, 0, 1).getTime());
    await expect(caller.ledger.postManual(opening)).rejects.toThrowError(/Already posted/);
  });

  it('postManual rejects unbalanced input with BAD_REQUEST', async (ctx) => {
    skipIfNoDb(ctx);
    await expect(
      adminCaller().ledger.postManual({
        ...opening,
        kind: 'manual',
        lines: [
          { account: '1800', debitCents: 100, creditCents: 0 },
          { account: '2900', debitCents: 0, creditCents: 99 },
        ],
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('trialBalance includes account names and balances to zero', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.ledger.postManual(opening);
    await sentInvoice(caller);
    const tb = await caller.ledger.trialBalance({ year: 2026 });
    expect(tb.debitCents).toBe(tb.creditCents);
    expect(tb.rows.find((r) => r.account === '1800')?.name).toBe('Bank');
  });

  it('reverse is limited to manual/opening entries', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const manual = await caller.ledger.postManual({ ...opening, kind: 'manual' });
    await caller.ledger.reverse({ id: String(manual._id), reason: 'Tippfehler' });
    await sentInvoice(caller);
    const auto = await JournalEntry.findOne({ 'source.kind': 'invoice' });
    await expect(
      caller.ledger.reverse({ id: String(auto!._id), reason: 'x' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('accountLedger returns running balances for one account', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    await caller.ledger.postManual(opening);
    const rows = await caller.ledger.accountLedger({ year: 2026, account: '1800' });
    expect(rows).toHaveLength(1);
    expect(rows[0].runningCents).toBe(50000);
  });
});

describe('admin.ledgerBackfill', () => {
  it('re-posts missing entries idempotently; dry run writes nothing', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller);
    const tx = await BankTransaction.create({
      fireflyJournalId: '88:0',
      date: new Date(2026, 3, 1),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
    await JournalEntry.collection.deleteMany({}); // simulate hooks that never ran

    const dry = await caller.admin.ledgerBackfill({ year: 2026 });
    expect(dry).toMatchObject({ invoices: 1, payments: 1, skipped: [] });
    expect(await JournalEntry.countDocuments()).toBe(0);

    const real = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(real).toMatchObject({ invoices: 1, payments: 1 });
    const again = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(again).toMatchObject({ invoices: 0, creditNotes: 0, payments: 0 });
    const tb = trialBalance(await JournalEntry.find({}));
    expect(tb.rows.find((r) => r.account === '1200')?.balanceCents).toBe(0);
  });

  it('skips payments for invoices dated before the year instead of posting them', async (ctx) => {
    skipIfNoDb(ctx);
    const caller = adminCaller();
    const invoice = await sentInvoice(caller, new Date(2025, 11, 15));
    const tx = await BankTransaction.create({
      fireflyJournalId: '99:0',
      date: new Date(2026, 0, 10),
      amountCents: invoice.totals.grossCents,
      description: 'Zahlung',
    });
    await caller.bank.assign({ bankTxId: tx._id.toString(), invoiceId: invoice._id.toString() });
    await JournalEntry.collection.deleteMany({});

    const report = await caller.admin.ledgerBackfill({ year: 2026, dryRun: false });
    expect(report.payments).toBe(0);
    expect(report.skipped).toEqual([
      { ref: invoice.invoiceNumber, reason: expect.stringContaining('before 2026') },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/routers/__tests__/ledger.test.ts`
Expected: FAIL — `caller.ledger` is undefined.

- [ ] **Step 3: Implement backfill** — `src/server/lib/accounting/backfill.ts`

```ts
import { Invoice } from '../../models/Invoice';
import { InvoiceLine } from '../../models/InvoiceLine';
import { findActiveBySource } from './ledger';
import { postInvoiceEntry, postPaymentEntry } from './ledgerHooks';

export interface BackfillReport {
  invoices: number;
  creditNotes: number;
  payments: number;
  skipped: { ref: string; reason: string }[];
}

/**
 * Post every invoice/credit-note/payment entry of `year` that is missing.
 * Idempotent. A payment for an invoice dated before the year needs an opening
 * Forderung the backfill cannot see → listed in `skipped` for manual booking.
 */
export async function backfillLedger(
  year: number,
  opts: { dryRun: boolean; createdBy: string },
): Promise<BackfillReport> {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const report: BackfillReport = { invoices: 0, creditNotes: 0, payments: 0, skipped: [] };

  const issued = await Invoice.find({
    status: { $in: ['sent', 'paid', 'canceled'] },
    invoiceDate: { $gte: start, $lt: end },
  }).sort({ invoiceDate: 1, invoiceNumber: 1 });

  for (const invoice of issued) {
    const kind = invoice.kind === 'credit_note' ? 'credit_note' : 'invoice';
    if (await findActiveBySource(kind, String(invoice._id))) continue;
    // A credit note mirrors its original exactly; without `cancels` post its own (negative) lines.
    const negate = kind === 'credit_note' && !!invoice.cancels;
    const lines = await InvoiceLine.find({ invoiceId: negate ? invoice.cancels : invoice._id });
    try {
      if (!opts.dryRun) {
        await postInvoiceEntry({ invoice, lines, negate, createdBy: opts.createdBy });
      }
      if (kind === 'credit_note') report.creditNotes += 1;
      else report.invoices += 1;
    } catch (err) {
      report.skipped.push({ ref: invoice.invoiceNumber, reason: (err as Error).message });
    }
  }

  const paid = await Invoice.find({
    $or: [
      { 'payments.date': { $gte: start, $lt: end } },
      { status: 'paid', payments: { $size: 0 }, paidAt: { $gte: start, $lt: end } },
    ],
  }).sort({ paidAt: 1 });

  for (const invoice of paid) {
    const candidates =
      invoice.payments.length > 0
        ? invoice.payments
            .filter((p) => p.date >= start && p.date < end)
            .map((p) => ({ refId: `bank:${p.bankTxId}`, date: p.date, amountCents: p.amountCents }))
        : invoice.importedPaid
          ? []
          : [
              {
                refId: `markPaid:${invoice._id}`,
                date: invoice.paidAt!,
                amountCents: invoice.totals.grossCents,
              },
            ];

    for (const c of candidates) {
      if (await findActiveBySource('payment', c.refId)) continue;
      if (!invoice.invoiceDate || invoice.invoiceDate < start) {
        report.skipped.push({
          ref: invoice.invoiceNumber,
          reason: `invoice dated before ${year}: needs an opening Forderung — book manually`,
        });
        continue;
      }
      try {
        if (!opts.dryRun) {
          await postPaymentEntry({
            ...c,
            text: `Zahlung ${invoice.invoiceNumber}`,
            createdBy: opts.createdBy,
          });
        }
        report.payments += 1;
      } catch (err) {
        report.skipped.push({ ref: invoice.invoiceNumber, reason: (err as Error).message });
      }
    }
  }

  return report;
}
```

- [ ] **Step 4: Implement the router** — `src/server/routers/ledger.ts`

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, adminProcedure } from '../trpcInit';
import { Account } from '../models/Account';
import { FiscalYear } from '../models/FiscalYear';
import { JournalEntry } from '../models/JournalEntry';
import { LedgerError, post, reverse } from '../lib/accounting/ledger';
import { accountLedger, trialBalance } from '../lib/accounting/balances';

const REVERSIBLE_KINDS = new Set(['manual', 'opening']);

const lineInput = z.object({
  account: z.string().regex(/^\d{4,5}$/),
  debitCents: z.number().int().min(0),
  creditCents: z.number().int().min(0),
});

/** LedgerError → TRPCError so the UI gets a readable message and status. */
async function mapLedgerErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof LedgerError) {
      const code: 'NOT_FOUND' | 'CONFLICT' | 'BAD_REQUEST' =
        err.code === 'NOT_FOUND' ? 'NOT_FOUND' : err.code === 'DUPLICATE' ? 'CONFLICT' : 'BAD_REQUEST';
      throw new TRPCError({ code, message: err.message });
    }
    throw err;
  }
}

const yearInput = z.number().int().min(2000).max(2100);

export const ledgerRouter = router({
  fiscalYears: adminProcedure.query(async () => FiscalYear.find({}).sort({ year: -1 })),

  list: adminProcedure
    .input(z.object({ year: yearInput, account: z.string().optional() }))
    .query(async ({ input }) =>
      JournalEntry.find({
        fiscalYear: input.year,
        ...(input.account ? { 'lines.account': input.account } : {}),
      }).sort({ entryNumber: 1 }),
    ),

  get: adminProcedure.input(z.object({ id: z.string().min(1) })).query(async ({ input }) => {
    const entry = await JournalEntry.findById(input.id);
    if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
    return entry;
  }),

  trialBalance: adminProcedure.input(z.object({ year: yearInput })).query(async ({ input }) => {
    const [entries, accounts] = await Promise.all([
      JournalEntry.find({ fiscalYear: input.year }).select('lines'),
      Account.find({}).select('number name'),
    ]);
    const names = new Map(accounts.map((a) => [a.number, a.name]));
    const tb = trialBalance(entries);
    return { ...tb, rows: tb.rows.map((r) => ({ ...r, name: names.get(r.account) ?? '' })) };
  }),

  accountLedger: adminProcedure
    .input(z.object({ year: yearInput, account: z.string().min(1) }))
    .query(async ({ input }) => {
      const entries = await JournalEntry.find({
        fiscalYear: input.year,
        'lines.account': input.account,
      });
      return accountLedger(input.account, entries);
    }),

  postManual: adminProcedure
    .input(
      z.object({
        kind: z.enum(['manual', 'opening']),
        date: z.coerce.date(),
        text: z.string().min(1),
        lines: z.array(lineInput).min(2),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      mapLedgerErrors(() => {
        const year = input.date.getFullYear();
        const opening = input.kind === 'opening';
        return post({
          date: opening ? new Date(year, 0, 1) : input.date,
          text: input.text,
          lines: input.lines,
          source: opening ? { kind: 'opening', refId: `opening:${year}` } : { kind: 'manual' },
          createdBy: ctx.user.sub,
        });
      }),
    ),

  reverse: adminProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const entry = await JournalEntry.findById(input.id);
      if (!entry) throw new TRPCError({ code: 'NOT_FOUND', message: 'Journal entry not found' });
      if (!REVERSIBLE_KINDS.has(entry.source.kind)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Automatic entries are corrected at their source (Storno, Zahlung lösen)',
        });
      }
      return mapLedgerErrors(() =>
        reverse(input.id, { reason: input.reason, createdBy: ctx.user.sub }),
      );
    }),
});
```

> If a `DUPLICATE` maps to `CONFLICT`, the opening test's `/Already posted/` message assertion still holds.

`src/server/trpc.ts`: `import { ledgerRouter } from './routers/ledger';` and `ledger: ledgerRouter,`.

`src/server/routers/admin.ts`: add `import { backfillLedger } from '../lib/accounting/backfill';` and inside `adminRouter`:

```ts
  /** Post invoice/payment entries the hooks missed. Dry run by default. */
  ledgerBackfill: adminProcedure
    .input(z.object({ year: z.number().int().min(2000).max(2100), dryRun: z.boolean().default(true) }))
    .mutation(async ({ input, ctx }) =>
      backfillLedger(input.year, { dryRun: input.dryRun, createdBy: ctx.user.sub }),
    ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/server/routers/__tests__/ledger.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/server/routers/ledger.ts src/server/lib/accounting/backfill.ts src/server/routers/admin.ts src/server/trpc.ts src/server/routers/__tests__/ledger.test.ts
git commit -m "feat(ledger): ledger router, manual/opening entries and backfill"
```

---

### Task 7: Buchhaltung page (Journal, Saldenliste, Konto, entry form)

**Files:**
- Create: `src/client/lib/entryForm.ts`, `src/client/pages/LedgerPage.tsx`
- Modify: `src/client/main.tsx`, `src/client/components/Navigation.tsx`
- Test: `src/client/__tests__/entryForm.test.ts`

**Interfaces:**
- Consumes: tRPC `ledger.*`, `accounts.list` (Tasks 1, 6); `parseGermanAmount` (`src/server/lib/money.ts`); `formatEUR`, `formatDate` (`src/client/lib/format.ts`).
- Produces:
  - `interface EntryFormRow { account: string; debit: string; credit: string }`
  - `toEntryLines(rows: EntryFormRow[]): { lines: { account: string; debitCents: number; creditCents: number }[]; debitCents: number; creditCents: number; errors: string[] }`. Blank rows are skipped; a row with both or neither side or an unparseable amount yields an error naming the row (1-based).

- [ ] **Step 1: Write the failing test** — `src/client/__tests__/entryForm.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { toEntryLines } from '../lib/entryForm';

describe('toEntryLines', () => {
  it('parses German amounts and totals both sides', () => {
    const r = toEntryLines([
      { account: '1800', debit: '1.234,50', credit: '' },
      { account: '2900', debit: '', credit: '1234,5' },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual([
      { account: '1800', debitCents: 123450, creditCents: 0 },
      { account: '2900', debitCents: 0, creditCents: 123450 },
    ]);
    expect(r.debitCents).toBe(123450);
    expect(r.creditCents).toBe(123450);
  });

  it('skips blank rows', () => {
    const r = toEntryLines([{ account: '', debit: '', credit: '' }]);
    expect(r).toEqual({ lines: [], debitCents: 0, creditCents: 0, errors: [] });
  });

  it('reports rows with both sides, no side, bad amounts or no account', () => {
    const r = toEntryLines([
      { account: '1800', debit: '1', credit: '1' },
      { account: '1800', debit: '', credit: '' },
      { account: '1800', debit: 'abc', credit: '' },
      { account: '', debit: '5', credit: '' },
    ]);
    expect(r.errors).toEqual([
      'Zeile 1: entweder Soll oder Haben',
      'Zeile 2: Betrag fehlt',
      'Zeile 3: Betrag „abc“ ungültig',
      'Zeile 4: Konto fehlt',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/client/__tests__/entryForm.test.ts`
Expected: FAIL — cannot resolve `../lib/entryForm`.

- [ ] **Step 3: Implement** — `src/client/lib/entryForm.ts`

```ts
import { parseGermanAmount } from '../../server/lib/money';

export interface EntryFormRow {
  account: string;
  debit: string;
  credit: string;
}

export interface EntryLine {
  account: string;
  debitCents: number;
  creditCents: number;
}

/** Form rows → ledger lines + running totals; errors name the 1-based row. */
export function toEntryLines(rows: EntryFormRow[]): {
  lines: EntryLine[];
  debitCents: number;
  creditCents: number;
  errors: string[];
} {
  const lines: EntryLine[] = [];
  const errors: string[] = [];
  let debitCents = 0;
  let creditCents = 0;

  rows.forEach((row, i) => {
    const n = i + 1;
    const account = row.account.trim();
    const debit = row.debit.trim();
    const credit = row.credit.trim();
    if (!account && !debit && !credit) return;
    if (!account) return void errors.push(`Zeile ${n}: Konto fehlt`);
    if (debit && credit) return void errors.push(`Zeile ${n}: entweder Soll oder Haben`);
    if (!debit && !credit) return void errors.push(`Zeile ${n}: Betrag fehlt`);
    const raw = debit || credit;
    let cents: number;
    try {
      cents = parseGermanAmount(raw);
    } catch {
      return void errors.push(`Zeile ${n}: Betrag „${raw}“ ungültig`);
    }
    if (cents <= 0) return void errors.push(`Zeile ${n}: Betrag muss positiv sein`);
    if (debit) {
      lines.push({ account, debitCents: cents, creditCents: 0 });
      debitCents += cents;
    } else {
      lines.push({ account, debitCents: 0, creditCents: cents });
      creditCents += cents;
    }
  });

  return { lines, debitCents, creditCents, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/client/__tests__/entryForm.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Build the page** — `src/client/pages/LedgerPage.tsx`

Follow `ReportsPage.tsx` / `BankPage.tsx` markup and classes (`page-head`, `card flush`, `card-head`, `table-wrap`, `table.resp` with `data-l`, `btn`, `btn ghost`, `num`, `right`, `empty`) and `useToast` from `../components/Toast` for feedback.

```tsx
import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { toEntryLines, type EntryFormRow } from '../lib/entryForm';

type Tab = 'journal' | 'balances' | 'account';

const KIND_LABEL: Record<string, string> = {
  opening: 'Eröffnung',
  invoice: 'Rechnung',
  credit_note: 'Storno-RE',
  payment: 'Zahlung',
  manual: 'Manuell',
  reversal: 'Storno',
};

const emptyRows = (): EntryFormRow[] => [
  { account: '', debit: '', credit: '' },
  { account: '', debit: '', credit: '' },
];

interface EntryRow {
  _id: string;
  entryNumber: string;
  date: string;
  text: string;
  active: boolean;
  source: { kind: string };
  lines: { account: string; debitCents: number; creditCents: number }[];
}

function EntryForm({ year, onDone }: { year: number; onDone: () => void }) {
  const toast = useToast();
  const utils = trpc.useUtils();
  const accounts = trpc.accounts.list.useQuery();
  const postManual = trpc.ledger.postManual.useMutation();
  const [kind, setKind] = useState<'manual' | 'opening'>('manual');
  const [date, setDate] = useState(`${year}-01-01`);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<EntryFormRow[]>(emptyRows);
  const parsed = useMemo(() => toEntryLines(rows), [rows]);
  const balanced = parsed.debitCents === parsed.creditCents && parsed.debitCents > 0;

  function update(i: number, patch: Partial<EntryFormRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    try {
      // Parse <input type="date"> as a LOCAL date — new Date('YYYY-MM-DD') would be UTC midnight.
      const [y, m, d] = date.split('-').map(Number);
      await postManual.mutateAsync({ kind, date: new Date(y, m - 1, d), text, lines: parsed.lines });
      await utils.ledger.invalidate();
      toast.show('Buchung erfasst.');
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Buchung erfassen</h2>
      </div>
      <div className="form-grid">
        <label>
          Art
          <select value={kind} onChange={(e) => setKind(e.target.value as 'manual' | 'opening')}>
            <option value="manual">Manuelle Buchung</option>
            <option value="opening">Eröffnungsbilanz (01.01.)</option>
          </select>
        </label>
        <label>
          Datum
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={kind === 'opening'} />
        </label>
        <label className="span-2">
          Buchungstext
          <input value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </div>
      <datalist id="ledger-accounts">
        {(accounts.data ?? []).map((a) => (
          <option key={a.number} value={a.number}>{`${a.number} ${a.name}`}</option>
        ))}
      </datalist>
      <table className="resp">
        <thead>
          <tr>
            <th>Konto</th>
            <th className="right">Soll</th>
            <th className="right">Haben</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td data-l="Konto">
                <input list="ledger-accounts" value={row.account} onChange={(e) => update(i, { account: e.target.value })} />
              </td>
              <td data-l="Soll" className="right">
                <input inputMode="decimal" value={row.debit} onChange={(e) => update(i, { debit: e.target.value })} />
              </td>
              <td data-l="Haben" className="right">
                <input inputMode="decimal" value={row.credit} onChange={(e) => update(i, { credit: e.target.value })} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>
              <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, { account: '', debit: '', credit: '' }])}>
                + Zeile
              </button>
            </td>
            <td className="num right">{formatEUR(parsed.debitCents)}</td>
            <td className="num right">{formatEUR(parsed.creditCents)}</td>
          </tr>
        </tfoot>
      </table>
      {parsed.errors.map((e) => (
        <p key={e} className="form-error">{e}</p>
      ))}
      {!balanced && parsed.errors.length === 0 && parsed.lines.length > 0 ? (
        <p className="form-error">Soll und Haben sind nicht ausgeglichen.</p>
      ) : null}
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onDone}>Abbrechen</button>
        <button
          type="button"
          className="btn"
          disabled={!balanced || parsed.errors.length > 0 || !text.trim() || postManual.isPending}
          onClick={submit}
        >
          Buchen
        </button>
      </div>
    </section>
  );
}

export function LedgerPage() {
  const toast = useToast();
  const utils = trpc.useUtils();
  const [year, setYear] = useState(new Date().getFullYear());
  const [tab, setTab] = useState<Tab>('journal');
  const [account, setAccount] = useState('1800');
  const [showForm, setShowForm] = useState(false);
  const fiscalYears = trpc.ledger.fiscalYears.useQuery();
  const journal = trpc.ledger.list.useQuery({ year }, { enabled: tab === 'journal' });
  const balances = trpc.ledger.trialBalance.useQuery({ year }, { enabled: tab === 'balances' });
  const ledger = trpc.ledger.accountLedger.useQuery({ year, account }, { enabled: tab === 'account' });
  const reverse = trpc.ledger.reverse.useMutation();

  const years = useMemo(() => {
    const set = new Set([new Date().getFullYear(), ...(fiscalYears.data ?? []).map((f) => f.year)]);
    return [...set].sort((a, b) => b - a);
  }, [fiscalYears.data]);

  async function doReverse(id: string) {
    const reason = window.prompt('Grund für die Stornobuchung?');
    if (!reason) return;
    try {
      await reverse.mutateAsync({ id, reason });
      await utils.ledger.invalidate();
      toast.show('Storniert.');
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const entries = (journal.data ?? []) as unknown as EntryRow[];

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Buchhaltung</h1>
          <p className="page-sub">Journal, Summen- und Saldenliste, Kontoblatt (SKR04)</p>
        </div>
        <div className="actions">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Geschäftsjahr">
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setShowForm(true)}>Buchung erfassen</button>
        </div>
      </header>

      {showForm ? <EntryForm year={year} onDone={() => setShowForm(false)} /> : null}

      <nav className="chips" aria-label="Ansicht">
        {(['journal', 'balances', 'account'] as Tab[]).map((t) => (
          <button key={t} type="button" className={tab === t ? 'chip on' : 'chip'} onClick={() => setTab(t)}>
            {t === 'journal' ? 'Journal' : t === 'balances' ? 'Saldenliste' : 'Konto'}
          </button>
        ))}
      </nav>

      {tab === 'journal' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Datum</th>
                  <th>Text</th>
                  <th>Art</th>
                  <th>Buchungen</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e._id} className={e.active ? '' : 'muted'}>
                    <td data-l="Nr." className="num">{e.entryNumber}</td>
                    <td data-l="Datum" className="num">{formatDate(e.date)}</td>
                    <td data-l="Text" className="w">{e.text}</td>
                    <td data-l="Art">{KIND_LABEL[e.source.kind] ?? e.source.kind}</td>
                    <td data-l="Buchungen" className="num">
                      {e.lines.map((l) => (
                        <div key={`${l.account}-${l.debitCents}-${l.creditCents}`}>
                          {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
                        </div>
                      ))}
                    </td>
                    <td>
                      {e.active && (e.source.kind === 'manual' || e.source.kind === 'opening') ? (
                        <button type="button" className="btn ghost" onClick={() => doReverse(e._id)}>Stornieren</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length === 0 ? <p className="empty">Keine Buchungen in {year}.</p> : null}
        </section>
      ) : null}

      {tab === 'balances' ? (
        <section className="card flush">
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Bezeichnung</th>
                  <th className="right">Soll</th>
                  <th className="right">Haben</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(balances.data?.rows ?? []).map((r) => (
                  <tr key={r.account}>
                    <td data-l="Konto" className="num">
                      <button type="button" className="link" onClick={() => { setAccount(r.account); setTab('account'); }}>{r.account}</button>
                    </td>
                    <td data-l="Bezeichnung" className="w">{r.name}</td>
                    <td data-l="Soll" className="num right">{formatEUR(r.debitCents)}</td>
                    <td data-l="Haben" className="num right">{formatEUR(r.creditCents)}</td>
                    <td data-l="Saldo" className="num right">
                      {formatEUR(Math.abs(r.balanceCents))} {r.balanceCents >= 0 ? 'S' : 'H'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Summe</td>
                  <td className="num right">{formatEUR(balances.data?.debitCents ?? 0)}</td>
                  <td className="num right">{formatEUR(balances.data?.creditCents ?? 0)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'account' ? (
        <section className="card flush">
          <div className="card-head">
            <h2>Kontoblatt {account}</h2>
            <input value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Konto" style={{ width: '6rem' }} />
          </div>
          <div className="table-wrap">
            <table className="resp">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Nr.</th>
                  <th>Text</th>
                  <th className="right">Soll</th>
                  <th className="right">Haben</th>
                  <th className="right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {(ledger.data ?? []).map((r) => (
                  <tr key={r.entryId}>
                    <td data-l="Datum" className="num">{formatDate(r.date)}</td>
                    <td data-l="Nr." className="num">{r.entryNumber}</td>
                    <td data-l="Text" className="w">{r.text}</td>
                    <td data-l="Soll" className="num right">{r.debitCents ? formatEUR(r.debitCents) : ''}</td>
                    <td data-l="Haben" className="num right">{r.creditCents ? formatEUR(r.creditCents) : ''}</td>
                    <td data-l="Saldo" className="num right">{formatEUR(r.runningCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(ledger.data ?? []).length === 0 ? <p className="empty">Keine Buchungen auf {account}.</p> : null}
        </section>
      ) : null}
    </>
  );
}
```

> Before writing, grep `src/client/index.css` for `.chip`, `.form-grid`, `.form-error`, `.actions`, `.muted`, `.link`. Reuse whichever exist. For a missing one, add a minimal rule next to the closest existing component style, using existing CSS variables only.

- [ ] **Step 6: Route + navigation**

`src/client/main.tsx`: `import { LedgerPage } from './pages/LedgerPage';` and inside the protected routes, after `/bank`:

```tsx
                <Route path="/ledger" element={<LedgerPage />} />
```

`src/client/components/Navigation.tsx`: extend `IconName` with `'ledger'`, add to `ICON_PATHS`:

```tsx
  ledger: <path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16" />,
```

and insert into `NAV_ITEMS` before `/reports`:

```ts
  { to: '/ledger', label: 'Buchhaltung', short: 'Buchh.', icon: 'ledger' },
```

- [ ] **Step 7: Verify the build and run the app once**

Run: `npm run typecheck && npm run lint && npx vitest run src/client`
Expected: PASS.
Then run the `run` skill (or `npm run dev`): log in, open `/ledger`, post a small opening entry (made-up numbers), check that Journal, Saldenliste (Summe Soll = Haben) and Kontoblatt 1800 show it, and that the mobile tab bar (≤ 760 px) still fits 6 items.

- [ ] **Step 8: Commit**

```bash
git add src/client/lib/entryForm.ts src/client/__tests__/entryForm.test.ts src/client/pages/LedgerPage.tsx src/client/main.tsx src/client/components/Navigation.tsx src/client/index.css
git commit -m "feat(ui): Buchhaltung page with journal, trial balance, account ledger and entry form"
```

---

### Task 8: Invariants doc, full verification, PR

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add ledger invariants to `AGENTS.md`** under "Invariants (enforce in code, do not relax)":

```markdown
- **Ledger (SKR04, double-entry):** `lib/accounting/ledger.ts` (`post`/`postOnce`/`reverse`) is the only write path for `JournalEntry`. Entries are never updated or deleted (model guards enforce it); corrections are reversals. Σ Soll = Σ Haben per entry, gapless `YYYY-NNNNN` numbers per fiscal year, no postings into a `closed` FiscalYear.
- **Automatic postings** (invoice/credit note on `markSent`/`cancel`, payment on assign/`markPaid`, reversal on unassign) go through `ledgerHooks.ts` wrapped in `safeLedger` — they never fail invoice/bank CRUD; `admin.ledgerBackfill` repairs gaps. Credit notes post from the ORIGINAL invoice's lines with `negate`.
- **No company figures in git** — opening balances and real amounts are entered in the UI only.
```

- [ ] **Step 2: Full verification**

Run: `npm run lint && npm run typecheck && npm run typecheck:server && npm test`
Expected: all green. Paste the summary line (tests passed / files) into the PR description.

- [ ] **Step 3: Commit and open the PR**

```bash
git add AGENTS.md
git commit -m "docs: ledger invariants"
git push -u origin HEAD
gh pr create --title "feat: ledger foundation (accounting phase 1)" --body "<summary of tasks 1–7, verification output, link to docs/plans/2026-10-07-accounting.md>"
```

- [ ] **Step 4: servyy-test (after merge + release, per AGENTS.md)**

Deploy with `ansible ./servyy-test.sh`, then on servyy-test: `/health` ok; `/ledger` loads; accounts seeded; `admin.ledgerBackfill({year: 2026})` dry run shows the expected counts and lists the pre-2026 payments in `skipped`; then run with `dryRun:false`; trial balance Soll = Haben. The real opening entry is entered by the user (not by the agent). Production only with explicit approval.
