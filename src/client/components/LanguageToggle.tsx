import { useLanguage } from '../i18n/LanguageContext';
import type { Lang } from '../i18n/LanguageContext';

const FLAGS: Record<Lang, string> = { de: '🇩🇪', en: '🇬🇧' };

/**
 * Single toggle: shows the language you would switch TO, not the active one.
 * When German is active it offers English (and vice versa).
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, t } = useLanguage();
  const target: Lang = lang === 'de' ? 'en' : 'de';
  const targetName = t(target === 'de' ? 'settings.deName' : 'settings.enName');
  const switchTo = t('settings.switchTo').replace('{lang}', targetName);
  return (
    <button
      type="button"
      className={className ? `lang-btn ${className}` : 'lang-btn'}
      aria-label={switchTo}
      title={switchTo}
      onClick={() => setLang(target)}
    >
      <span className="lang-flag" aria-hidden="true">
        {FLAGS[target]}
      </span>
      {target.toUpperCase()}
    </button>
  );
}
