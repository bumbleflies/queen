import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../Toast';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.error('Betrag fehlt')}>Fehler</button>
      <button type="button" onClick={() => toast.show('Hinweis')}>Info</button>
    </>
  );
}

describe('ToastProvider', () => {
  it('replaces a repeated message instead of stacking identical toasts', async () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Fehler' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fehler' }));
    await userEvent.click(screen.getByRole('button', { name: 'Info' }));

    expect(screen.getAllByText('Betrag fehlt')).toHaveLength(1);
    expect(screen.getAllByText('Hinweis')).toHaveLength(1);
  });
});
