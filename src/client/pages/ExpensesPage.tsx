import { useLanguage } from '../i18n/LanguageContext';
import { ClaimsSection } from '../components/ClaimsSection';

export function ExpensesPage() {
  const { t } = useLanguage();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('expenses.title')}</h1>
          <p className="page-sub">{t('expenses.sub')}</p>
        </div>
      </header>
      <ClaimsSection />
    </>
  );
}
