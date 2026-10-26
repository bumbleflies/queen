import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { InvitePage } from '../InvitePage';
import { LanguageProvider } from '../../i18n/LanguageContext';

function renderPage() {
  return render(
    <LanguageProvider>
      <MemoryRouter initialEntries={['/invite']}>
        <Routes>
          <Route path="/invite" element={<InvitePage />} />
          <Route path="/dashboard" element={<div>dashboard-stub</div>} />
        </Routes>
      </MemoryRouter>
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
  window.history.replaceState(null, '', '/invite#tok-123');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InvitePage', () => {
  it('posts the fragment token and moves on to the dashboard', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText('dashboard-stub')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/auth/invite/redeem');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ token: 'tok-123' });
  });

  it('shows the invalid notice when the link is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 400 })));
    renderPage();
    expect(await screen.findByText(/ungültig|abgelaufen/i)).toBeInTheDocument();
    expect(screen.queryByText('dashboard-stub')).not.toBeInTheDocument();
  });

  it('does not call the server without a token', async () => {
    window.history.replaceState(null, '', '/invite');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText(/ungültig|abgelaufen/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
