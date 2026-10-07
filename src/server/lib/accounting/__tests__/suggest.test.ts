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
