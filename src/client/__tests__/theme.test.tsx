import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../theme/ThemeContext';

const listeners: Array<(e: MediaQueryListEvent) => void> = [];

function stubMatchMedia(dark: boolean) {
  listeners.length = 0;
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: dark ? query.includes('dark') : false,
      media: query,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      },
    })),
  );
}

function Probe() {
  const { theme, setTheme, resolved } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        to-dark
      </button>
      <button type="button" onClick={() => setTheme('light')}>
        to-light
      </button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = '';
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('theme', () => {
  it("defaults to system: matchMedia dark → dataset.theme 'dark'", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it("explicit 'dark' persists to localStorage 'queen-theme' and sets data-theme", () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('to-dark'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(localStorage.getItem('queen-theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it("switching to light sets data-theme 'light'", () => {
    stubMatchMedia(false);
    localStorage.setItem('queen-theme', 'dark');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(screen.getByText('to-light'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('queen-theme')).toBe('light');
  });

  it("system theme reacts to matchMedia change events", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => {
      for (const cb of listeners) cb({ matches: false } as MediaQueryListEvent);
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
