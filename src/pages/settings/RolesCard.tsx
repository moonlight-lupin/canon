// Settings → Roles & permissions (administrators): what each role may see and change, per part of Canon. The ready-made roles can
// be changed (the Administrator always has everything); a church can add its own. The same roles decide what AI
// assistants may do for a person.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, Modal, Seg, confirmAction, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { MODULE_LABEL, PERM_MODULES, type Access, type PermModule, type RoleDef } from '../../../shared/permissions.ts';
import type { L10n } from '../../types-client.ts';

export type RolesData = { roles: RoleDef[]; use: Record<string, number> };
export const useRoles = () => useApi<RolesData>('/access-roles');

const ACCESS_LABEL: Record<Access, string> = { none: 'No access', read: 'Read', edit: 'Edit' };

export function RolesCard({ data, reload }: { data: RolesData | undefined; reload: () => void }) {
  const { t, lt } = useI18n();
  const [editing, setEditing] = useState<RoleDef | 'new' | null>(null);
  if (!data) return <Loading />;
  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('Roles & permissions')} <InfoTip text={t('What each role may see and change. Canon’s ready-made roles can be adjusted to your church; add a role for anything else. AI assistants acting for a person follow the same role.')} /></h3>
        <button className="btn sm" onClick={() => setEditing('new')}><Icon name="plus" />{t('New role')}</button>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>{t('Role')}</th>{PERM_MODULES.map((m) => <th key={m} className="center small">{t(MODULE_LABEL[m])}</th>)}<th className="center small">{t('Members’ details')}</th><th className="right">{t('Accounts')}</th><th /></tr></thead>
          <tbody>
            {data.roles.map((r) => (
              <tr key={r.key}>
                <td><strong>{lt(r.name)}</strong><div className="small muted">{lt(r.description)}</div></td>
                {PERM_MODULES.map((m) => <td key={m} className="center"><AccessMark a={r.admin ? 'edit' : r.access[m]} /></td>)}
                <td className="center">{r.member_details ? <Icon name="check" width={14} height={14} /> : '—'}</td>
                <td className="right">{data.use[r.key] ?? 0}</td>
                <td className="right">{!r.admin && <button className="btn sm ghost" onClick={() => setEditing(r)}><Icon name="edit" />{t('Edit')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <RoleEditor role={editing === 'new' ? null : editing} canDelete={editing !== 'new' && !editing.builtin && !(data.use[editing.key] ?? 0)} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}

function AccessMark({ a }: { a: Access }) {
  const { t } = useI18n();
  return a === 'edit' ? <span className="badge ok" title={t('Edit')}>{t('Edit')}</span> : a === 'read' ? <span className="badge" title={t('Read')}>{t('Read')}</span> : <span className="muted" title={t('No access')}>—</span>;
}

function RoleEditor({ role, canDelete, onClose, onSaved }: { role: RoleDef | null; canDelete: boolean; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(role?.name ?? {});
  const [description, setDescription] = useState<L10n>(role?.description ?? {});
  const [access, setAccess] = useState<Record<PermModule, Access>>(role?.access ?? Object.fromEntries(PERM_MODULES.map((m) => [m, 'read'])) as Record<PermModule, Access>);
  const [details, setDetails] = useState(role?.member_details ?? false);
  const [sensitive, setSensitive] = useState(role?.sensitive_fields ?? false);
  const [reopen, setReopen] = useState(role?.reopen_counts ?? false);
  const save = () => run(async () => {
    const body = { name, description, access, member_details: details, sensitive_fields: sensitive, reopen_counts: reopen };
    if (role) await api.patch(`/access-roles/${role.key}`, body);
    else await api.post('/access-roles', body);
    onSaved();
    onClose();
  }, t('Saved.'));
  const remove = () => {
    if (!role || !confirmAction(t('Delete this role?'))) return;
    run(async () => {
      await api.del(`/access-roles/${role.key}`);
      onSaved();
      onClose();
    }, t('Deleted.'));
  };
  return (
    <Modal title={role ? t('Edit role') : t('New role')} onClose={onClose} size="lg" footer={
      <>
        {canDelete && <button className="btn danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} placeholder={{ en: 'Worship leader', zh: '敬拜主领' }} /></Field>
        <Field label={t('Description')}><L10nInput value={description} onChange={setDescription} /></Field>
        <table className="t">
          <thead><tr><th>{t('Part of Canon')}</th><th>{t('Access')}</th></tr></thead>
          <tbody>
            {PERM_MODULES.map((m) => (
              <tr key={m}>
                <td>{t(MODULE_LABEL[m])}</td>
                <td><Seg<Access> value={access[m]} onChange={(v) => setAccess({ ...access, [m]: v })} options={(['none', 'read', 'edit'] as Access[]).map((a) => ({ value: a, label: t(ACCESS_LABEL[a]) }))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check"><input type="checkbox" checked={details} onChange={(e) => setDetails(e.target.checked)} />{t('Sees members’ contact details and notes')} <InfoTip text={t('Phone, e-mail, address, pastoral notes, reasons for absence and the year of birth. Without it, members show by name with their birthday (day and month).')} /></label>
        <label className="check"><input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />{t('Sees member fields marked sensitive')}</label>
        <label className="check"><input type="checkbox" checked={reopen} onChange={(e) => setReopen(e.target.checked)} />{t('Reopens verified cash counts and deletes service records')}</label>
      </div>
    </Modal>
  );
}

/** Settings → Roles & permissions: the roles table on its own (administrators change roles here). */
export function RolesTab() {
  const roles = useRoles();
  return <RolesCard data={roles.data} reload={roles.reload} />;
}
