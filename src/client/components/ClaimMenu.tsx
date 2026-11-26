import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../i18n/LanguageContext';

interface Props {
  onPreview: () => void;
  onCorrect: () => void;
  onReimport: () => void;
  onIgnore: () => void;
  reimportPending?: boolean;
  /** Only a booked claim has no re-import/correction-as-new-read. */
  booked?: boolean;
}

/**
 * Secondary claim actions. The popup lives in a portal at document.body: a
 * floating menu inside the table would be clipped by the card's overflow, and
 * an in-flow menu pushes the whole row open. Fixed positioning keeps it above
 * the card without resizing anything.
 */
export function ClaimMenu({ onPreview, onCorrect, onReimport, onIgnore, reimportPending, booked }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (popup.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    };
    const onScroll = () => close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, close]);

  function toggle() {
    if (open) {
      close();
      return;
    }
    const rect = trigger.current?.getBoundingClientRect();
    const width = 180;
    const height = booked ? 132 : 220;
    const below = rect ? rect.bottom + 4 : 0;
    const top = below + height > window.innerHeight && rect ? Math.max(8, rect.top - height - 4) : below;
    const left = rect ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) : 8;
    setPosition({ top, left });
    setOpen(true);
  }

  function run(action: () => void) {
    close();
    action();
  }

  return (
    <>
      <button
        type="button"
        className="btn ghost sm claim-menu-trigger"
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={toggle}
      >
        {t('expenses.actions')}
        <span aria-hidden="true">{open ? ' ▴' : ' ▾'}</span>
      </button>
      {open
        ? createPortal(
            <div
              className="claim-popover"
              role="menu"
              ref={popup}
              style={{ top: position.top, left: position.left, width: 180 }}
            >
              <button type="button" className="btn ghost sm" role="menuitem" onClick={() => run(onPreview)}>
                {t('expenses.preview')}
              </button>
              {booked ? null : (
                <>
                  <button type="button" className="btn ghost sm" role="menuitem" onClick={() => run(onCorrect)}>
                    {t('expenses.correctLabel')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    role="menuitem"
                    disabled={reimportPending}
                    onClick={() => run(onReimport)}
                  >
                    {t('expenses.reimport')}
                  </button>
                </>
              )}
              <button type="button" className="btn ghost sm" role="menuitem" onClick={() => run(onIgnore)}>
                {t('expenses.ignore')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
