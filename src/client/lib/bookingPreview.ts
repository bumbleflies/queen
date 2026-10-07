import { bankPosting, type BankBookingMode, type PostingLine } from '../../server/lib/accounting/postingRules';

export function previewBankPosting(input: {
  direction: 'in' | 'out';
  amountCents: number;
  account: string;
  vatRate: number;
  mode: BankBookingMode;
}): { lines: PostingLine[]; error: string | null } {
  try {
    return {
      lines: bankPosting({
        direction: input.direction,
        grossCents: input.amountCents,
        account: input.account,
        vatRate: input.vatRate,
        mode: input.mode,
      }),
      error: null,
    };
  } catch (err) {
    return { lines: [], error: (err as Error).message };
  }
}
