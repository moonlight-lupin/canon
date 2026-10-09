// Shared pieces for groups (committees, fellowships 团契, cell groups 小组, ministries) and team rosters:
// types, labels, the group form and the group detail modal. Used by Groups, Co-workers, Volunteers and Members.
import { useMemo, useState, type CSSProperties } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { isChinese } from '../../shared/languages.ts';
import { api, useApi } from '../api.ts';
import { tr, useContentLangs, useI18n, useLocales } from '../i18n.tsx';
import { Bi, ErrorBox, Field, L10nInput, Loading, Modal, confirmAction, fmtDate, useAction, useSession, useToast } from '../components/ui.tsx';
import { CongregationField } from '../components/Congregations.tsx';
import { Link } from 'react-router-dom';
import { InfoTip } from '../components/InfoTip.tsx';
import { Icon } from '../components/icons.tsx';
import type { MeetingPattern } from '../../shared/types.ts';
import type { Group, GroupKind, GroupMember, L10n, PersonRow, TeamWithRoles } from '../types-client.ts';
import { PeopleMultiSelect, PersonName } from './people-common.tsx';
import './groups.css';

// ---------------------------------------------------------------- types (server payloads)

export type GroupRow = Group & { member_count: number; leaders: { person_id: number; name: string; role: string | null }[] };
/** Groups whose meetings are kept here (serving teams serve at services; they don't hold meetings of their own). */
export const meetingGroups = (groups: GroupRow[] | undefined) => (groups ?? []).filter((g) => g.kind !== 'serving_team' && g.active);

export type MemberRow = GroupMember & {
  name: string; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null;
  status: string; phone: string | null; email: string | null; current: boolean;
};
export type GroupDetail = Group & { members: MemberRow[] };
export type CommitteeTag = { member_id: number; group_id: number; name: L10n; color: string; role: string | null };
export type CommitteesView = {
  committees: (GroupRow & { members: { id: number; person_id: number; name: string; role: string | null; start_date: string | null; end_date: string | null; positions: string[] }[] })[];
  tags: Record<number, CommitteeTag[]>;
};
export type PersonGroups = {
  groups: { id: number; group_id: number; name: L10n; kind: GroupKind; color: string; active: boolean; role: string | null; start_date: string | null; end_date: string | null; current: boolean }[];
  teams: { team_id: number; name: L10n; color: string; is_leader: boolean }[];
};
export type TeamMemberRef = { person_id: number; name: string; is_leader: boolean };
/** /api/teams payload: teams with roles and their member roster. */
export type TeamFull = TeamWithRoles & { members: TeamMemberRef[] };

// ---------------------------------------------------------------- labels

export const KINDS: GroupKind[] = ['committee', 'fellowship', 'cell_group', 'sunday_school', 'ministry', 'serving_team', 'other'];
/** Kinds a group can be given here (serving teams are added in Volunteers, where their rota roles are). */
export const FORM_KINDS: GroupKind[] = KINDS.filter((k) => k !== 'serving_team');
export const KIND_LABEL: Record<GroupKind, string> = {
  committee: 'Committee', fellowship: 'Fellowship', cell_group: 'Cell group', sunday_school: 'Sunday school class', ministry: 'Ministry', serving_team: 'Serving team', other: 'Other group',
};
export const KIND_PLURAL: Record<GroupKind, string> = {
  committee: 'Committees', fellowship: 'Fellowships', cell_group: 'Cell groups', sunday_school: 'Sunday school', ministry: 'Ministries', serving_team: 'Serving teams', other: 'Other groups',
};

/** Suggested member roles. Stored as typed; these English values have translations. Free text is allowed. */
export const ROLE_PRESETS = ['Moderator', 'Chair', 'Vice-chair', 'Secretary', 'Clerk', 'Treasurer', 'Leader', 'Assistant leader', 'Teacher', 'Assistant teacher', 'Advisor', 'Member', 'Pupil'];
// the translation keys of the preset roles, written out in full so `npm run i18n` lists them for translators
const ROLE_KEYS: Record<string, string> = {
  Moderator: 'Group role · Moderator', Chair: 'Group role · Chair', 'Vice-chair': 'Group role · Vice-chair', Secretary: 'Group role · Secretary',
  Clerk: 'Group role · Clerk', Treasurer: 'Group role · Treasurer', Leader: 'Group role · Leader', 'Assistant leader': 'Group role · Assistant leader',
  Teacher: 'Group role · Teacher', 'Assistant teacher': 'Group role · Assistant teacher', Advisor: 'Group role · Advisor', Member: 'Group role · Member',
  Pupil: 'Group role · Pupil',
};
const roleKey = (role: string) => ROLE_KEYS[role] ?? role;
/** A stored member role in a given UI language (preset roles are translated; anything else is shown as typed). */
export const roleIn = (role: string | null | undefined, lang: string) => {
  if (!role) return '';
  if (!ROLE_PRESETS.includes(role)) return role;
  const v = tr(roleKey(role), lang);
  return v === roleKey(role) ? role : v;
};

/** Role in the UI language, followed by the church's next language (e.g. "Moderator 议长"). */
export function RoleLabel({ role, className }: { role: string | null | undefined; className?: string }) {
  const { lang } = useI18n();
  const church = useContentLangs();
  const other = church.find((l) => l !== lang && !(isChinese(l) && isChinese(lang)));
  useLocales(other ? [other] : []);
  if (!role) return null;
  const first = roleIn(role, lang);
  const second = other ? roleIn(role, other) : '';
  return (
    <span className={className}>
      {first}
      {second && second !== first && <span className="muted" style={{ marginLeft: 4, fontWeight: 400 }}>{second}</span>}
    </span>
  );
}

/** Text input with role suggestions. */
export function RoleInput({ value, onChange, onBlur, className, placeholder }: { value: string; onChange: (v: string) => void; onBlur?: () => void; className?: string; placeholder?: string }) {
  const { lang, t } = useI18n();
  return (
    <>
      <input className={className} list="canon-group-roles" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} placeholder={placeholder ?? t('Role in group')} />
      <datalist id="canon-group-roles">
        {ROLE_PRESETS.map((r) => <option key={r} value={r}>{roleIn(r, lang) !== r ? roleIn(r, lang) : undefined}</option>)}
      </datalist>
    </>
  );
}

/** Coloured tag for a group membership, e.g. [Session · Clerk]. */
export function GroupTag({ name, color, role, onRemove, title }: { name: L10n; color: string; role?: string | null; onRemove?: () => void; title?: string }) {
  const { lt, t, lang } = useI18n();
  return (
    <span className="gtag" style={{ '--gc': color } as CSSProperties} title={title}>
      {lt(name)}
      {role && role !== 'Member' && <span className="r">· {roleIn(role, lang)}</span>}
      {onRemove && <button type="button" onClick={onRemove} aria-label={`${t('Remove')} ${lt(name)}`} title={t('Remove')}>×</button>}
    </span>
  );
}

export const groupStyle = (color: string) => ({ '--gc': color } as CSSProperties);

// ---------------------------------------------------------------- group form (create / edit)

export function GroupFormModal({
  group, kind, nextSort = 0, onClose, onSaved,
}: { group: Group | null; kind?: GroupKind; nextSort?: number; onClose: () => void; onSaved: (g: Group) => void }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(group?.name ?? {});
  const [k, setK] = useState<GroupKind>(group?.kind ?? kind ?? 'fellowship');
  const [meeting, setMeeting] = useState(group?.meeting ?? '');
  const [congregationId, setCongregationId] = useState<number | null>(group?.congregation_id ?? null);
  const [description, setDescription] = useState(group?.description ?? '');
  const [color, setColor] = useState(group?.color ?? (k === 'committee' ? '#7a2f2f' : '#2f4a7a'));
  const [active, setActive] = useState(group?.active ?? true);
  const [sort, setSort] = useState(group?.sort ?? nextSort);
  const [pattern, setPattern] = useState<MeetingPattern>(group?.pattern ?? {});
  const [ageMin, setAgeMin] = useState<number | null>(group?.age_min ?? null);
  const [ageMax, setAgeMax] = useState<number | null>(group?.age_max ?? null);
  const save = async () => {
    const g = await run(async () => {
      if (!hasAnyText(name)) throw new Error(t('Name is required.'));
      const body = {
        name, kind: k, meeting: meeting.trim() || null, description: description.trim() || null, color, active, sort, congregation_id: congregationId,
        ...(k === 'sunday_school' ? { age_min: ageMin, age_max: ageMax } : {}),
        ...(k !== 'serving_team' ? { pattern: cleanPattern(pattern) } : {}),
      };
      return group ? api.patch<Group>(`/groups/${group.id}`, body) : api.post<Group>('/groups', body);
    }, t('Saved.'));
    if (g) {
      onSaved(g);
      onClose();
    }
  };
  const placeholder = k === 'committee' ? { en: 'Session', zh: '堂会' } : k === 'cell_group' ? { en: 'Cheras Cell Group', zh: '蕉赖小组' } : { en: 'Young Adults Fellowship', zh: '青年团契' };
  return (
    <Modal title={group ? t('Edit group') : k === 'committee' && kind ? t('Add committee') : t('Add group')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <div className="stack">
        <Field label={t('Group name')}><L10nInput value={name} onChange={setName} placeholder={placeholder} /></Field>
        <div className="form-grid">
          <Field label={t('Kind')}>
            <select value={k} onChange={(e) => setK(e.target.value as GroupKind)} disabled={(!!kind && !group) || k === 'serving_team'}>
              {(k === 'serving_team' ? KINDS : FORM_KINDS).map((x) => <option key={x} value={x}>{t(KIND_LABEL[x])}</option>)}
            </select>
          </Field>
          <Field label={t('When it meets')} hint={t('e.g. Fridays 8pm, church hall')}><input value={meeting} onChange={(e) => setMeeting(e.target.value)} /></Field>
          <CongregationField value={congregationId} onChange={setCongregationId} />
          <Field label={t('Colour')}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
          <Field label={t('Order')}><input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} /></Field>
          {k === 'sunday_school' && (
            <Field label={t('Ages')} hint={t('The pupils’ ages, e.g. 6 to 8')}>
              <span className="row" style={{ gap: 6 }}>
                <input type="number" min={0} max={120} value={ageMin ?? ''} onChange={(e) => setAgeMin(e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} aria-label={t('From age')} />
                –
                <input type="number" min={0} max={120} value={ageMax ?? ''} onChange={(e) => setAgeMax(e.target.value === '' ? null : Number(e.target.value))} style={{ width: 80 }} aria-label={t('To age')} />
              </span>
            </Field>
          )}
          <Field label={t('Description')} className="span-all"><textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{t('Active')}</label>
        </div>
        {k !== 'serving_team' && settings?.modules?.meetings !== false && <PatternFields value={pattern} onChange={setPattern} />}
      </div>
    </Modal>
  );
}

/** Only what makes sense together: no weekday without a rhythm, no "which week" except monthly. */
const cleanPattern = (p: MeetingPattern): MeetingPattern => (!p.every ? { ...(p.time ? { time: p.time } : {}), ...(p.place ? { place: p.place } : {}) } : {
  every: p.every, weekday: p.weekday ?? 0, ...(p.every === 'month' ? { nth: p.nth ?? 1 } : {}),
  ...(p.time ? { time: p.time } : {}), ...(p.place?.trim() ? { place: p.place.trim() } : {}), ahead_weeks: p.ahead_weeks ?? 0,
});
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// written out in full so `npm run i18n` lists them for translators
const NTH = ['', 'Week · first', 'Week · second', 'Week · third', 'Week · fourth', 'Week · last'];

/** When the group meets: the rhythm, day, time and place its meetings are created with. */
function PatternFields({ value: p, onChange }: { value: MeetingPattern; onChange: (p: MeetingPattern) => void }) {
  const { t } = useI18n();
  const set = (x: Partial<MeetingPattern>) => onChange({ ...p, ...x });
  return (
    <div className="stack tight">
      <h3 className="sect" style={{ margin: 0 }}>{t('Meeting pattern')} <InfoTip text={t('How often and when the group meets. New meetings take this time and place, and Canon can create the meetings for the coming weeks so the leader just opens tonight’s.')} /></h3>
      <div className="form-grid">
        <Field label={t('Meets')}>
          <select value={p.every ?? ''} onChange={(e) => set({ every: (e.target.value || undefined) as MeetingPattern['every'] })}>
            <option value="">{t('No fixed pattern')}</option>
            <option value="week">{t('Every week')}</option>
            <option value="2weeks">{t('Every two weeks')}</option>
            <option value="month">{t('Once a month')}</option>
          </select>
        </Field>
        {p.every === 'month' && (
          <Field label={t('Which')}>
            <select value={p.nth ?? 1} onChange={(e) => set({ nth: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{t(NTH[n])}</option>)}
            </select>
          </Field>
        )}
        {p.every && (
          <Field label={t('Day')}>
            <select value={p.weekday ?? 0} onChange={(e) => set({ weekday: Number(e.target.value) })}>
              {WEEKDAYS.map((d, i) => <option key={d} value={i}>{t(d)}</option>)}
            </select>
          </Field>
        )}
        <Field label={t('Start time')}><input type="time" value={p.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} /></Field>
        <Field label={t('Place')}><input value={p.place ?? ''} onChange={(e) => set({ place: e.target.value })} /></Field>
        {p.every && (
          <Field label={t('Create meetings ahead')} hint={t('weeks; 0 = only when you choose')}>
            <input type="number" min={0} max={26} value={p.ahead_weeks ?? 0} onChange={(e) => set({ ahead_weeks: Math.max(0, Math.min(26, Number(e.target.value) || 0)) })} style={{ width: 90 }} />
          </Field>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- group detail (members, terms)

/** All people (for pickers), loaded once per modal. */
export const usePeople = () => useApi<{ total: number; rows: PersonRow[] }>('/people?limit=5000');

export function GroupDetailModal({ groupId, onClose, onChanged }: { groupId: number; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { canEdit } = useSession();
  const { data, error, reload } = useApi<GroupDetail>(`/groups/${groupId}`);
  const people = usePeople();
  const meetingsOn = useSession().settings?.modules?.meetings !== false;
  const toast = useToast();
  const { run, busy } = useAction();
  const [editing, setEditing] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [adding, setAdding] = useState<number[]>([]);
  const [addRole, setAddRole] = useState('');
  const [addStart, setAddStart] = useState('');

  const changed = () => {
    reload();
    onChanged();
  };
  const members = useMemo(() => (data?.members ?? []).filter((m) => showPast || m.current), [data, showPast]);
  const pastCount = (data?.members ?? []).filter((m) => !m.current).length;
  const memberIds = useMemo(() => new Set((data?.members ?? []).map((m) => m.person_id)), [data]);
  const candidates = useMemo(() => (people.data?.rows ?? []).filter((p) => !memberIds.has(p.id)), [people.data, memberIds]);

  const patch = async (m: MemberRow, body: Partial<Pick<GroupMember, 'role' | 'start_date' | 'end_date' | 'leads'>>) => {
    if (await run(() => api.patch(`/group-members/${m.id}`, body))) changed();
  };
  const remove = async (m: MemberRow) => {
    if (!confirmAction(t('Remove {name} from this group? To keep the record of a finished term, set an end date instead.').replace('{name}', m.name))) return;
    if (await run(() => api.del(`/group-members/${m.id}`), t('Removed.'))) changed();
  };
  const add = async () => {
    if (!adding.length) return;
    const ok = await run(async () => {
      for (const pid of adding) await api.post(`/groups/${groupId}/members`, { person_id: pid, role: addRole.trim() || null, start_date: addStart || null });
      return true;
    }, t('Saved.'));
    if (ok) {
      setAdding([]);
      setAddRole('');
      changed();
    }
  };
  const ahead = async () => {
    const r = await run(() => api.post<{ created: number }>(`/groups/${groupId}/meetings-ahead`, {}));
    if (r) toast(r.created ? t('{n} meetings created.').replace('{n}', String(r.created)) : t('The coming meetings already exist.'));
  };
  // coming meetings that were cancelled or moved: not made again from the pattern until restored
  const skips = useApi<{ date: string }[]>(meetingsOn && data?.pattern?.every ? `/groups/${groupId}/meeting-skips` : null);
  const restoreDate = async (date: string) => {
    if (await run(() => api.del(`/groups/${groupId}/meeting-skips/${date}`), t('Restored: it is made with the next meetings ahead.'))) skips.reload();
  };
  const delGroup = async () => {
    if (!data || !confirmAction(t('Delete this group and all its memberships? To keep the history, mark it inactive instead.'))) return;
    if (await run(() => api.del(`/groups/${groupId}`), t('Deleted.'))) {
      onChanged();
      onClose();
    }
  };

  return (
    <Modal
      title={data ? <span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: data.color, width: 10, height: 10 }} /><Bi v={data.name} /></span> : t('Group')}
      onClose={onClose} size="lg"
      footer={
        <>
          {canEdit && data && data.kind !== 'serving_team' && <button className="btn danger" onClick={delGroup} disabled={busy} style={{ marginRight: 'auto' }}><Icon name="trash" />{t('Delete')}</button>}
          <button className="btn" onClick={onClose}>{t('Close')}</button>
        </>
      }
    >
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : (
        <div className="stack">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="stack tight">
              <div className="row" style={{ gap: 6 }}>
                <span className="badge lapis">{t(KIND_LABEL[data.kind])}</span>
                {!data.active && <span className="badge">{t('Inactive')}</span>}
                {data.meeting && <span className="small muted row" style={{ gap: 4 }}><Icon name="clock" width={13} height={13} />{data.meeting}</span>}
                {data.kind === 'sunday_school' && (data.age_min != null || data.age_max != null) && <span className="small muted">{t('Ages')} {data.age_min ?? '?'}–{data.age_max ?? '?'}</span>}
              </div>
              {data.description && <p className="small" style={{ margin: 0 }}>{data.description}</p>}
              {data.kind === 'serving_team' && (
                <p className="small muted" style={{ margin: 0 }}>
                  {t('A volunteer team: its members are the team roster. Rota roles, qualifications and the team itself are managed in Volunteers.')}{' '}
                  <Link to="/volunteers?tab=teams">{t('Open Volunteers')} →</Link>
                </p>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {data.kind !== 'serving_team' && meetingsOn && <Link className="btn sm" to={`/meetings?group=${data.id}`}><Icon name="clock" />{t('Meetings')}</Link>}
              {canEdit && meetingsOn && data.pattern?.every && <button className="btn sm" onClick={ahead} disabled={busy} title={t('Create this group’s meetings for the coming weeks from its meeting pattern')}><Icon name="plus" />{t('Create meetings ahead')}</button>}
              {canEdit && <button className="btn sm" onClick={() => setEditing(true)}><Icon name="edit" />{t('Edit group')}</button>}
            </div>
          </div>
          {!!skips.data?.length && (
            <div className="small stack tight">
              <span className="muted">{t('Cancelled or moved, so not made from the pattern:')}</span>
              {skips.data.map((s) => (
                <span key={s.date} className="row" style={{ gap: 6, alignItems: 'center' }}>
                  {fmtDate(s.date, lang)}
                  {canEdit && <button className="btn sm ghost" onClick={() => void restoreDate(s.date)} disabled={busy}>{t('Restore')}</button>}
                </span>
              ))}
            </div>
          )}

          <div>
            <div className="row between" style={{ marginBottom: 6 }}>
              <h3 className="sect" style={{ margin: 0 }}>{t('Group members')} <span className="muted">· {data.members.filter((m) => m.current).length}</span></h3>
              {pastCount > 0 && (
                <label className="check small"><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />{t('Show past terms')} ({pastCount})</label>
              )}
            </div>
            {members.length ? (
              <div className="table-wrap card flush">
                <table className="t gm-table">
                  <thead><tr><th>{t('Name')}</th><th>{t('Role in group')}</th><th>{t('Leads')} <InfoTip text={t('Leaders can record this group’s meetings — headcount, visitors and the offering — with their own Canon account, even a read-only one, once it is linked to them (Settings → Users).')} /></th><th>{t('Term from')}</th><th>{t('Term to')}</th>{canEdit && <th />}</tr></thead>
                  <tbody>
                    {members.map((m) => (
                      <MemberLine key={m.id} m={m} canEdit={canEdit} busy={busy} onPatch={(b) => patch(m, b)} onRemove={() => remove(m)} lang={lang} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="muted small">{t('No members yet')}</p>}
          </div>

          {canEdit && (
            <div className="gm-add stack tight">
              <h3 className="sect" style={{ margin: 0 }}>{t('Add members')}</h3>
              {people.data ? <PeopleMultiSelect people={candidates} value={adding} onChange={setAdding} height={180} /> : <Loading />}
              <div className="row">
                <div style={{ width: 170 }}><RoleInput value={addRole} onChange={setAddRole} /></div>
                <label className="small muted row" style={{ gap: 6 }}>{t('Term from')}<input type="date" value={addStart} onChange={(e) => setAddStart(e.target.value)} style={{ width: 150 }} /></label>
                <button className="btn primary" onClick={add} disabled={busy || !adding.length}><Icon name="plus" />{t('Add')} {adding.length > 0 && `(${adding.length})`}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {editing && data && <GroupFormModal group={data} onClose={() => setEditing(false)} onSaved={changed} />}
    </Modal>
  );
}

function MemberLine({
  m, canEdit, busy, onPatch, onRemove, lang,
}: { m: MemberRow; canEdit: boolean; busy: boolean; onPatch: (b: Partial<Pick<GroupMember, 'role' | 'start_date' | 'end_date' | 'leads'>>) => void; onRemove: () => void; lang: string }) {
  const { t } = useI18n();
  const [role, setRole] = useState(m.role ?? '');
  const commitRole = () => {
    if ((role.trim() || null) !== (m.role ?? null)) onPatch({ role: role.trim() || null });
  };
  return (
    <tr className={m.current ? '' : 'past'}>
      <td>
        <PersonName p={m} />
        {!m.current && <span className="badge" style={{ marginLeft: 6 }}>{t('Past')}</span>}
      </td>
      <td>{canEdit ? <RoleInput className="role" value={role} onChange={setRole} onBlur={commitRole} /> : <RoleLabel role={m.role} />}</td>
      <td className="center">
        {canEdit
          ? <input type="checkbox" checked={!!m.leads} onChange={(e) => onPatch({ leads: e.target.checked })} disabled={busy} aria-label={t('Leads')} />
          : m.leads ? <Icon name="check" width={14} height={14} /> : null}
      </td>
      <td className="nowrap">
        {canEdit ? <input type="date" value={m.start_date ?? ''} onChange={(e) => onPatch({ start_date: e.target.value || null })} disabled={busy} /> : fmtDate(m.start_date, lang)}
      </td>
      <td className="nowrap">
        {canEdit ? <input type="date" value={m.end_date ?? ''} onChange={(e) => onPatch({ end_date: e.target.value || null })} disabled={busy} /> : fmtDate(m.end_date, lang)}
      </td>
      {canEdit && <td className="right"><button className="btn ghost sm icon" onClick={onRemove} disabled={busy} aria-label={t('Remove')} title={t('Remove')}><Icon name="trash" /></button></td>}
    </tr>
  );
}
