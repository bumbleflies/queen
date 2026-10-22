import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LanguageProvider } from '../i18n/LanguageContext';

const state = vi.hoisted(() => ({
  /** How `utils.ledger.invalidate()` behaves after a post: hang, fail or resolve. */
  invalidate: 'hang' as 'hang' | 'fail' | 'ok',
  invalidations: 0,
  posts: [] as unknown[],
}));

const shown = vi.hoisted(() => [] as string[]);

vi.mock('../components/Toast', () => ({
  useToast: () => ({
    show: (m: string) => shown.push(m),
    error: (m: string) => shown.push(`error: ${m}`),
  }),
}));

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      ledger: {
        invalidate: () => {
          state.invalidations += 1;
          if (state.invalidate === 'fail') return Promise.reject(new Error('refetch failed'));
          if (state.invalidate === 'ok') return Promise.resolve();
          // A live Firefly round-trip in `ledger.availableCash` can take long or hang.
          return new Promise<void>(() => {});
        },
      },
    }),
    accounts: { list: { useQuery: () => ({ data: [{ number: '1800', name: 'Bank' }, { number: '2900', name: 'Kapital' }] }) } },
    ledger: {
      postManual: {
        useMutation: () => ({
          mutateAsync: async (input: unknown) => {
            state.posts.push(input);
            return { entryNumber: '2026-00042' };
          },
          isPending: false,
        }),
      },
    },
  },
}));

import { EntryForm } from '../components/EntryForm';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('queen-lang', 'de');
  state.invalidate = 'hang';
  state.invalidations = 0;
  state.posts = [];
  shown.length = 0;
});

/** Fill a balanced entry (1800 Soll 100,00 / 2900 Haben 100,00) and click Buchen. */
function fillAndPost(onDone: () => void) {
  const { container } = render(
    <LanguageProvider>
      <EntryForm year={2026} onDone={onDone} />
    </LanguageProvider>,
  );
  fireEvent.change(screen.getByLabelText('Buchungstext'), { target: { value: 'Eröffnung' } });
  const rows = container.querySelectorAll('tbody tr');
  const inputs = (i: number) => rows[i].querySelectorAll('input');
  fireEvent.change(inputs(0)[0], { target: { value: '1800' } });
  fireEvent.change(inputs(0)[1], { target: { value: '100,00' } });
  fireEvent.change(inputs(1)[0], { target: { value: '2900' } });
  fireEvent.change(inputs(1)[2], { target: { value: '100,00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buchen' }));
}

describe('EntryForm — feedback after posting', () => {
  it('confirms and closes without waiting for the ledger refetch (Firefly can hang)', async () => {
    const onDone = vi.fn();
    fillAndPost(onDone);

    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 500 });
    expect(shown).toEqual(['Buchung erfasst.']);
    expect(state.posts).toHaveLength(1);
    expect(state.invalidations).toBe(1);
  });

  it('still reports success when the refetch itself fails', async () => {
    state.invalidate = 'fail';
    const onDone = vi.fn();
    fillAndPost(onDone);

    await waitFor(() => expect(onDone).toHaveBeenCalled(), { timeout: 500 });
    expect(shown).toEqual(['Buchung erfasst.']);
    expect(state.posts).toHaveLength(1);
  });
});
