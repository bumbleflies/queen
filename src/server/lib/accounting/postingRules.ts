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
