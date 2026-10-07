# queen — Buchhaltung + Jahresabschluss (design spec)

> Status: design approved 2026-10-07. Task-level plans are written per phase (Phase 1 first).
> Public repo: this document contains **no company figures**. Real balances, amounts and tax results live only in Mongo/Drive.

## Goal

Extend queen from invoicing + bank reconcile to a **double-entry ledger** for bumbleflies, starting with fiscal year 2026. It should produce the **prepared year-end closing** (Bilanz, GuV, Kontennachweis, tax provisions) plus exports for the tax tool/advisor. Official filing (ELSTER, E-Bilanz, Bundesanzeiger) stays external.

## Facts that drive the design

- Legal form: UG (haftungsbeschränkt), treated as GmbH; **Kleinstkapitalgesellschaft** (§267a HGB) → no Anhang/Lagebericht, Bilanz short form (§266(1) S.4), GuV short form (§275(5)), Gesamtkostenverfahren.
- Fiscal year = calendar year. Chart of accounts = **SKR04**. One bank account (GLS, via Firefly) is effectively the only asset.
- USt: **Sollversteuerung** (vereinbarte Entgelte). The VA frequency depends on the prior year's tax (exemption ≤ 1.000 €, quarterly/monthly above that) → a per-year setting.
- Year-end tax calc (UG): taxable income = Jahresüberschuss + booked non-deductible KSt/Soli/GewSt; KSt 15%; Soli 5.5% of KSt; GewSt = Gewerbeertrag floored to 100 € × 3.5% Messzahl (floored to €) × Hebesatz (München 490%); provision = tax − Vorauszahlungen.
- §5a(3) GmbHG: 25% of (Jahresüberschuss − Verlustvortrag) goes to the gesetzliche Rücklage until the Stammkapital reaches 25.000 €.
- Receipts naming (existing convention): `YYYYMMDD - <Kreditornr> - <Name> - <Was>.pdf`, Kreditor numbers 70000–99999, Debitor numbers 10000–69999 (= queen `customerNumber`).

## Decisions

| # | Decision |
|---|----------|
| A1 | Output = prepared Bilanz/GuV/Kontennachweis + tax-provision calc + exports; filing stays external |
| A2 | Expenses are bank-driven: sync **all** GLS transactions, book each to an SKR04 account, receipt PDF linked from Drive |
| A3 | Books start 01.01.2026 with an opening entry taken from the 2025 closing (entered in the UI, not seeded) |
| A4 | Double-entry journal: immutable entries, corrections only by reversal (GoBD), reports are pure aggregations, trial balance always 0 |
| A5 | Accrual basis: invoice `markSent` posts Forderung/Erlös/USt on the invoice date (matches Sollversteuerung) |
| A6 | No company figures in git: opening balances and real amounts only via UI/admin; tests use anonymised numbers |

## Data model (new Mongo models)

```ts
Account {
  number: string            // SKR04, unique
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  vatRate?: number          // revenue/VSt/USt accounts
  vatKz?: string            // USt-VA Kennzahl
  bilanzPos?: string        // short-form Bilanz line
  guvPos?: string           // §275(5) GuV line
  archived: boolean
}

JournalEntry {
  entryNumber: string       // 'YYYY-NNNNN', gapless per FY via Counter('journal:YYYY')
  date: Date; fiscalYear: number
  text: string
  lines: [{ account: string, debitCents: number, creditCents: number }]
  source: { kind: 'opening'|'invoice'|'credit_note'|'payment'|'bank'|'manual'
                  |'vat_close'|'tax_provision'|'appropriation'|'closing', refId?: string }
  receipt?: { driveFileId, fileName, link }
  reverses?: ObjectId; reversedBy?: ObjectId
  createdBy: string
}
// unique partial index (source.kind, source.refId) where reversedBy absent → idempotent auto-posting

Supplier {
  kreditorNumber: number    // Counter('supplier'), from 70000
  name: string
  ibans: string[]
  matchers: string[]        // substring match on counterparty/description
  defaultAccount?: string; defaultVatRate?: number
}

FiscalYear {
  year: number
  status: 'open' | 'closing' | 'closed'
  vatMethod: 'soll'
  vatPeriod: 'quarter' | 'month' | 'year'
  hebesatz: number
  closedAt?: Date; taxCalc?: object; snapshot?: object
}

VatReturn { year, period, kz81, kz86, kz48, kz66, kz83, filedAt? }

BankTransaction (existing) += direction: 'in' | 'out' (default 'in'), journalEntryId?
```

## Core libraries (`src/server/lib/accounting/`, pure + TDD)

- `skr04.ts`: seed list of the accounts in use (generic SKR04, no figures): 1200, 1401, 1406, 1800, 2900, 2930, 2970, 2978, 3020, 3035, 3040, 3300, 3500, 3501, 3801, 3806, 3820, 3840, 3841, 4110, 4300, 4400, 4930, 6260, 6300, 6420, 6600, 6640, 6820, 6821, 6837, 6855, 6960, 7600, 7608, 7610, 7641, 9000.
- `postingRules.ts`: domain event → balanced lines.
  - invoice sent: S 1200 gross / H revenue net per rate (4400 19%, 4300 7%, 4110 0% with exemption note) / H USt (3806, 3801). A credit note mirrors it.
  - payment matched: S 1800 / H 1200.
  - bank booking out: S expense net + S VSt (1406/1401) / H 1800. The gross → net split is half-up and reuses `lineVatCents` from `lib/money.ts`.
  - bank booking in (non-invoice): S 1800 / H chosen account.
- `ledger.ts`: `post()` asserts Σdebit = Σcredit > 0, known non-archived accounts, and that the FY is open and the date is inside it. It allocates the number. `reverse(id, reason)` posts the mirror entry and links both. These are the only write paths; nothing is ever updated or deleted.
- `balances.ts`: Summen- und Saldenliste, Kontoblatt, GuV §275(5) (Umsatzerlöse, sonstige Erträge, Abschreibungen, sonstige Aufwendungen, Steuern, Jahresüberschuss), Bilanz (Umlaufvermögen / Eigenkapital, Rückstellungen, Verbindlichkeiten), Kontennachweis with prior-year column.
- `vat.ts`: VA figures per period under Soll (Kz 81/86 bases floored to €, 48 steuerfrei, 66 VSt, 83 Zahllast).
- `taxProvision.ts`: inputs (Jahresüberschuss, booked KSt/Soli/GewSt Vorauszahlungen, Hebesatz) → taxable income, KSt, Soli (cent-exact), Gewerbeertrag (floored to 100), Messbetrag (floored to €), GewSt, provisions per tax. Uses official rounding.
- `appropriation.ts`: §5a(3) GmbHG Rücklage on the **final** Jahresüberschuss minus Verlustvortrag; stops once the Stammkapital reaches 25.000 €; the UI shows the basis.

## Integration with existing flows

- `services/FireflyClient.ts`: add `fetchTransactions(start, end)` for deposits and withdrawals; the sign maps to `direction`. `lib/bankSync.ts` switches to it. `lib/reconcile.ts` keeps matching `direction: 'in'` only.
- `routers/invoices.ts` (`markSent`, `cancel`) and `lib/reconcile.ts` (assign → post payment, `reversePayment` → reverse) call the ledger. A ledger failure is recorded and picked up by backfill. It never blocks invoice CRUD (same pattern as Firefly errors).
- `admin.ledgerBackfill { year }`: idempotently posts missing invoice/payment entries. Payments for invoices dated before the opening date without an opening Forderung are listed for a manual decision.
- Receipts: Drive folder `QUEEN_RECEIPTS_FOLDER_ID` (year/month subfolders), listed via the existing `DriveService` client and the `driveLookup.ts` pattern. The filename is parsed to suggest date/supplier. queen only links the file.

## API + UI

- tRPC routers (`adminProcedure`): `accounts`, `ledger` (list, get, postManual, reverse, opening), `bookings` (unbooked bank tx, suggest, book), `suppliers`, `vat` (periods, figures, markFiled), `closing` (checks, taxCalc, post step, lock, exports).
- Pages: **Buchen** (bank-tx inbox, supplier-rule suggestion, receipt picker, nav badge), **Journal** (entries, Kontoblatt, SuSa), **USt** (periods, ELSTER-ready figures, mark filed, Finanzamt payment), **Abschluss/:year** wizard. Mobile-first, existing styles.

## Jahresabschluss wizard (per FY)

1. **Checks:** no unbooked bank tx; receipts missing (or marked "kein Beleg" with a reason); ledger 1800 = Firefly GLS balance at 31.12; open Forderungen; VA periods filed.
2. **Accruals:** manual entries (e.g. 3300 Verbindlichkeiten LuL).
3. **USt close:** 1401/1406/3801/3806/3820 → 3840 / 3501.
4. **Tax provisions:** `taxProvision` → review → post S 7600/7608/7610 / H 3040/3020/3035.
5. **Ergebnisverwendung:** Rücklage entry; Bilanzgewinn shown.
6. **Lock + export:** FY `closed` (no postings dated ≤ 31.12; later corrections via 6960 in the next year). Snapshot, then PDF (pdfkit: Bilanz, GuV, Kontennachweis with Vorjahr), SuSa CSV and DATEV EXTF Buchungsstapel CSV, filed to Drive `Jahresabschluss/<year>`. Then auto-post the opening entry for Y+1 (balance accounts carried forward, result → 2970).

**Out of scope:** E-Bilanz XBRL, ELSTER submission, Bundesanzeiger upload, fixed assets/AfA beyond GWG, payroll, Bewirtung 70/30 split.

## Phases (each = own branch/PR, release, servyy-test before prod)

1. **Ledger foundation:** accounts seed, JournalEntry + `ledger.ts` + posting rules for invoice/payment, FiscalYear, opening entry UI, backfill, Journal/SuSa page. AGENTS.md invariants: journal immutable, reversal only, FY lock.
2. **Expenses:** Firefly withdrawals + `direction`, suppliers + rules, Buchen page, Drive receipts.
3. **USt:** `vat.ts`, USt page, VA periods, Finanzamt payment booking.
4. **Jahresabschluss:** checks, `taxProvision`, `appropriation`, closing steps, PDF/DATEV/CSV exports, lock + carry-forward.

## Verification

- Unit (vitest): posting rules for every event incl. credit note, negative/discount lines and mixed VAT rates; ledger rejects unbalanced entries, unknown accounts and a closed FY; reversal nets to 0; VA rounding; `taxProvision` golden cases with anonymised inputs incl. rounding edges; `appropriation` incl. Verlustvortrag and the 25k cap.
- Router tests (mongodb-memory-server): `markSent` posts exactly once (idempotent retry); unassign reverses; backfill is idempotent; trial balance Σ = 0 after every scenario.
- `npm run lint && npm run typecheck && npm run typecheck:server && npm test`.
- servyy-test: enter the opening entry, backfill, book sample withdrawals with receipts, ledger 1800 = Firefly balance, plausible VA figures. Locally only (never committed): `taxProvision` with the real prior-year inputs reproduces the advisor's results. Prod only with explicit approval.
