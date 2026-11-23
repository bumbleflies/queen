import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as QRCode from 'qrcode';
import { trpc } from '../lib/trpc';
import { formatDate, formatEUR } from '../lib/format';
import { useLanguage } from '../i18n/LanguageContext';
import { useToast } from '../components/Toast';
import { payoutStatusClass, payoutStatusKey } from '../lib/expenseLabel';

function CopyField({ label, value }: { label: string; value: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  return (
    <div className="copy-field">
      <span className="muted">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="btn ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast.show(t('payout.copied'));
        }}
      >
        {t('payout.copy')}
      </button>
    </div>
  );
}

/**
 * The mailed deep link. ProtectedRoute sends a logged-out visitor through
 * `/login?next=/expenses/payouts/<number>` and back to this exact page.
 * Only after login (and only for an admin) is the QR rendered.
 */
export function PayoutPage() {
  const { number = '' } = useParams();
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const payout = trpc.payouts.get.useQuery({ number }, { enabled: !!number });
  const release = trpc.payouts.release.useMutation();
  const markExecuted = trpc.payouts.markExecuted.useMutation();
  const cancel = trpc.payouts.cancel.useMutation();
  const [qrSrc, setQrSrc] = useState('');
  const [busy, setBusy] = useState(false);

  const qr = trpc.payouts.qr.useQuery(
    { id: payout.data?.id ?? '' },
    { enabled: !!payout.data?.qr && !!payout.data?.id },
  );
  const payload = qr.data?.payload;

  useEffect(() => {
    let cancelled = false;
    if (!payload) {
      setQrSrc('');
      return;
    }
    void QRCode.toDataURL(payload, { width: 260, margin: 2 })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc('');
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  if (me.isLoading || payout.isLoading) return <p>{t('payout.loading')}</p>;
  if (me.data?.user?.role !== 'admin') return <p>{t('payout.forbidden')}</p>;
  if (!payout.data) return <p>{t('payout.notFound')}</p>;

  const data = payout.data;
  const status = data.status;
  const showQr = (status === 'released' || status === 'executed') && !!data.qr;

  async function act(run: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await run();
      await Promise.all([utils.payouts.get.invalidate(), utils.payouts.list.invalidate()]);
      toast.show(message);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('payout.title')} {data.number}</h1>
          <p className="page-sub">{t('payout.sub')}</p>
        </div>
        <span className={`badge ${payoutStatusClass(status)}`}>{t(payoutStatusKey(status))}</span>
      </header>

      <section className="card">
        <dl className="detail-list">
          <dt>{t('payout.founder')}</dt>
          <dd>{data.founder.name}</dd>
          <dt>{t('payout.total')}</dt>
          <dd className="num">{formatEUR(data.amountCents)}</dd>
          <dt>{t('payout.reference')}</dt>
          <dd><code>{data.reference}</code></dd>
          <dt>{t('payout.purpose')}</dt>
          <dd>{data.purpose}</dd>
        </dl>

        <h2>{t('payout.claims')}</h2>
        <ul className="plain-list">
          {data.claims.map((claim) => (
            <li key={claim.id}>
              {claim.vendorName || claim.fileName}
              {claim.driveLink ? (
                <>
                  {' · '}
                  <a href={claim.driveLink} target="_blank" rel="noreferrer">{claim.fileName}</a>
                </>
              ) : null}
              {' · '}
              <span className="num">{formatEUR(claim.grossCents)}</span>
            </li>
          ))}
        </ul>
      </section>

      {status === 'draft' ? (
        <section className="card">
          <button
            type="button"
            className="btn honey"
            disabled={busy || release.isPending}
            onClick={() => void act(() => release.mutateAsync({ id: data.id }), t('payout.status.released'))}
          >
            {busy ? t('payout.releasing') : t('payout.release')}
          </button>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(t('payout.cancel'))) {
                void act(() => cancel.mutateAsync({ id: data.id }), t('payout.canceled'));
              }
            }}
          >
            {t('payout.cancel')}
          </button>
        </section>
      ) : null}

      {status === 'canceled' ? (
        <section className="card"><p className="big">{t('payout.canceled')}</p></section>
      ) : null}

      {status === 'settled' ? (
        <section className="card">
          <p className="big">{t('payout.settledOn').replace('{date}', formatDate(data.settledAt))}</p>
        </section>
      ) : null}

      {showQr ? (
        <section className="card qr-card">
          <h2>{t('payout.qrTitle')}</h2>
          {qrSrc ? <img src={qrSrc} alt={t('payout.qrTitle')} className="qr-image" /> : <p>{t('payout.loading')}</p>}
          <p className="muted">{t('payout.qrHint')}</p>
          <CopyField label={t('payout.reference')} value={data.reference} />
          <CopyField label={t('payout.total')} value={formatEUR(data.amountCents)} />
          <CopyField label={t('payout.purpose')} value={data.purpose} />
          {status === 'released' ? (
            <>
              <button
                type="button"
                className="btn ghost"
                disabled={busy || markExecuted.isPending}
                onClick={() => void act(() => markExecuted.mutateAsync({ id: data.id }), t('payout.executed'))}
              >
                {t('payout.markExecuted')}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(t('payout.cancel'))) {
                    void act(() => cancel.mutateAsync({ id: data.id }), t('payout.canceled'));
                  }
                }}
              >
                {t('payout.cancel')}
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
