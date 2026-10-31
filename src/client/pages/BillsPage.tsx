import { useLanguage } from '../i18n/LanguageContext';
import { BillsSection } from '../components/BillsSection';

export function BillsPage() {
  const { t } = useLanguage();

  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t('bills.title')}</h1>
          <p className="page-sub">{t('bills.sub')}</p>
        </div>
      </header>
      <BillsSection />
    </>
  );
}
