import { useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { useLanguage } from '../i18n/LanguageContext';
import type { DictKey } from '../i18n/de';

export interface PickerFolder {
  id: string;
  name: string | null;
}

export type PickerScope = 'invoices' | 'receipts';

const SCOPE_KEYS: Record<PickerScope, DictKey> = {
  invoices: 'settings.driveInvoices',
  receipts: 'settings.driveReceipts',
};

interface BrowseRow {
  id: string;
  name: string;
}

export function FolderPicker({
  scope,
  current,
  onClose,
}: {
  scope: PickerScope;
  current: PickerFolder | null;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const utils = trpc.useUtils();
  const [stack, setStack] = useState<PickerFolder[]>([{ id: 'root', name: t('settings.drive.root') }]);
  const here = stack[stack.length - 1];

  const folders = trpc.settings.browseDriveFolders.useQuery({ parentId: here.id }, { retry: false });
  const save = trpc.settings.setDriveFolders.useMutation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function pick() {
    await save.mutateAsync({ [scope]: { id: here.id, name: here.name } });
    await utils.settings.getDriveFolders.invalidate();
    onClose();
  }

  async function remove() {
    await save.mutateAsync({ [scope]: null });
    await utils.settings.getDriveFolders.invalidate();
    onClose();
  }

  return (
    <div
      className="backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog" style={{ maxHeight: 'calc(100vh - 80px)', overflowY: 'auto' }}>
        <h2>{t(SCOPE_KEYS[scope])}</h2>
        <nav className="row" aria-label={t('settings.drive.breadcrumbAria')}>
          {stack.map((f, i) => (
            <button
              key={`${f.id}-${i}`}
              type="button"
              className="chip"
              disabled={i === stack.length - 1}
              onClick={() => setStack(stack.slice(0, i + 1))}
            >
              {f.name}
            </button>
          ))}
        </nav>
        {folders.isLoading ? null : folders.isError ? (
          <p style={{ color: 'var(--danger)', margin: 0 }}>{(folders.error as unknown as Error).message}</p>
        ) : (folders.data ?? []).length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>—</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
            {((folders.data ?? []) as unknown as BrowseRow[]).map((f) => (
              <button
                key={f.id}
                type="button"
                className="btn ghost"
                onClick={() => setStack([...stack, { id: f.id, name: f.name }])}
              >
                {f.name}
              </button>
            ))}
          </div>
        )}
        <div className="row acts" style={{ marginTop: 8 }}>
          {stack.length > 1 ? (
            <button type="button" className="btn ghost" onClick={() => setStack(stack.slice(0, -1))}>
              {t('settings.drive.back')}
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          {current ? (
            <button type="button" className="btn ghost" onClick={remove}>{t('settings.drive.remove')}</button>
          ) : null}
          <button type="button" className="btn" disabled={save.isPending} onClick={pick}>
            {t('settings.drive.pick')}
          </button>
        </div>
      </div>
    </div>
  );
}
