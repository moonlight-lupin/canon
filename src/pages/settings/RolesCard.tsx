// Settings → Roles & permissions (administrators): what each role may see and change, per part of Canon. The ready-made roles can
// be changed (the Administrator always has everything); a church can add its own. Each role's ⋯ menu edits, duplicates,
// archives / restores or deletes it, as on templates. The same roles decide what AI assistants may do for a person.
import { useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, L10nInput, Loading, Modal, Seg, confirmAction, useAction } from '../../components/ui.tsx';
import { CardMenu, type CardAction } from '../template-ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { MODULE_LABEL, PERM_MODULES, type Access, type PermModule, type RoleDef } from '../../../shared/permissions.ts';
import type { L10n } from '../../types-client.ts';

export type RolesData = { roles: RoleDef[]; use: Record<string, number> };
export const useRoles = () => useApi<RolesData>('/access-roles');

const ACCESS_LABEL: Record<Access, string> = { none: 'No access', read: 'Read', edit: 'Edit' };

/** A role being edited, a new one, or a new one started from a copy of another. */
type Editing = { role: RoleDef | null; from?: RoleDef };

export function RolesCard({ data, reload }: { data: RolesData | undefined; reload: () => void }) {
  const { t, lt } = useI18n();
  const { run } = useAction();
  const [editing, setEditing] = useState<Editing | null>(null);
  if (!data) return <Loading />;
  const shown = data.roles.filter((r) => !r.archived);
  const archived = data.roles.filter((r) => r.archived);
  const setArchived = (r: RoleDef, on: boolean) => run(async () => {
    await api.put(`/access-roles/${r.key}/archived`, { archived: on });
    reload();
  }, on ? t('Archived. Find it under Archived roles.') : t('Restored.'));
  const remove = (r: RoleDef) => {
    if (!confirmAction(t('Delete this role?'))) return;
    run(async () => {
      await api.del(`/access-roles/${r.key}`);
      reload();
    }, t('Deleted.'));
  };
  const actions = (r: RoleDef): CardAction[] => {
    if (r.admin) return [];
    const used = data.use[r.key] ?? 0;
    // Edit is the button beside the role's name; the rest stay in the ⋯ menu
    const out: CardAction[] = [
      { label: t('Duplicate'), onClick: () => setEditing({ role: null, from: r }), title: t('Start a new role from a copy of this one.') },
    ];
    out.push(r.archived
      ? { label: t('Restore'), onClick: () => setArchived(r, false) }
      : { label: t('Archive'), onClick: () => setArchived(r, true), disabled: used > 0, title: used > 0 ? t('Accounts have this role: give them another role first.') : t('Keep it, but stop offering it for accounts.') });
    if (!r.builtin && !used) out.push({ label: t('Delete'), onClick: () => remove(r), danger: true });
    return out;
  };
  const row = (r: RoleDef) => (
    <tr key={r.key}>
      <td>
        {/* the description in a tooltip keeps the table compact */}
        <div className="row nowrap" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <strong>{lt(r.name)}</strong>
          {lt(r.description) && <InfoTip text={lt(r.description)} />}
          {!r.admin && <button className="btn ghost sm" onClick={() => setEditing({ role: r })}>{t('Edit')}</button>}
        </div>
      </td>
      {PERM_MODULES.map((m) => <td key={m} className="center"><AccessMark a={r.admin ? 'edit' : r.access[m]} /></td>)}
      <td className="center">{r.member_details ? <Icon name="check" width={14} height={14} /> : '—'}</td>
      <td className="right">{data.use[r.key] ?? 0}</td>
      <td className="right">{!r.admin && <CardMenu label={t('More actions')} actions={actions(r)} fixed />}</td>
    </tr>
  );
  const head = <thead><tr><th>{t('Role')}</th>{PERM_MODULES.map((m) => <th key={m} className="center small">{t(MODULE_LABEL[m])}</th>)}<th className="center small">{t('Members’ details')}</th><th className="right">{t('Accounts')}</th><th /></tr></thead>;
  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('Roles & permissions')} <InfoTip text={t('What each role may see and change. Canon’s ready-made roles can be adjusted to your church; add a role for anything else. AI assistants acting for a person follow the same role.')} /></h3>
        <button className="btn sm" onClick={() => setEditing({ role: null })}><Icon name="plus" />{t('New role')}</button>
      </div>
      <div className="table-wrap">
        <table className="t">
          {head}
          <tbody>{shown.map(row)}</tbody>
        </table>
      </div>
      {archived.length > 0 && (
        <details className="tp-hidden">
          <summary>{t('Archived roles')} <span className="badge">{archived.length}</span> <InfoTip text={t('Archived roles are not offered when you add an account or change its role. Use the ⋯ menu to restore one.')} /></summary>
          <div className="table-wrap">
            <table className="t">
              {head}
              <tbody>{archived.map(row)}</tbody>
            </table>
          </div>
        </details>
      )}
      {editing && <RoleEditor role={editing.role} from={editing.from} onClose={() => setEditing(null)} onSaved={reload} />}
    </section>
  );
}

function AccessMark({ a }: { a: Access }) {
  const { t } = useI18n();
  return a === 'edit' ? <span className="badge ok" title={t('Edit')}>{t('Edit')}</span> : a === 'read' ? <span className="badge" title={t('Read')}>{t('Read')}</span> : <span className="muted" title={t('No access')}>—</span>;
}

/** "(copy)" after each language's name, for a duplicated role. */
const copyName = (n: L10n): L10n => Object.fromEntries(Object.entries(n).filter(([, v]) => v?.trim()).map(([l, v]) => [l, `${v} (${l.startsWith('zh') ? '副本' : 'copy'})`]));

function RoleEditor({ role, from, onClose, onSaved }: { role: RoleDef | null; from?: RoleDef; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  // a duplicate starts as a new role with the other role's settings
  const base = role ?? from;
  const [name, setName] = useState<L10n>(role ? role.name : from ? copyName(from.name) : {});
  const [description, setDescription] = useState<L10n>(base?.description ?? {});
  const [access, setAccess] = useState<Record<PermModule, Access>>(base?.access ?? Object.fromEntries(PERM_MODULES.map((m) => [m, 'read'])) as Record<PermModule, Access>);
  const [details, setDetails] = useState(base?.member_details ?? false);
  const [sensitive, setSensitive] = useState(base?.sensitive_fields ?? false);
  const [reopen, setReopen] = useState(base?.reopen_counts ?? false);
  const save = () => run(async () => {
    const body = { name, description, access, member_details: details, sensitive_fields: sensitive, reopen_counts: reopen };
    if (role) await api.patch(`/access-roles/${role.key}`, body);
    else await api.post('/access-roles', body);
    onSaved();
    onClose();
  }, t('Saved.'));
  return (
    <Modal title={role ? t('Edit role') : t('New role')} onClose={onClose} size="lg" footer={
      <>
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
