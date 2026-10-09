// Settings → Users: accounts, roles and passwords.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Field, Loading, Modal, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { Lang, Role } from '../../types-client.ts';
import { fmtStamp } from './common.tsx';
import { useRoles } from './RolesCard.tsx';
import { useCongregations } from '../../components/Congregations.tsx';
import type { RoleDef } from '../../../shared/permissions.ts';
import { Combo, type ComboOption } from '../../components/Combo.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import '../people.css';

export type UserRow = { id: number; username: string; display_name: string; role: Role; lang: Lang; created_at: string; person_id?: number | null; person_name?: string | null; congregation_id?: number | null; totp_enabled?: number | boolean; locked?: number | boolean; first_admin?: boolean; needs_member?: boolean; must_change_password?: number | boolean; unknown_role?: boolean };

/** The external guest role (an auditor, say): read-only, and the only accounts not linked to a member. */
export const GUEST_ROLE = 'guest';

export function UsersTab() {
  const { t, lang, lt } = useI18n();
  const { user: me } = useSession();
  const roles = useRoles();
  const { data, error, loading, reload } = useApi<UserRow[]>('/users');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  // the member each account belongs to: leaders record the meetings they lead with it
  const people = useApi<{ rows: { id: number; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }[] }>('/people?limit=5000');
  const personOptions: ComboOption[] = (people.data?.rows ?? []).map((p) => ({
    value: String(p.id), label: `${p.preferred_name || p.first_name} ${p.last_name}`.trim() + (p.native_name ? ` ${p.native_name}` : ''),
  })).sort((a, b) => a.label.localeCompare(b.label));
  // churches with several congregations: an account can be limited to one (administrators never are)
  const congs = useCongregations();
  const setCongregation = async (u: UserRow, c: number | null) => {
    if (await run(() => api.patch(`/users/${u.id}`, { congregation_id: c }), t('Saved.'))) reload();
  };
  const setPerson = async (u: UserRow, personId: number | null) => {
    if (await run(() => api.patch(`/users/${u.id}`, { person_id: personId }), t('Saved.'))) reload();
  };
  const resetTwoStep = async (u: UserRow) => {
    if (!confirmAction(t('Turn off two-step sign-in for {name}? They are signed out everywhere and their AI assistants are disconnected; they sign in with their password and can set it up again.').replace('{name}', u.display_name))) return;
    if (await run(() => api.patch(`/users/${u.id}`, { reset_two_step: true }), t('Saved.'))) reload();
  };
  const setRole = async (u: UserRow, role: Role) => {
    if (await run(() => api.patch(`/users/${u.id}`, { role }), t('Saved.'))) reload();
  };
  const remove = async (u: UserRow) => {
    if (!confirmAction(`${t('Delete user')} ${u.username}?`)) return;
    if (await run(() => api.del(`/users/${u.id}`), t('Deleted.'))) reload();
  };

  return (
    <div className="stack">
      <div className="row end"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />{t('Add user')}</button></div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Display name')}</th><th>{t('Username')}</th><th>{t('Role')}</th>{congs.length > 0 && <th>{t('Limited to')} <InfoTip text={t('An account limited to one congregation sees its services, meetings, records, members and groups, and the whole church’s — not those of other congregations. Administrators always see everything.')} /></th>}<th>{t('Member')} <InfoTip text={t('The member this account belongs to. A member who leads a group or a meeting can then record those meetings, even with a read-only account.')} /></th><th>{t('Created')}</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">
                    {u.display_name}{u.id === me.id && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('You')}</span>}
                    {!!u.totp_enabled && <span className="badge ok" style={{ marginLeft: 6 }} title={t('Two-step sign-in')}>2FA</span>}
                    {!!u.locked && <span className="badge warn" style={{ marginLeft: 6 }} title={t('Waiting after wrong passwords (a little longer each time, up to 15 minutes); a new password ends the wait')}>{t('Locked')}</span>}
                    {!!u.must_change_password && <span className="badge" style={{ marginLeft: 6 }} title={t('They choose their own password at their next sign-in.')}>{t('New password due')}</span>}
                  </td>
                  <td className="nowrap"><span className="code">{u.username}</span></td>
                  <td>
                    <select className="mini" value={u.role} disabled={u.id === me.id || busy} onChange={(e) => setRole(u, e.target.value as Role)} aria-label={t('Role')}>
                      {(roles.data?.roles ?? []).filter((r) => !r.archived || r.key === u.role).map((r) => <option key={r.key} value={r.key}>{lt(r.name)}</option>)}
                      {!roles.data?.roles.some((r) => r.key === u.role) && <option value={u.role}>{u.role}</option>}
                    </select>
                    {u.unknown_role && <div className="small" style={{ color: 'var(--warn)', marginTop: 3 }}>{t('Canon doesn’t know this role: the account has no access until you choose one.')}</div>}
                  </td>
                  {congs.length > 0 && (
                    <td>
                      <select className="mini" value={u.congregation_id ?? ''} disabled={busy} onChange={(e) => setCongregation(u, Number(e.target.value) || null)} aria-label={t('Limited to')}>
                        <option value="">{t('Whole church')}</option>
                        {congs.map((c) => <option key={c.id} value={c.id}>{lt(c.name)}</option>)}
                      </select>
                    </td>
                  )}
                  <td style={{ minWidth: 200 }}>
                    {u.role === GUEST_ROLE && !u.person_id
                      ? <span className="small muted">{t('External guest: no member')}</span>
                      : <Combo value={u.person_id ? String(u.person_id) : ''} options={personOptions} noneLabel="—" ariaLabel={t('Member')} disabled={busy}
                        onChange={(v) => setPerson(u, v ? Number(v) : null)} />}
                    {u.needs_member && <div className="small" style={{ color: 'var(--warn)', marginTop: 3 }}>{t('Link to a member, or make it an external guest account')}</div>}
                    {u.first_admin && !u.person_id && <div className="small muted" style={{ marginTop: 3 }}>{t('Set Canon up: link to your own member record')}</div>}
                  </td>
                  <td className="nowrap muted small">{fmtStamp(u.created_at, lang)}</td>
                  <td className="right nowrap">
                    <button className="btn sm" onClick={() => setResetting(u)}><Icon name="lock" />{t('Reset password')}</button>{' '}
                    {!!u.totp_enabled && u.id !== me.id && <button className="btn sm ghost" disabled={busy} onClick={() => resetTwoStep(u)} title={t('A lost phone: turn their two-step sign-in off so they can set it up again')}>{t('Reset 2-step')}</button>}
                    {u.id !== me.id && <button className="btn ghost sm icon" onClick={() => remove(u)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>{t('What each role may see and change is set in')} <a href="/settings?tab=roles">{t('Roles & permissions')}</a>.</p>
      {adding && <AddUserModal roles={(roles.data?.roles ?? []).filter((r) => !r.archived)} people={personOptions} onClose={() => setAdding(false)} onSaved={() => { reload(); roles.reload(); }} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

export function AddUserModal({ roles, people, onClose, onSaved }: { roles: RoleDef[]; people: ComboOption[]; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [d, setD] = useState({ username: '', display_name: '', password: '', role: 'editor' as Role, person_id: null as number | null });
  const guest = d.role === GUEST_ROLE;
  const save = async () => {
    const ok = await run(async () => {
      if (!guest && !d.person_id) throw new Error(t('Choose the member this account belongs to (only an external guest account is without one).'));
      if (d.password.length < 8) throw new Error(t('The password needs at least 8 characters.'));
      return api.post('/users', { ...d, person_id: guest ? null : d.person_id, username: d.username.trim(), display_name: d.display_name.trim() });
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
        <Field label={t('Role')} hint={lt(roles.find((r) => r.key === d.role)?.description ?? {})}>
          <select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as Role })}>
            {roles.map((r) => <option key={r.key} value={r.key}>{lt(r.name)}</option>)}
          </select>
        </Field>
        {guest
          ? <Field label={t('Member')} hint={t('An external guest (an auditor, say) is not a church member.')}><div className="small muted" style={{ paddingTop: 8 }}>{t('External guest: no member')}</div></Field>
          : (
            <Field label={t('Member')} hint={t('The church member this account belongs to. Add them in Members first if they are not there yet.')}>
              <Combo value={d.person_id ? String(d.person_id) : ''} options={people} noneLabel="—" ariaLabel={t('Member')}
                onChange={(v) => {
                  const p = people.find((o) => o.value === v);
                  setD({ ...d, person_id: v ? Number(v) : null, display_name: d.display_name || (p?.label ?? '') });
                }} />
            </Field>
          )}
        <Field label={t('Display name')}><input autoFocus value={d.display_name} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></Field>
        <Field label={t('Username')}><input autoComplete="off" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} /></Field>
        <Field label={t('Password')} hint={t('At least 8 characters. They choose their own when they first sign in.')}>
          <input type="password" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function ResetPasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useI18n();
  const { user: me } = useSession();
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
      <Field label={t('New password')} hint={user.id === me.id ? undefined : `${t('They will be signed out everywhere, and their AI assistants disconnected.')} ${t('They choose their own password at their next sign-in.')}`}>
        <input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- AI / MCP
