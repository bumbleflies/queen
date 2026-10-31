import { parseReference } from './reference';
import type { Lang } from '../i18n/LanguageContext';

export interface BankTxLite {
  _id?: unknown;
  amountCents: number;
  direction: 'in' | 'out';
  description: string;
  counterpartyName?: string | null;
}

export interface OpenItem {
  id: string;
  invoiceNumber: string;
  customerNumber: number;
  clientName: string;
  openCents: number;
  dueDate?: string | Date | null;
  /** Imported as paid without a recorded payment: the bank payment is missing. */
  paymentMissing?: boolean;
}

export interface Suggestion {
  id: string;
  invoiceNumber: string;
  clientName: string;
  openCents: number;
  why: string;
  exact: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '');
}

const BANK_TEXT: Record<Lang, {
  noRef: string;
  recognizedNoOpen: (invoiceNumber: string) => string;
  mismatch: (customerNumber: number | null, invoiceNumber: string, actual: number) => string;
  recognized: string;
  whyRef: string;
  whyExact: string;
  whyPayer: string;
  whyMissing: string;
}> = {
  de: {
    noRef: 'Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.',
    recognizedNoOpen: (invoiceNumber) =>
      `Verwendungszweck ${invoiceNumber} erkannt, aber keine passende Rechnung gefunden.`,
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Kundennummer ${customerNumber} passt nicht zu Rechnung ${invoiceNumber} (Kunde ${actual}).`,
    recognized: 'Verwendungszweck erkannt, Betrag/Nummer prüfen.',
    whyRef: 'Rechnungsnr. passt',
    whyExact: 'Betrag exakt',
    whyPayer: 'Auftraggeber ≈ Kunde',
    whyMissing: 'als bezahlt importiert · Bankzahlung nicht zugeordnet',
  },
  en: {
    noRef: 'No reference in customerNo-invoiceNo format found.',
    recognizedNoOpen: (invoiceNumber) =>
      `Reference ${invoiceNumber} recognized, but no matching invoice found.`,
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Customer number ${customerNumber} does not match invoice ${invoiceNumber} (customer ${actual}).`,
    recognized: 'Reference recognized, check amount/number.',
    whyRef: 'Invoice no. matches',
    whyExact: 'Exact amount',
    whyPayer: 'Payer ≈ customer',
    whyMissing: 'imported as paid · bank payment not assigned',
  },
};

export function suggestionsFor(tx: BankTxLite, openItems: OpenItem[], lang: Lang = 'de'): { reason: string; suggestions: Suggestion[] } {
  const txt = BANK_TEXT[lang];
  const parsed = parseReference(tx.description);
  const out: Suggestion[] = [];
  let reason = txt.noRef;

  if (parsed) {
    const candidate = openItems.find((i) => i.invoiceNumber === parsed.invoiceNumber);
    if (candidate && parsed.customerNumber !== null && parsed.customerNumber !== candidate.customerNumber) {
      reason = txt.mismatch(parsed.customerNumber, parsed.invoiceNumber, candidate.customerNumber);
    } else if (candidate) {
      reason = txt.recognized;
    } else {
      // The reference itself is fine — saying "no reference recognized" would be wrong.
      reason = txt.recognizedNoOpen(parsed.invoiceNumber);
    }
  }

  // Only incoming payments match against open invoices (customer paid us).
  // Outgoing rows are expenses — they never get invoice pills.
  if (tx.direction !== 'in') return { reason: txt.noRef, suggestions: [] };

  for (const item of openItems) {
    const whys: string[] = [];
    let exact = false;
    if (parsed && parsed.invoiceNumber === item.invoiceNumber) whys.push(txt.whyRef);
    if (item.openCents === tx.amountCents) {
      whys.push(txt.whyExact);
      exact = true;
    }
    if (
      tx.counterpartyName &&
      normalize(item.clientName).length > 0 &&
      normalize(tx.counterpartyName).includes(normalize(item.clientName))
    ) {
      whys.push(txt.whyPayer);
    }
    // `paymentMissing` only annotates an invoice that already matched via
    // amount / reference / payer — it never creates a suggestion on its own,
    // otherwise "Zahlung nicht zugeordnet" invoices spill onto every row.
    if (item.paymentMissing && whys.length > 0) whys.push(txt.whyMissing);
    if (whys.length > 0) {
      out.push({
        id: item.id,
        invoiceNumber: item.invoiceNumber,
        clientName: item.clientName,
        openCents: item.openCents,
        why: whys.join(' · '),
        exact,
      });
    }
  }

  out.sort((a, b) => Number(b.exact) - Number(a.exact));
  return { reason, suggestions: out };
}
