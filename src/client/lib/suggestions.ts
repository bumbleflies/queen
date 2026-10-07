import { parseReference } from './reference';
import type { Lang } from '../i18n/LanguageContext';

export interface SuggestTx {
  amountCents: number;
  description: string;
  counterpartyName?: string | null;
}

export interface SuggestItem {
  id: string;
  invoiceNumber: string;
  customerNumber: number;
  clientName: string;
  openCents: number;
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
  mismatch: (customerNumber: number | null, invoiceNumber: string, actual: number) => string;
  recognized: string;
  whyRef: string;
  whyExact: string;
  whyPayer: string;
}> = {
  de: {
    noRef: 'Kein Verwendungszweck im Format Kundennr-Rechnungsnr erkannt.',
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Kundennummer ${customerNumber} passt nicht zu Rechnung ${invoiceNumber} (Kunde ${actual}).`,
    recognized: 'Verwendungszweck erkannt, Betrag/Nummer prüfen.',
    whyRef: 'Rechnungsnr. passt',
    whyExact: 'Betrag exakt',
    whyPayer: 'Auftraggeber ≈ Kunde',
  },
  en: {
    noRef: 'No reference in customerNo-invoiceNo format found.',
    mismatch: (customerNumber, invoiceNumber, actual) =>
      `Customer number ${customerNumber} does not match invoice ${invoiceNumber} (customer ${actual}).`,
    recognized: 'Reference recognized, check amount/number.',
    whyRef: 'Invoice no. matches',
    whyExact: 'Exact amount',
    whyPayer: 'Payer ≈ customer',
  },
};

export function suggestionsFor(tx: SuggestTx, openItems: SuggestItem[], lang: Lang = 'de'): { reason: string; suggestions: Suggestion[] } {
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
    }
  }

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
