import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GoogleAccessSection } from '../GoogleAccessSection';
import { LanguageProvider } from '../../i18n/LanguageContext';

function renderSection() {
  return render(
    <LanguageProvider>
      <GoogleAccessSection />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
});

describe('GoogleAccessSection', () => {
  it('offers a link that re-runs the Google consent flow', () => {
    renderSection();
    const link = screen.getByRole('link', { name: /Google-Zugang erneuern/i });
    expect(link).toHaveAttribute('href', '/auth/google');
  });

  it('names the permissions it renews and who the cron borrows them from', () => {
    renderSection();
    // The scope widening that broke bill-intake mail (gmail.send) is the reason this exists.
    expect(screen.getByText(/E-Mails senden/i)).toBeInTheDocument();
    expect(screen.getByText(/zuletzt gespeichert hat/i)).toBeInTheDocument();
  });

  it('speaks English when the language is switched', () => {
    localStorage.setItem('queen-lang', 'en');
    renderSection();
    expect(screen.getByRole('link', { name: /Renew Google access/i })).toBeInTheDocument();
  });
});
