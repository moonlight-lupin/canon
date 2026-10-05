// Settings → Users: accounts, roles and passwords.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Field, Loading, Modal, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { Lang, Role } from '../../types-client.ts';
import { fmtStamp } from './common.tsx';
import '../people.css';

export type UserRow = { id: number; username: string; display_name: string; role: Role; lang: Lang; created_at: string };

export const ROLES: Role[] = ['admin', 'editor', 'viewer'];

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including users, church settings and AI access.',
  editor: 'Plans services and edits the registers, library and rota.',
  viewer: 'Read only — can view and print, and change their own password.',
};

export function UsersTab() {
  const { t, lang } = useI18n();
  const { user: me } = useSession();
  const { data, error, loading, reload } = useApi<UserRow[]>('/users');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const setRole = async (u: UserRow, role: Role) => {
    if (await run(() => api.patch(`/users/${u.id}`, { role }), t('Saved.'))) reload();
  };
  const remove = async (u: UserRow) => {
    if (!confirmAction(`${t('Delete user')} ${u.username}?`)) return;
    if (await run(() => api.del(`/users/${u.id}`), t('Deleted.'))) reload();
  };

  return (
    <div className="stack">
      <div className="card">
        <ul className="plain small">
          {ROLES.map((r) => <li key={r}><strong>{t(ROLE_LABEL[r])}</strong> — {t(ROLE_HELP[r])}</li>)}
        </ul>
      </div>
      <div className="row end"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />{t('Add user')}</button></div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Display name')}</th><th>{t('Username')}</th><th>{t('Role')}</th><th>{t('Created')}</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{u.display_name}{u.id === me.id && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('You')}</span>}</td>
                  <td className="nowrap"><span className="code">{u.username}</span></td>
                  <td>
                    <select className="mini" value={u.role} disabled={u.id === me.id || busy} onChange={(e) => setRole(u, e.target.value as Role)} aria-label={t('Role')}>
                      {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
                    </select>
                  </td>
                  <td className="nowrap muted small">{fmtStamp(u.created_at, lang)}</td>
                  <td className="right nowrap">
                    <button className="btn sm" onClick={() => setResetting(u)}><Icon name="lock" />{t('Reset password')}</button>
                    {u.id !== me.id && <button className="btn ghost sm icon" onClick={() => remove(u)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddUserModal onClose={() => setAdding(false)} onSaved={reload} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

export function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [d, setD] = useState({ username: '', display_name: '', password: '', role: 'editor' as Role });
  const save = async () => {
    const ok = await run(async () => {
      if (d.password.length < 8) throw new Error(t('The password needs at least 8 characters.'));
      return api.post('/users', { ...d, username: d.username.trim(), display_name: d.display_name.trim() });
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title={t('Add user')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <div className="form-grid">
        <Field label={t('Display name')}><input autoFocus value={d.display_name} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></Field>
        <Field label={t('Username')}><input autoComplete="off" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} /></Field>
        <Field label={t('Password')} hint={t('At least 8 characters. Ask them to change it after signing in.')}>
          <input type="password" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
        </Field>
        <Field label={t('Role')} hint={t(ROLE_HELP[d.role])}>
          <select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export function ResetPasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [pw, setPw] = useState('');
  const save = async () => {
    const ok = await run(async () => {
      if (pw.length < 8) throw new Error(t('The password needs at least 8 characters.'));
      return api.patch(`/users/${user.id}`, { password: pw });
    }, t('Password changed.'));
    if (ok) onClose();
  };
  return (
    <Modal title={`${t('Reset password')} · ${user.display_name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <Field label={t('New password')} hint={t('They will be signed out everywhere.')}>
        <input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- AI / MCP
