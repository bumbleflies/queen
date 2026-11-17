import type { BankBookingMode, SplitPart } from '../../server/lib/accounting/postingRules';
import type { DictKey } from '../i18n/de';
import { formatEUR } from './format';

/** What one side of a rule/receipt decision books (a suggestion or a `conflict`). */
export interface BookingShape {
  account?: string;
  vatRate?: number;
  mode: BankBookingMode;
  split?: SplitPart[];
}

type Translate = (key: DictKey) => string;

const ratePct = (rate: number): string => `${Math.round(rate * 100)} %`;

/**
 * What this booking does, in one line: account, VAT rate and mode, or the split
 * parts. The ONE formatter for both sides of a rule/receipt decision — two
 * bookings that post differently must never render the same string, so the mode
 * (`§13b`) and every split part (account, rate, amount) are always spelled out.
 */
export function formatBooking(shape: BookingShape, t: Translate, accountName?: (account: string) => string | undefined): string {
  if (shape.split && shape.split.length >= 2) {
    const parts = shape.split
      .map((p) => {
        const mode = p.mode === 'reverseCharge' ? ` ${t('finance.outcome.reverseCharge')}` : '';
        return `${p.account} ${ratePct(p.vatRate)}${mode} · ${formatEUR(p.grossCents)}`;
      })
      .join(' + ');
    return `${t('finance.outcome.split').replace('{n}', String(shape.split.length))} · ${parts}`;
  }
  if (shape.mode === 'vatOnly') {
    // No account: the whole amount is VAT. The rate still tells two rows apart.
    const rate = shape.vatRate === undefined ? '' : ` · ${ratePct(shape.vatRate)}`;
    return `${t('finance.outcome.vatOnly')}${rate}`;
  }
  const name = shape.account ? accountName?.(shape.account) : undefined;
  const account = shape.account ? (name ? `${shape.account} ${name}` : shape.account) : '—';
  const rate = shape.vatRate === undefined ? t('finance.outcome.rateOpen') : ratePct(shape.vatRate);
  const mode = shape.mode === 'reverseCharge' ? ` · ${t('finance.outcome.reverseCharge')}` : '';
  return `${account} · ${rate}${mode}`;
}
