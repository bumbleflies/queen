import { useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { previewBankPosting } from '../lib/bookingPreview';
import { useLanguage } from '../i18n/LanguageContext';
import type { BankBookingMode } from '../../server/lib/accounting/postingRules';

export interface InboxRowLike {
  id: string;
  direction: 'in' | 'out';
  amountCents: number;
  date: string | Date;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
  suggestion: {
    supplierId: string;
    supplierName: string;
    account?: string;
    vatRate?: number;
    mode: BankBookingMode;
  } | null;
}

interface SupplierRow {
  _id: unknown;
  kreditorNumber: number;
  name: string;
}

interface AccountRow {
  number: string;
  name: string;
}

interface ReceiptFile {
  driveFileId: string;
  fileName: string;
  link: string;
}

export function BookingDialog({ year, tx, onDone }: { year: number; tx: InboxRowLike; onDone: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const accounts = trpc.accounts.list.useQuery();
  const suppliers = trpc.suppliers.list.useQuery();
  const receipts = trpc.receipts.list.useQuery({ year, bankTxId: tx.id }, { retry: false });
  const book = trpc.bookings.book.useMutation();

  const [account, setAccount] = useState(tx.suggestion?.account ?? '');
  const [vatRate, setVatRate] = useState(tx.suggestion?.vatRate ?? 0.19);
  const [mode, setMode] = useState<BankBookingMode>(tx.suggestion?.mode ?? 'normal');
  const [supplierId, setSupplierId] = useState(tx.suggestion?.supplierId ?? '');
  const [text, setText] = useState('');
  const [remember, setRemember] = useState(!tx.suggestion);
  const [receiptId, setReceiptId] = useState('');
  const [missing, setMissing] = useState(false);
  const [missingReason, setMissingReason] = useState('');

  const preview = useMemo(
    () => previewBankPosting({ direction: tx.direction, amountCents: tx.amountCents, account, vatRate, mode }),
    [tx.direction, tx.amountCents, account, vatRate, mode],
  );

  const files = (receipts.data ?? []) as unknown as ReceiptFile[];
  const chosen = files.find((f) => f.driveFileId === receiptId);

  async function submit() {
    try {
      const res = await book.mutateAsync({
        bankTxId: tx.id,
        account,
        vatRate,
        mode,
        supplierId: supplierId || undefined,
        text: text || undefined,
        rememberRule: remember,
        receipt: chosen ? { driveFileId: chosen.driveFileId, fileName: chosen.fileName, link: chosen.link } : undefined,
        receiptMissingReason: missing ? missingReason || null : undefined,
      });
      await utils.bookings.invalidate();
      toast.show(`${t('bookings.booked')} ${res.entryNumber}`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{t('bookings.dialog.title')}</h2>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>
            {tx.counterpartyName ?? ''} · {formatDate(tx.date)} · {formatEUR(tx.amountCents)}
          </p>
        </div>
      </div>
      <div className="grid-form" style={{ padding: 16 }}>
        <label className="lab">
          {t('bookings.dialog.account')}
          <input
            className="field"
            list="booking-accounts"
            value={account}
            disabled={mode === 'vatOnly'}
            onChange={(e) => setAccount(e.target.value)}
          />
        </label>
        <label className="lab">
          {t('bookings.dialog.vat')}
          <select className="field" value={vatRate} onChange={(e) => setVatRate(Number(e.target.value))}>
            <option value={0}>0 %</option>
            <option value={0.07}>7 %</option>
            <option value={0.19}>19 %</option>
          </select>
        </label>
        <label className="lab">
          {t('bookings.dialog.mode')}
          <select className="field" value={mode} onChange={(e) => setMode(e.target.value as BankBookingMode)}>
            <option value="normal">{t('bookings.dialog.mode.normal')}</option>
            <option value="vatOnly">{t('bookings.dialog.mode.vatOnly')}</option>
          </select>
        </label>
        <label className="lab">
          {t('bookings.dialog.supplier')}
          <select className="field" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">{t('bookings.dialog.supplierNone')}</option>
            {((suppliers.data ?? []) as unknown as SupplierRow[]).map((s) => (
              <option key={String(s._id)} value={String(s._id)}>{`${s.kreditorNumber} ${s.name}`}</option>
            ))}
          </select>
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          {t('bookings.dialog.text')}
          <input className="field" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1' }}>
          {t('bookings.receipt.choose')}
          {receipts.isError ? (
            <span className="muted">{t('bookings.receipt.unavailable')}</span>
          ) : (
            <select className="field" value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
              <option value="">{t('bookings.receipt.choose')}</option>
              {files.slice(0, 30).map((f) => (
                <option key={f.driveFileId} value={f.driveFileId}>{f.fileName}</option>
              ))}
            </select>
          )}
        </label>
        <label className="lab" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
          {t('bookings.receipt.none')}
        </label>
        {missing ? (
          <label className="lab" style={{ gridColumn: '1 / -1' }}>
            {t('bookings.receipt.reason')}
            <input className="field" value={missingReason} onChange={(e) => setMissingReason(e.target.value)} />
          </label>
        ) : null}
        <label className="lab" style={{ gridColumn: '1 / -1', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('bookings.dialog.remember')}
        </label>
      </div>
      <datalist id="booking-accounts">
        {((accounts.data ?? []) as unknown as AccountRow[]).map((a) => (
          <option key={a.number} value={a.number}>{`${a.number} ${a.name}`}</option>
        ))}
      </datalist>
      <div style={{ padding: '0 16px' }}>
        <div className="lbl">{t('bookings.dialog.preview')}</div>
        {preview.error ? (
          <p style={{ color: 'var(--danger)', margin: '4px 0' }}>{preview.error}</p>
        ) : (
          <div className="num">
            {preview.lines.map((l) => (
              <div key={`${l.account}-${l.debitCents}-${l.creditCents}`}>
                {l.debitCents > 0 ? `S ${l.account} ${formatEUR(l.debitCents)}` : `H ${l.account} ${formatEUR(l.creditCents)}`}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onDone}>{t('common.cancel')}</button>
        <button
          type="button"
          className="btn"
          disabled={!!preview.error || book.isPending}
          onClick={submit}
        >
          {t('bookings.dialog.save')}
        </button>
      </div>
    </section>
  );
}
