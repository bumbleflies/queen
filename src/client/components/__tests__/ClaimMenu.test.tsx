import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClaimMenu } from '../ClaimMenu';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { ToastProvider } from '../Toast';

function renderMenu() {
  const preview = vi.fn();
  const correct = vi.fn();
  render(
    <LanguageProvider>
      <ToastProvider>
        <div className="card">
          <ClaimMenu onPreview={preview} onCorrect={correct} onReimport={vi.fn()} onIgnore={vi.fn()} />
        </div>
      </ToastProvider>
    </LanguageProvider>,
  );
  return { preview, correct };
}

beforeEach(() => {
  localStorage.setItem('queen-lang', 'de');
});

describe('ClaimMenu', () => {
  it('opens a floating menu outside the card and closes it with Escape', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Aktionen/ }));
    const preview = screen.getByRole('menuitem', { name: 'Vorschau' });
    expect(preview.closest('.card')).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menuitem', { name: 'Vorschau' })).not.toBeInTheDocument();
  });

  it('runs the chosen action and closes the menu', async () => {
    const { preview } = renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Aktionen/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Vorschau' }));
    expect(preview).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menuitem', { name: 'Vorschau' })).not.toBeInTheDocument();
  });

  it('keeps the menu open through the scroll caused by clicking the trigger', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Aktionen/ }));
    fireEvent.scroll(window);
    expect(screen.getByRole('menuitem', { name: 'Vorschau' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 250));
    fireEvent.scroll(window);
    expect(screen.queryByRole('menuitem', { name: 'Vorschau' })).not.toBeInTheDocument();
  });

  it('closes on an outside pointer down', async () => {
    renderMenu();
    await userEvent.click(screen.getByRole('button', { name: /Aktionen/ }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menuitem', { name: 'Vorschau' })).not.toBeInTheDocument();
  });
});
