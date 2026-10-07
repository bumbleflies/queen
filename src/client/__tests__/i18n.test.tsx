import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../i18n/LanguageContext';

function Probe() {
  const { t, setLang, lang } = useLanguage();
  return (
    <div>
      <span data-testid="label">{t('nav.invoices')}</span>
      <span data-testid="lang">{lang}</span>
      <button type="button" onClick={() => setLang('en')}>
        to-en
      </button>
      <button type="button" onClick={() => setLang('de')}>
        to-de
      </button>
    </div>
  );
}

const originalNavLang = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');

function setBrowserLang(lang: string, languages: string[] = [lang]) {
  Object.defineProperty(navigator, 'language', { value: lang, configurable: true });
  Object.defineProperty(navigator, 'languages', { value: languages, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
  setBrowserLang('de-DE', ['de-DE', 'de']);
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'language');
  Reflect.deleteProperty(navigator, 'languages');
  if (originalNavLang) {
    Object.defineProperty(Navigator.prototype, 'language', originalNavLang);
  }
});

describe('i18n', () => {
  it("defaults to the browser language (de-DE) and renders t('nav.invoices')='Rechnungen'", () => {
    setBrowserLang('de-DE');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('Rechnungen');
    expect(screen.getByTestId('lang')).toHaveTextContent('de');
  });

  it('defaults to the browser language (en-US) when not German', () => {
    setBrowserLang('en-US');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('Invoices');
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('falls back to DE for unsupported browser languages', () => {
    setBrowserLang('fr-FR', ['fr-FR', 'fr']);
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('de');
  });

  it("switching to EN gives t('nav.invoices')='Invoices'", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText('to-en'));
    expect(screen.getByTestId('label')).toHaveTextContent('Invoices');
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('persists the language to localStorage and updates document lang', () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText('to-en'));
    expect(localStorage.getItem('queen-lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    fireEvent.click(screen.getByText('to-de'));
    expect(localStorage.getItem('queen-lang')).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('restores the stored language from localStorage over the browser language', () => {
    setBrowserLang('de-DE');
    localStorage.setItem('queen-lang', 'en');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('Invoices');
    expect(document.documentElement.lang).toBe('en');
  });
});
