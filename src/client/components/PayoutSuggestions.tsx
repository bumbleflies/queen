import { useNavigate } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { formatEUR } from '../lib/format';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';

/** One founder's preview — the query and the mutation stay local to that card. */
export function FounderPayoutSuggestion({ founderId }: { founderId: string }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const preview = trpc.payouts.preview.useQuery({ founderId });
  const create = trpc.payouts.create.useMutation();

  if (preview.isLoading) {
    return <p className="muted" style={{ margin: 0 }}>{t('payout.create.loading')}</p>;
  }
  const data = preview.data;
  if (!data || data.claims.length === 0 || !data.payload) return null;

  async function start() {
    try {
      const payout = await create.mutateAsync({ founderId });
      await utils.payouts.list.invalidate();
      await utils.expenses.claims.list.invalidate();
      navigate(`/expenses/payouts/${payout.number}`);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t('payout.create.failed');
      toast.error(message);
    }
  }

  return (
    <section className="card" aria-label={`${data.founder.name} ${t('payout.create.title')}`}>
      <div className="card-head">
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{t('payout.create.one')}</h3>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            {data.founder.name} · {t('payout.create.claims').replace('{n}', String(data.claims.length))}
          </p>
        </div>
        <strong className="num">{formatEUR(data.amountCents)}</strong>
      </div>
      <p className="muted" style={{ margin: '0 0 10px' }}>
        {t('payout.create.periods')}: {data.periods.join(', ') || '—'}
      </p>
      <div className="row">
        <button type="button" className="btn" disabled={create.isPending} onClick={start}>
          {create.isPending ? t('payout.create.creating') : t('payout.create.button')}
        </button>
      </div>
    </section>
  );
}

/** Eligible booked claims, one offer per active founder, above the payout list. */
export function PayoutSuggestions() {
  const founders = trpc.founders.list.useQuery();
  const active = (founders.data ?? []).filter((founder) => founder.active);
  if (active.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
      {active.map((founder) => (
        <FounderPayoutSuggestion key={founder.id} founderId={founder.id} />
      ))}
    </div>
  );
}
