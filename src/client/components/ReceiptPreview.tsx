import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { ClaimPdf } from './ClaimPdf';
import { Modal } from './FinanceDialogs';

/** A receipt link on the payout page that opens the PDF without leaving the page. */
export function ReceiptPreview({ claimId, fileName }: { claimId: string; fileName: string }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>
        {t('expenses.preview')}
      </button>
      {open ? (
        <Modal title={t('expenses.preview.title')} sub={fileName} onClose={() => setOpen(false)}>
          <div style={{ padding: 16 }}>
            <ClaimPdf claimId={claimId} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
