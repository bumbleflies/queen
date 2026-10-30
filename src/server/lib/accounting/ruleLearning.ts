import { normalizeIban, normalizeVendor } from './normalize';

export type RuleKey =
  | { kind: 'iban'; value: string }
  | { kind: 'name'; value: string }
  | { kind: 'purpose'; value: string };

export interface LearningEvidence {
  direction?: string | null;
  /** Several expense lines: not expressible as a rule. */
  split?: boolean;
  /** The receipt reading's vendor, when the booking came from a receipt. */
  receiptVendor?: string | null;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
}

/** Same party, compared case- and punctuation-insensitively ("Software Ltd" / "Software Ltd."). */
function sameParty(a: string, b: string): boolean {
  const [x, y] = [normalizeVendor(a), normalizeVendor(b)];
  if (!x || !y) return true;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * The leading part of a Verwendungszweck that identifies a recurring transfer:
 * cut before a URL or a number run of six or more digits (`Spesen-ChrisD-202601…`
 * → `Spesen-ChrisD`), separators trimmed, 40 characters at most.
 */
export function purposePrefix(description: string): string | null {
  const cleaned = description.replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  const cut = cleaned.search(/https?:\/\/|\d{6,}/);
  const prefix = (cut >= 0 ? cleaned.slice(0, cut) : cleaned).replace(/[\s\-_/]+$/, '').trim().slice(0, 40);
  return prefix.length >= 4 ? prefix : null;
}

/**
 * What a confirmed booking teaches: IBAN first, else the counterparty name, else
 * a purpose prefix. Nothing for incoming payments, split bookings, or when the
 * receipt vendor contradicts the bank counterparty (a collective reimbursement
 * must not pin one receipt's account onto the next transfer).
 */
export function learningKey(tx: LearningEvidence): RuleKey | null {
  if (tx.direction === 'in' || tx.split) return null;
  const name = (tx.counterpartyName ?? '').replace(/\s+/g, ' ').trim();
  const usableName = name !== '' && !name.startsWith('(') ? name : null;
  if (tx.receiptVendor && usableName && !sameParty(tx.receiptVendor, usableName)) return null;
  const iban = tx.counterpartyIban ? normalizeIban(tx.counterpartyIban) : '';
  if (iban) return { kind: 'iban', value: iban };
  if (usableName) return { kind: 'name', value: usableName };
  const purpose = purposePrefix(tx.description);
  return purpose ? { kind: 'purpose', value: purpose } : null;
}
