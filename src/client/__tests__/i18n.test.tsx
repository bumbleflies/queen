import { describe, expect, it, beforeEach } from 'vitest';
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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('i18n', () => {
  it("defaults to DE and renders t('nav.invoices')='Rechnungen'", () => {
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('label')).toHaveTextContent('Rechnungen');
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

  it('restores EN from localStorage on init', () => {
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
