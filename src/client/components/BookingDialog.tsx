import { useEffect, useMemo, useState } from 'react';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useToast } from '../components/Toast';
import { previewBankPosting } from '../lib/bookingPreview';
import { useLanguage } from '../i18n/LanguageContext';
import { REVERSE_CHARGE_RATE, bankPostingSplit, type BankBookingMode, type SplitPart } from '../../server/lib/accounting/postingRules';
import { strongReceipt } from '../../server/lib/accounting/receipts';

export interface InboxRowLike {
  id: string;
  direction: 'in' | 'out';
  amountCents: number;
  date: string | Date;
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  description: string;
  suggestion: {
    supplierId?: string;
    supplierName: string;
    account?: string;
    vatRate?: number;
    mode: BankBookingMode;
    split?: SplitPart[];
    reading?: { vendor: string; files?: number };
    /** The receipt disagrees with the rule: both sides are shown, one is chosen. */
    conflict?: { account?: string; vatRate?: number; mode: BankBookingMode; split?: SplitPart[] };
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
  id: string;
  name: string;
  link: string;
  score: number;
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
  const [receiptId, setReceiptId] = useState('');
  const [missing, setMissing] = useState(false);
  const [missingReason, setMissingReason] = useState('');

  const conflict = tx.suggestion?.conflict ?? null;
  const [side, setSide] = useState<'rule' | 'receipt'>('rule');
  const suggestedSplit = tx.suggestion?.split && tx.suggestion.split.length >= 2 ? tx.suggestion.split : null;
  const receiptSplit = conflict?.split && conflict.split.length >= 2 ? conflict.split : null;
  const activeSplit = side === 'receipt' ? receiptSplit : suggestedSplit;
  const [useSplit, setUseSplit] = useState(true);
  const split = activeSplit && useSplit ? activeSplit : null;

  /** Take account, VAT rate, mode (and split) from the chosen side. */
  function chooseSide(next: 'rule' | 'receipt') {
    setSide(next);
    const source = next === 'receipt' ? conflict : tx.suggestion;
    if (!source) return;
    if (source.split && source.split.length >= 2) {
      setUseSplit(true);
      return;
    }
    setAccount(source.account ?? '');
    setVatRate(source.vatRate ?? 0.19);
    setMode(source.mode);
  }

  function describe(source: { account?: string; vatRate?: number; mode: BankBookingMode; split?: SplitPart[] }): string {
    if (source.split && source.split.length >= 2) return t('finance.outcome.split').replace('{n}', String(source.split.length));
    if (source.mode === 'vatOnly') return t('finance.outcome.vatOnly');
    return `${source.account ?? '—'} · ${Math.round((source.vatRate ?? 0) * 100)} %`;
  }

  const preview = useMemo(() => {
    if (!split) return previewBankPosting({ direction: tx.direction, amountCents: tx.amountCents, account, vatRate, mode });
    try {
      return { lines: bankPostingSplit({ direction: tx.direction, grossCents: tx.amountCents, parts: split }), error: null };
    } catch (err) {
      return { lines: [], error: (err as Error).message };
    }
  }, [tx.direction, tx.amountCents, account, vatRate, mode, split]);

  const files = (receipts.data ?? []) as ReceiptFile[];
  const chosen = files.find((f) => f.id === receiptId);

  // Preselect a clear match once the ranked list arrives.
  useEffect(() => {
    const best = strongReceipt((receipts.data ?? []) as ReceiptFile[]);
    if (best) setReceiptId((current) => current || best.id);
  }, [receipts.data]);

  async function submit() {
    try {
      const res = await book.mutateAsync({
        bankTxId: tx.id,
        account,
        vatRate,
        mode,
        ...(split ? { split } : {}),
        supplierId: supplierId || undefined,
        text: text || undefined,
        receipt: chosen ? { driveFileId: chosen.id, fileName: chosen.name, link: chosen.link } : undefined,
        receiptMissingReason: missing ? missingReason || null : undefined,
      });
      await utils.bookings.invalidate();
      toast.show(`${t('bookings.booked')} ${res.entryNumber}`);
      onDone();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDone();
      }}
    >
      <section
        className="card"
        style={{ width: '100%', maxWidth: 720, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}
      >
        <div className="card-head">
        <div>
          <h2>{t('bookings.dialog.title')}</h2>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>
            {tx.counterpartyName ?? ''} · {formatDate(tx.date)} · {formatEUR(tx.amountCents)}
          </p>
        </div>
      </div>
      <div className="grid-form" style={{ padding: 16 }}>
        {conflict ? (
          <div style={{ gridColumn: '1 / -1' }}>
            <p className="muted" style={{ margin: 0 }}>{t('bookings.dialog.conflict')}</p>
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`btn sm ${side === 'rule' ? '' : 'ghost'}`}
                aria-pressed={side === 'rule'}
                onClick={() => chooseSide('rule')}
              >
                {t('bookings.dialog.sideRule')} · {tx.suggestion ? describe(tx.suggestion) : ''}
              </button>
              <button
                type="button"
                className={`btn sm ${side === 'receipt' ? '' : 'ghost'}`}
                aria-pressed={side === 'receipt'}
                onClick={() => chooseSide('receipt')}
              >
                {t('bookings.dialog.sideReceipt')} · {describe(conflict)}
              </button>
            </div>
          </div>
        ) : null}
        {activeSplit ? (
          <div style={{ gridColumn: '1 / -1' }}>
            {tx.suggestion?.reading ? (
              <div className="lbl">
                {(tx.suggestion.reading.files ?? 1) > 1
                  ? t('finance.outcome.receipt.readMany').replace('{n}', String(tx.suggestion.reading.files)).replace('{vendor}', tx.suggestion.reading.vendor)
                  : t('finance.outcome.receipt.read').replace('{vendor}', tx.suggestion.reading.vendor)}
              </div>
            ) : null}
            <div className="num">
              {activeSplit.map((p) => (
                <div key={`${p.account}-${p.vatRate}-${p.grossCents}`}>
                  {p.account} · {Math.round(p.vatRate * 100)} %{p.mode === 'reverseCharge' ? ` · ${t('finance.outcome.reverseCharge')}` : ''} · {formatEUR(p.grossCents)}
                </div>
              ))}
            </div>
            <label className="lab" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} />
              {t('bookings.dialog.useSplit')}
            </label>
          </div>
        ) : null}
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
          <select
            className="field"
            value={mode === 'reverseCharge' ? REVERSE_CHARGE_RATE : vatRate}
            disabled={mode === 'reverseCharge'}
            onChange={(e) => setVatRate(Number(e.target.value))}
          >
            <option value={0}>0 %</option>
            <option value={0.07}>7 %</option>
            <option value={0.19}>19 %</option>
          </select>
        </label>
        <label className="lab">
          {t('bookings.dialog.mode')}
          <select
            className="field"
            value={mode}
            onChange={(e) => {
              const next = e.target.value as BankBookingMode;
              setMode(next);
              if (next === 'reverseCharge') setVatRate(REVERSE_CHARGE_RATE);
            }}
          >
            <option value="normal">{t('bookings.dialog.mode.normal')}</option>
            <option value="vatOnly">{t('bookings.dialog.mode.vatOnly')}</option>
            <option value="reverseCharge">{t('bookings.dialog.mode.reverseCharge')}</option>
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
            <>
              <span className="muted">{t('bookings.receipt.unavailable')}</span>
              <span className="muted">{t('bookings.receipt.unavailableHint')}</span>
            </>
          ) : (
            <select className="field" value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
              <option value="">{t('bookings.receipt.choose')}</option>
              {files.slice(0, 30).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
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
    </div>
  );
}
