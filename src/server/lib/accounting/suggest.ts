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
