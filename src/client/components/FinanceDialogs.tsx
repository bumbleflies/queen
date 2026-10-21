import { useEffect, useState, type ReactNode } from 'react';
import { trpc } from '../lib/trpc';
import { formatEUR } from '../lib/format';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';

/** Shared modal frame: backdrop click and Escape close it. */
function Modal({ title, sub, onClose, children }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ width: '100%', maxWidth: 560, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}
      >
        <div className="card-head">
          <div>
            <h2>{title}</h2>
            {sub ? <p className="page-sub" style={{ margin: '4px 0 0' }}>{sub}</p> : null}
          </div>
        </div>
        {children}
      </section>
    </div>
  );
}

export interface StornoTarget {
  bankTxId: string;
  entryNumber: string;
  counterparty: string;
  amountCents: number;
}

export function StornoDialog({ target, onClose }: { target: StornoTarget; onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const unbook = trpc.bookings.unbook.useMutation();
  const [reason, setReason] = useState('');

  async function confirm() {
    try {
      await unbook.mutateAsync({ bankTxId: target.bankTxId, reason: reason.trim() });
      await utils.bookings.invalidate();
      await utils.ledger.invalidate();
      toast.show(t('finance.storno.done').replace('{entry}', target.entryNumber));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal
      title={t('finance.storno.title').replace('{entry}', target.entryNumber)}
      sub={`${target.counterparty} · ${formatEUR(target.amountCents)} — ${t('finance.storno.sub')}`}
      onClose={onClose}
    >
      <div style={{ padding: 16 }}>
        <label className="lab">
          {t('finance.storno.reason')}
          <input className="field" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('finance.storno.keep')}</button>
        <button type="button" className="btn danger" disabled={reason.trim() === '' || unbook.isPending} onClick={confirm}>
          {t('finance.storno.confirm')}
        </button>
      </div>
    </Modal>
  );
}

interface ReceiptFile {
  id: string;
  name: string;
  link: string;
  score: number;
}

export function ReceiptPickDialog({ year, bankTxId, onClose }: { year: number; bankTxId: string; onClose: () => void }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const receipts = trpc.receipts.list.useQuery({ year, bankTxId }, { retry: false });
  const setReceipt = trpc.bookings.setReceipt.useMutation();
  const files = (receipts.data ?? []) as ReceiptFile[];
  const [chosen, setChosen] = useState('');
  const file = files.find((f) => f.id === chosen) ?? null;

  async function save() {
    if (!file) return;
    try {
      await setReceipt.mutateAsync({ bankTxId, receipt: { driveFileId: file.id, fileName: file.name, link: file.link } });
      await utils.bookings.invalidate();
      toast.show(t('finance.receiptPick.saved'));
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Modal title={t('finance.receiptPick.title')} onClose={onClose}>
      <div style={{ padding: 16 }}>
        {receipts.isError ? (
          <p className="muted" style={{ margin: 0 }}>
            {t('bookings.receipt.unavailable')} — {t('bookings.receipt.unavailableHint')}
          </p>
        ) : (
          <label className="lab">
            {t('bookings.receipt.choose')}
            <select className="field" value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">{t('bookings.receipt.choose')}</option>
              {files.slice(0, 30).map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn" disabled={!file || setReceipt.isPending} onClick={save}>
          {t('finance.receiptPick.save')}
        </button>
      </div>
    </Modal>
  );
}

export function FullSyncDialog({ pending, onConfirm, onClose }: { pending: boolean; onConfirm: () => void; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <Modal title={t('bank.fullSyncTitle')} sub={t('bank.fullSyncConfirm')} onClose={onClose}>
      <div className="row acts" style={{ padding: 16 }}>
        <button type="button" className="btn ghost" disabled={pending} onClick={onClose}>{t('common.cancel')}</button>
        <button type="button" className="btn" disabled={pending} onClick={onConfirm}>
          {pending ? t('bank.fullSyncRunning') : t('bank.fullSync')}
        </button>
      </div>
    </Modal>
  );
}
