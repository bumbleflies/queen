import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLanguage } from '../i18n/LanguageContext';
import { ClaimsSection } from '../components/ClaimsSection';
import { PayoutSuggestions } from '../components/PayoutSuggestions';
import { PayoutCard } from '../components/PayoutCard';

type Tab = 'claims' | 'payouts';

export function ExpensesPage() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('tab') === 'payouts' ? 'payouts' : 'claims');

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('expenses.title')}</h1>
          <p className="page-sub">{t('expenses.sub')}</p>
        </div>
      </header>
      <nav className="tabs" role="tablist" aria-label={t('expenses.title')}>
        <button type="button" role="tab" aria-selected={tab === 'claims'} className={tab === 'claims' ? 'tab on' : 'tab'} onClick={() => setTab('claims')}>
          {t('expenses.tab.claims')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'payouts'} className={tab === 'payouts' ? 'tab on' : 'tab'} onClick={() => setTab('payouts')}>
          {t('expenses.tab.payouts')}
        </button>
      </nav>
      {tab === 'claims' ? (
        <ClaimsSection />
      ) : (
        <>
          <PayoutSuggestions />
          <PayoutCard />
        </>
      )}
    </>
  );
}
