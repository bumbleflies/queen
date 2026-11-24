import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useLanguage } from '../i18n/LanguageContext';
import { useToast } from './Toast';
import { ClaimsSection, ManualClaimDialog } from './ClaimsSection';
import { PayoutSuggestions } from './PayoutSuggestions';
import { PayoutCard } from './PayoutCard';

type Sub = 'claims' | 'payouts';

/**
 * The Expenses view embedded in Finance. It owns the toolbar (intake, manual
 * entry, address binding) so the receipts table can stay a pure, year-driven
 * section — and so there is only one year selector on the page.
 */
export function ExpensesSection({ year }: { year: number }) {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const isAdmin = me.data?.user?.role === 'admin';
  const intake = trpc.expenses.claims.intakeNow.useMutation();

  const [sub, setSub] = useState<Sub>('claims');
  const [manualOpen, setManualOpen] = useState(false);
  const [remember, setRemember] = useState(true);

  async function fetchNow() {
    try {
      const result = await intake.mutateAsync();
      await utils.expenses.claims.list.invalidate();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.show(
        t('expenses.fetched')
          .replace('{new}', String(result.created))
          .replace('{known}', String(result.skipped))
          .replace('{failed}', String(result.failed)),
      );
      const notifyErrors = result.notifyErrors ?? [];
      if (notifyErrors.length > 0) {
        toast.error(t('expenses.replyFailed').replace('{error}', notifyErrors[0]));
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <section aria-label={t('expenses.title')}>
      <div className="fin-subbar">
        <div className="row acts">
          <div className="seg" role="tablist" aria-label={t('expenses.title')}>
            <button
              type="button"
              role="tab"
              aria-selected={sub === 'claims'}
              className={sub === 'claims' ? 'on' : ''}
              onClick={() => setSub('claims')}
            >
              {t('expenses.tab.claims')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sub === 'payouts'}
              className={sub === 'payouts' ? 'on' : ''}
              onClick={() => setSub('payouts')}
            >
              {t('expenses.tab.payouts')}
            </button>
          </div>
          {sub === 'claims' && isAdmin ? (
            <>
              <button type="button" className="btn" onClick={fetchNow} disabled={intake.isPending}>
                {intake.isPending ? t('expenses.fetching') : t('expenses.fetch')}
              </button>
              <button type="button" className="btn ghost" onClick={() => setManualOpen(true)}>
                {t('expenses.manual')}
              </button>
              <label className="chk" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                {t('expenses.rememberEmail')}
              </label>
            </>
          ) : null}
        </div>
      </div>

      {sub === 'claims' ? (
        <ClaimsSection year={year} remember={remember} />
      ) : (
        <>
          <PayoutSuggestions />
          <PayoutCard />
        </>
      )}
      {manualOpen ? <ManualClaimDialog onClose={() => setManualOpen(false)} /> : null}
    </section>
  );
}
