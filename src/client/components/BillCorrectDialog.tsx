import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { parseGermanAmount } from '../../server/lib/money';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { Modal } from './FinanceDialogs';

/** The bill as the table shows it: the read, or a correction already on file. */
export interface BillToCorrect {
  id: string;
  fileName: string;
  vendorName: string;
  invoiceNumber: string;
  grossCents: number | null;
  netCents: number | null;
  vatCents: number | null;
  vatRate: number | null;
  dueDate: string | Date | null;
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
 * Correct what a bill's PDF read got wrong (vendor, number, amounts, VAT rate,
 * due date). The read stays on the document; the correction wins over it and a
 * later re-read repairs the read without discarding these numbers. Booking is
 * untouched: a corrected bill is still only a bill.
 */
export function BillCorrectDialog({ bill, onClose }: { bill: BillToCorrect; onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const correct = trpc.bills.correct.useMutation();

  const [vendorName, setVendorName] = useState(bill.vendorName);
  const [invoiceNumber, setInvoiceNumber] = useState(bill.invoiceNumber);
  const [gross, setGross] = useState(moneyInput(bill.grossCents));
  const [net, setNet] = useState(moneyInput(bill.netCents));
  const [vat, setVat] = useState(moneyInput(bill.vatCents));
  const [rate, setRate] = useState(rateInput(bill.vatRate));
  const [dueDate, setDueDate] = useState(dateInput(bill.dueDate));

  async function save() {
    const amounts = [
      { raw: gross, key: 'gross' },
      { raw: net, key: 'net' },
      { raw: vat, key: 'vat' },
    ].map((field) => ({ ...field, cents: centsFromInput(field.raw) }));
    const bad = amounts.find((field) => field.cents === 'bad');
    if (bad) {
      toast.error(t('bills.correct.badAmount').replace('{raw}', bad.raw.trim()));
      return;
    }
    let vatRate: number | null = null;
    if (rate.trim()) {
      const percent = Number(rate.trim().replace(',', '.'));
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        toast.error(t('bills.correct.badAmount').replace('{raw}', rate.trim()));
        return;
      }
      vatRate = percent / 100;
    }
    // A local business date, like every other date the app writes.
    let due: Date | null = null;
    if (dueDate) {
      const [y, m, d] = dueDate.split('-').map(Number);
      due = new Date(y, m - 1, d);
    }

    try {
      await correct.mutateAsync({
        id: bill.id,
        vendorName: vendorName.trim(),
        invoiceNumber: invoiceNumber.trim(),
        grossCents: amounts[0].cents as number | null,
        netCents: amounts[1].cents as number | null,
        vatCents: amounts[2].cents as number | null,
        vatRate,
        dueDate: due,
      });
      await utils.bills.list.invalidate();
      toast.show(t('bills.correct.saved'));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal title={t('bills.correct.title')} sub={`${bill.fileName} — ${t('bills.correct.sub')}`} onClose={onClose}>
      <div style={{ padding: 16, display: 'grid', gap: 10 }}>
        <label className="lab">
          {t('bills.correct.vendor')}
          <input className="field" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.invoiceNumber')}
          <input className="field" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.gross')}
          <input className="field" inputMode="decimal" autoFocus value={gross} onChange={(e) => setGross(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.net')}
          <input className="field" inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.vat')}
          <input className="field" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.vatRate')}
          <input className="field" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
        <label className="lab">
          {t('bills.correct.dueDate')}
          <input className="field" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn" disabled={correct.isPending} onClick={save}>
          {correct.isPending ? t('bills.correct.saving') : t('bills.correct.save')}
        </button>
      </div>
    </Modal>
  );
}
