/**
 * EPC069-12 (GiroCode) payload builder for SEPA credit transfers.
 *
 * Pure on purpose: the payout page renders this into a QR code in the browser,
 * and the layout is the one the bank app validated — do not "improve" it.
 */
export class EpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpcError';
  }
}

export interface EpcInput {
  name: string;
  iban: string;
  /** Optional; EPC v2 allows an empty BIC. Default: omitted. */
  bic?: string;
  amountCents: number;
  purpose: string;
  info?: string;
}

/** Strip CR/LF and collapse whitespace: a line break would shift every later field. */
function clean(value: string, max: number, label: string): string {
  const v = value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v) throw new EpcError(`${label} darf nicht leer sein`);
  if (v.length > max) throw new EpcError(`${label} darf höchstens ${max} Zeichen haben`);
  return v;
}

export function normalizeIban(raw: string): string {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw new EpcError('Ungültige IBAN');
  return iban;
}

/**
 * EPC069-12 v2 payload (GiroCode). Field 9 is the four-character PURPOSE CODE,
 * field 10 the structured reference — both stay empty; the free-text
 * Verwendungszweck is field 11. Every field is terminated by LF, also the last.
 *
 * Validated on the GLS app on 2026-11-23: with the purpose in field 9 the app
 * dropped it; with this layout name/IBAN/amount/purpose all arrive.
 */
export function epcPayload(input: EpcInput): string {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new EpcError('Betrag muss eine positive Centzahl sein');
  }
  if (input.amountCents > 99_999_999_999) throw new EpcError('Betrag ist zu groß');

  const name = clean(input.name, 70, 'Empfänger');
  const purpose = clean(input.purpose, 140, 'Verwendungszweck');
  const iban = normalizeIban(input.iban);
  const amount = `EUR${(input.amountCents / 100).toFixed(2)}`;
  const info = input.info?.trim() ? clean(input.info, 70, 'Information') : undefined;

  const lines = ['BCD', '002', '1', 'SCT', input.bic?.trim() ?? '', name, iban, amount, '', '', purpose];
  if (info) lines.push(info);
  return `${lines.join('\n')}\n`;
}
