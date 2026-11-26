import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { parseGermanAmount } from '../../server/lib/money';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { Modal } from './FinanceDialogs';

/** The claim as the table shows it: the read, or a correction already on file. */
export interface ClaimToCorrect {
  id: string;
  fileName: string;
  /** A booked claim is rebooked after the correction has been saved. */
  status: string;
  date: string | Date | null;
  vendorName: string;
  invoiceNumber: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  vatRate: number | null;
  account: string | null;
  /** Review-only hint; never applied without a click. */
  accountSuggestion?: { account: string; source: string; lastDate: string | Date | null } | null;
}

/** 1214 → "12,14"; a field the read left empty stays empty. */
function moneyInput(cents: number | null | undefined): string {
  if (typeof cents !== 'number') return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** "12,14" → 1214; "" → null (clears the field); a number we cannot read → 'bad'. */
function centsFromInput(raw: string): number | null | 'bad' {
  const value = raw.trim();
  if (!value) return null;
  try {
    return parseGermanAmount(value);
  } catch {
    return 'bad';
  }
}

/** 0.19 → "19"; null stays empty. */
function rateInput(rate: number | null | undefined): string {
  if (typeof rate !== 'number') return '';
  return String(Number((rate * 100).toFixed(2))).replace('.', ',');
}

/** `<input type="date">` value for a local business date (never UTC midnight). */
function dateInput(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Correct what a receipt's PDF read got wrong (date, issuer, amounts, VAT rate,
 * account). The read stays on the document; the correction wins over it. For a
 * booked claim the dialog also rebooks (reversal + new posting) after saving.
 */
export function ClaimCorrectDialog({
  claim,
  onClose,
  booked = false,
}: {
  claim: ClaimToCorrect;
  onClose: () => void;
  booked?: boolean;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const correct = trpc.expenses.claims.correct.useMutation();
  const confirm = trpc.expenses.claims.confirm.useMutation();

  const [date, setDate] = useState(dateInput(claim.date));
  const [vendorName, setVendorName] = useState(claim.vendorName);
  const [invoiceNumber, setInvoiceNumber] = useState(claim.invoiceNumber);
  const [gross, setGross] = useState(moneyInput(claim.grossCents));
  const [net, setNet] = useState(moneyInput(claim.netCents));
  const [vat, setVat] = useState(moneyInput(claim.vatCents));
  const [rate, setRate] = useState(rateInput(claim.vatRate));
  const [account, setAccount] = useState(claim.account ?? '');

  async function save() {
    const amounts = [
      { raw: gross, key: 'gross' },
      { raw: net, key: 'net' },
      { raw: vat, key: 'vat' },
    ].map((field) => ({ ...field, cents: centsFromInput(field.raw) }));
    const bad = amounts.find((field) => field.cents === 'bad');
    if (bad) {
      toast.error(t('expenses.correct.badAmount').replace('{raw}', bad.raw.trim()));
      return;
    }
    let vatRate: number | null = null;
    if (rate.trim()) {
      const percent = Number(rate.trim().replace(',', '.'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        toast.error(t('expenses.correct.badAmount').replace('{raw}', rate.trim()));
        return;
      }
      vatRate = percent / 100;
    }
    // A local business date, like every other date the app writes.
    let receiptDate: Date | null = null;
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      receiptDate = new Date(y, m - 1, d);
    }

    try {
      const result = await correct.mutateAsync({
        id: claim.id,
        date: receiptDate,
        vendorName: vendorName.trim(),
        invoiceNumber: invoiceNumber.trim(),
        grossCents: amounts[0].cents as number | null,
        netCents: amounts[1].cents as number | null,
        vatCents: amounts[2].cents as number | null,
        vatRate,
        account: account.trim() || null,
      });
      await utils.expenses.claims.list.invalidate();
      // A booked claim is not silently left with a stale entry: reverse and
      // rebook it here, so "Korrigieren & neu buchen" is one action.
      if (result.needsRebook && booked) {
        await confirm.mutateAsync({ id: claim.id });
        await utils.expenses.claims.list.invalidate();
        toast.show(t('expenses.rebooked'));
      } else {
        toast.show(result.needsRebook ? t('expenses.needsRebook') : t('expenses.correct.saved'));
      }
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal title={t('expenses.correct.title')} sub={`${claim.fileName} — ${t('expenses.correct.sub')}`} onClose={onClose}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <label className="lab">
          {t('expenses.correct.date')}
          <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.vendor')}
          <input className="field" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.invoiceNumber')}
          <input className="field" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.gross')}
          <input className="field" inputMode="decimal" autoFocus value={gross} onChange={(e) => setGross(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.net')}
          <input className="field" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.vat')}
          <input className="field" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.vatRate')}
          <input className="field" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="lab">
          {t('expenses.correct.account')}
          <input className="field" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} />
        </label>
        {claim.accountSuggestion ? (
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => setAccount(claim.accountSuggestion!.account)}
            title={t('expenses.accountSuggestion.hint')}
          >
            {t('expenses.accountSuggestion')
              .replace('{account}', claim.accountSuggestion.account)
              .replace(
                '{source}',
                t(
                  claim.accountSuggestion.source === 'history'
                    ? 'expenses.accountSource.history'
                    : claim.accountSuggestion.source === 'rule'
                      ? 'expenses.accountSource.rule'
                      : 'expenses.accountSource.keyword',
                ),
              )}
          </button>
        ) : null}
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn" disabled={correct.isPending} onClick={save}>
          {correct.isPending ? t('expenses.correct.saving') : t('expenses.correct.save')}
        </button>
      </div>
    </Modal>
  );
}
