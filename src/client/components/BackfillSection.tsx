import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useToast } from '../components/Toast';
import { useLanguage } from '../i18n/LanguageContext';

interface BackfillReport {
  invoices: number;
  creditNotes: number;
  payments: number;
  skipped: { ref: string; reason: string }[];
}

export function BackfillSection({ year }: { year: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const backfill = trpc.admin.ledgerBackfill.useMutation();
  const [report, setReport] = useState<BackfillReport | null>(null);

  async function check() {
    try {
      const res = await backfill.mutateAsync({ year, dryRun: true });
      setReport(res as unknown as BackfillReport);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function apply() {
    if (!window.confirm(t('ledger.backfill.confirm'))) return;
    try {
      const res = await backfill.mutateAsync({ year, dryRun: false });
      setReport(res as unknown as BackfillReport);
      await utils.ledger.invalidate();
      toast.show(t('ledger.backfill.posted'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  const empty =
    report !== null &&
    report.invoices === 0 &&
    report.creditNotes === 0 &&
    report.payments === 0 &&
    report.skipped.length === 0;
  const postable = (report?.invoices ?? 0) + (report?.creditNotes ?? 0) + (report?.payments ?? 0);

  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <h2>{t('ledger.backfill.title')}</h2>
          <p className="page-sub" style={{ margin: '4px 0 0' }}>{t('ledger.backfill.sub')}</p>
        </div>
        <div className="row acts">
          {report === null || postable === 0 ? (
            <button type="button" className="btn" disabled={backfill.isPending} onClick={check}>
              {t('ledger.backfill.check')}
            </button>
          ) : (
            <button type="button" className="btn" disabled={backfill.isPending} onClick={apply}>
              {t('ledger.backfill.apply')} ({postable})
            </button>
          )}
        </div>
      </div>
      {report ? (
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="row">
            <span className="num">{report.invoices} {t('ledger.backfill.invoices')}</span>
            <span className="num">{report.creditNotes} {t('ledger.backfill.creditNotes')}</span>
            <span className="num">{report.payments} {t('ledger.backfill.payments')}</span>
          </div>
          {empty ? <p className="empty" style={{ margin: 0 }}>{t('ledger.backfill.none')}</p> : null}
          {report.skipped.length > 0 ? (
            <div>
              <div className="lbl">{t('ledger.backfill.skipped')}</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                {report.skipped.map((s) => (
                  <li key={s.ref} className="num">{s.ref} — {s.reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
