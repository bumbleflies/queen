import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { useToast } from './Toast';
import { useLanguage } from '../i18n/LanguageContext';
import { formatDateTime } from '../lib/format';

/**
 * Admin roster. The invite link is shown once after it is created — queen stores
 * only its hash, so it cannot be displayed again, only replaced.
 */
export function UsersSection() {
  const { t } = useLanguage();
  const toast = useToast();
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery();
  const invite = trpc.users.invite.useMutation();
  const revoke = trpc.users.revokeInvite.useMutation();
  const updateRole = trpc.users.setRole.useMutation();
  const setDisabled = trpc.users.setDisabled.useMutation();

  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'user'>('user');
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function run(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      await utils.users.list.invalidate();
      toast.show(message);
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function sendInvite() {
    try {
      const res = await invite.mutateAsync({ email: email.trim(), role: newRole });
      setIssued({ url: res.url, expiresAt: String(res.expiresAt) });
      setEmail('');
      await utils.users.list.invalidate();
      toast.show(t('settings.usersInvited'));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function copyLink() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      toast.show(t('settings.usersCopied'));
    } catch {
      toast.error(t('settings.usersCopyFailed'));
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: 18 }}>{t('settings.usersTitle')}</h2>
      <p className="muted" style={{ margin: 0 }}>{t('settings.usersHint')}</p>

      <div className="row">
        <input
          className="field"
          type="email"
          aria-label={t('settings.usersEmail')}
          placeholder="name@example.de"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select
          className="field"
          aria-label={t('settings.usersRole')}
          value={newRole}
          onChange={(e) => setNewRole(e.target.value === 'admin' ? 'admin' : 'user')}
        >
          <option value="user">{t('settings.usersRoleUser')}</option>
          <option value="admin">{t('settings.usersRoleAdmin')}</option>
        </select>
        <button type="button" className="btn" disabled={!validEmail || invite.isPending} onClick={sendInvite}>
          {t('settings.usersInvite')}
        </button>
      </div>

      {issued ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="lbl">
            {t('settings.usersLink')} · {t('settings.usersLinkExpires')}{' '}
            {formatDateTime(issued.expiresAt)}
          </div>
          <div className="row">
            <input
              className="field"
              readOnly
              aria-label={t('settings.usersLink')}
              value={issued.url}
              onFocus={(e) => e.currentTarget.select()}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="button" className="btn ghost" onClick={copyLink}>
              {t('settings.usersCopy')}
            </button>
          </div>
        </div>
      ) : null}

      <table className="resp">
        <thead>
          <tr>
            <th>{t('settings.usersEmail')}</th>
            <th>{t('settings.usersRole')}</th>
            <th>{t('settings.usersLastLogin')}</th>
            <th>{t('settings.usersDrive')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.id} style={u.disabled ? { opacity: 0.55 } : undefined}>
              <td data-l={t('settings.usersEmail')}>{u.email}</td>
              <td data-l={t('settings.usersRole')}>
                <select
                  className="field"
                  aria-label={`${t('settings.usersRole')} ${u.email}`}
                  value={u.role}
                  onChange={(e) =>
                    run(
                      () => updateRole.mutateAsync({ id: u.id, role: e.target.value === 'admin' ? 'admin' : 'user' }),
                      t('settings.usersSaved'),
                    )
                  }
                >
                  <option value="user">{t('settings.usersRoleUser')}</option>
                  <option value="admin">{t('settings.usersRoleAdmin')}</option>
                </select>
              </td>
              <td data-l={t('settings.usersLastLogin')}>
                {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : t('settings.usersNever')}
              </td>
              <td data-l={t('settings.usersDrive')}>
                {u.hasDrive || u.hasGoogle ? 'Google' : '—'}
              </td>
              <td>
                <div className="row">
                  {u.inviteExpiresAt ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => run(() => revoke.mutateAsync({ id: u.id }), t('settings.usersRevoked'))}
                    >
                      {t('settings.usersRevoke')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      run(
                        () => setDisabled.mutateAsync({ id: u.id, disabled: !u.disabled }),
                        t('settings.usersSaved'),
                      )
                    }
                  >
                    {u.disabled ? t('settings.usersEnable') : t('settings.usersDisable')}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {users.isError ? (
        <p style={{ color: 'var(--danger)', margin: 0 }}>{(users.error as unknown as Error).message}</p>
      ) : null}
    </section>
  );
}
