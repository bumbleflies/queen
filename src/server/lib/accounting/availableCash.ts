/** "Frei verfügbar": the bank balance minus what is already spoken for. */
export const VAT_ACCOUNTS = ['1401', '1406', '1407', '3801', '3806', '3837', '3820', '3840', '3841'];
export const PROVISION_ACCOUNTS = ['3020', '3035', '3040'];
export const LIABILITY_ACCOUNTS = ['3300', '3500', '3501'];
export const INCOME_TAX_ACCOUNTS = ['7600', '7608', '7610', '7641'];
/** Prepayment accounts that reduce the estimated tax. */
const PREPAYMENT_ACCOUNTS = ['7600', '7608', '7610'];

export interface AvailableCash {
  bankCents: number;
  vatCents: number;
  provisionsCents: number;
  estimatedTaxCents: number;
  liabilitiesCents: number;
  availableCents: number;
  profitCents: number;
  taxRate: number;
}

export interface AvailableCashInput {
  bankCents: number;
  /** Signed debit − credit per account, cumulative over non-closed years. */
  balances: Map<string, number>;
  /** Same, for the current fiscal year only. */
  currentYearBalances: Map<string, number>;
  taxRate: number;
}

function sum(balances: Map<string, number>, accounts: string[]): number {
  return accounts.reduce((s, a) => s + (balances.get(a) ?? 0), 0);
}

function sumWhere(balances: Map<string, number>, pred: (account: string) => boolean): number {
  let s = 0;
  for (const [account, cents] of balances) if (pred(account)) s += cents;
  return s;
}

export function computeAvailableCash(input: AvailableCashInput): AvailableCash {
  const { bankCents, balances, currentYearBalances, taxRate } = input;
  const vatCents = Math.max(0, -sum(balances, VAT_ACCOUNTS));
  const provisionsCents = Math.max(0, -sum(balances, PROVISION_ACCOUNTS));
  const liabilitiesCents = Math.max(0, -sum(balances, LIABILITY_ACCOUNTS));

  const revenue = -sumWhere(currentYearBalances, (a) => a.startsWith('4'));
  const costs = sumWhere(
    currentYearBalances,
    (a) => (a.startsWith('6') || a.startsWith('7')) && !INCOME_TAX_ACCOUNTS.includes(a),
  );
  const profitCents = revenue - costs;

  const prepaid = PREPAYMENT_ACCOUNTS.reduce(
    (s, a) => s + Math.max(0, currentYearBalances.get(a) ?? 0),
    0,
  );
  const estimatedTaxCents = Math.max(0, Math.round(taxRate * Math.max(0, profitCents)) - prepaid);

  return {
    bankCents,
    vatCents,
    provisionsCents,
    estimatedTaxCents,
    liabilitiesCents,
    availableCents: bankCents - vatCents - provisionsCents - estimatedTaxCents - liabilitiesCents,
    profitCents,
    taxRate,
  };
}
