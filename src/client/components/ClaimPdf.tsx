import { trpc } from '../lib/trpc';
import { useLanguage } from '../i18n/LanguageContext';

/**
 * The same proxied PDF preview used by the claim menu, embedded inline. The
 * bytes come from our own tRPC endpoint — Google's viewer shows a cookie wall
 * inside an iframe.
 */
export function ClaimPdf({ claimId, height = 420 }: { claimId: string; height?: number }) {
  const { t } = useLanguage();
  const pdf = trpc.expenses.claims.preview.useQuery({ id: claimId });

  if (pdf.isLoading) return <p className="muted">{t('common.loading')}</p>;
  if (!pdf.data) {
    return (
      <p style={{ color: 'var(--danger)', margin: 0 }}>
        {(pdf.error as unknown as Error)?.message ?? t('expenses.preview.failed')}
      </p>
    );
  }
  return (
    <iframe
      title={pdf.data.fileName}
      src={`data:application/pdf;base64,${pdf.data.pdfBase64}`}
      style={{ width: '100%', height, border: 0 }}
    />
  );
}
