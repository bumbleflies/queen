import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { de } from './de';
import type { DictKey } from './de';
import { en } from './en';

export type Lang = 'de' | 'en';

const STORAGE_KEY = 'queen-lang';

const dicts = { de, en } as const;

function readStoredLang(): Lang | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'de' || stored === 'en') return stored;
    }
  } catch {
    // ignore (SSR / test env without localStorage)
  }
  return null;
}

function browserLang(): Lang {
  try {
    if (typeof navigator !== 'undefined') {
      const candidates = [navigator.language, ...(Array.isArray(navigator.languages) ? navigator.languages : [])];
      for (const candidate of candidates) {
        const lower = candidate?.toLowerCase();
        if (lower?.startsWith('de')) return 'de';
        if (lower?.startsWith('en')) return 'en';
      }
    }
  } catch {
    // ignore environments without navigator
  }
  return 'de';
}

function readInitialLang(): Lang {
  return readStoredLang() ?? browserLang();
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'de',
  setLang: () => {},
  t: (key: DictKey) => de[key] ?? key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
  }, []);

  const t = useCallback(
    (key: DictKey): string => dicts[lang][key] ?? key,
    [lang],
  );

  useEffect(() => {
    try {
      if (typeof document !== 'undefined') {
        document.documentElement.lang = lang;
      }
    } catch {
      // ignore environments without document
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, lang);
      }
    } catch {
      // ignore write failures (private mode etc.)
    }
  }, [lang]);

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}
