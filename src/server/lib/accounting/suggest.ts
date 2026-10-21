import type { BankBookingMode, SplitPart } from './postingRules';

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
  /** Absent for history suggestions (no supplier behind them). */
  supplierId?: string;
  kreditorNumber?: number;
  /** The counterparty name for history suggestions. */
  supplierName: string;
  account?: string;
  vatRate?: number;
  mode: BankBookingMode;
  matchedBy: 'iban' | 'purpose' | 'name' | 'history' | 'receipt';
  lastBookedAt?: Date;
  /** Receipt readings across several accounts / VAT rates; `account`/`vatRate` are then absent. */
  split?: SplitPart[];
  /** The extracted receipt figures, always shown with a receipt suggestion. */
  reading?: { vendor: string; totalCents: number; lines: { vatRate: number; grossCents: number; account: string }[] };
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

  const checks: [Exclude<Suggestion['matchedBy'], 'history' | 'receipt'>, (s: SuggestSupplier) => boolean][] = [
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
        mode: hit.defaultMode === 'vatOnly' || hit.defaultMode === 'reverseCharge' ? hit.defaultMode : 'normal',
        matchedBy,
      };
    }
  }
  return null;
}
