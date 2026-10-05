// Member register: people, households and upcoming birthdays.
import { optionValue, type MemberField } from '../../shared/member-fields.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, qs, useApi } from '../api.ts';
import { useContentLangs, useI18n } from '../i18n.tsx';
import { langInfo } from '../../shared/languages.ts';
import { personDisplay } from '../../shared/people-names.ts';
import {
  Bi, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, addDays, confirmAction, fmtDate, today, useAction,
  useDebounced, useSession,
} from '../components/ui.tsx';
import { Combo } from '../components/Combo.tsx';
import { Icon } from '../components/icons.tsx';
import { HistoryButton } from '../components/LogTools.tsx';
import { CongregationBadge, CongregationField, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import type {
  Coworker, Household, L10n, MemberStatus, Person, PersonRow, TeamWithRoles, Unavailability,
} from '../types-client.ts';
import {
  PersonName, STATUSES, STATUS_LABEL, StatusBadge, ageOn, fullName, nullify,
} from './people-common.tsx';
import {
  GroupTag, KINDS, KIND_LABEL, KIND_PLURAL, RoleInput, RoleLabel, type GroupRow, type PersonGroups,
} from './groups-common.tsx';

type Tab = 'people' | 'households' | 'birthdays';
type HouseholdWithMembers = Household & { members: Person[] };
type PersonDetail = Person & {
  coworker: Coworker[];
  roles: number[];
  schedule: { service_id: number; date: string; start_time: string; title: L10n; role_name: L10n; status: string }[];
  unavailability: Unavailability[];
};

const HH_ROLES = ['head', 'spouse', 'child', 'other'] as const;
type HhRole = (typeof HH_ROLES)[number];
const HH_ROLE_LABEL: Record<HhRole, string> = { head: 'Head', spouse: 'Spouse', child: 'Child', other: 'Other' };
const CAT_LABEL: Record<string, string> = {
  pastor: 'Pastor', elder: 'Elder', deacon: 'Deacon', ministry_staff: 'Ministry staff', admin_staff: 'Admin staff', lay_leader: 'Lay leader',
};
const ASSIGN_LABEL: Record<string, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', declined: 'Declined' };

export default function Members() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('people');
  const allPeople = useApi<{ total: number; rows: PersonRow[] }>('/people?limit=5000');
  const households = useApi<HouseholdWithMembers[]>('/households');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [version, setVersion] = useState(0);

  const refreshAll = () => {
    allPeople.reload();
    households.reload();
    setVersion((v) => v + 1);
  };

  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Congregation')} title={t('Member register')} sub={allPeople.data ? `${allPeople.data.total} ${t('people')}` : undefined}>
        <MembersActions onAdd={() => setEditing('new')} onImported={refreshAll} />
      </PageHead>
      <div className="tabs" role="tablist">
        {(['people', 'households', 'birthdays'] as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k === 'people' ? 'People' : k === 'households' ? 'Households' : 'Birthdays')}
          </button>
        ))}
      </div>
      {tab === 'people' && <PeopleTab version={version} onOpen={setEditing} />}
      {tab === 'households' && (
        <HouseholdsTab
          households={households.data} error={households.error} people={allPeople.data?.rows ?? []}
          onChanged={refreshAll} onOpen={setEditing}
        />
      )}
      {tab === 'birthdays' && <BirthdaysTab people={allPeople.data?.rows} onOpen={setEditing} />}
      {editing !== null && (
        <PersonEditor
          id={editing === 'new' ? null : editing}
          households={households.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={refreshAll}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- header actions: add, export, import

function MembersActions({ onAdd, onImported }: { onAdd: () => void; onImported: () => void }) {
  const { t } = useI18n();
  const { canEdit } = useSession();
  return (
    <>
      <CsvTools entity="members" label={t('Member register')} onImported={onImported} />
      {canEdit && <button className="btn primary" onClick={onAdd}><Icon name="plus" />{t('Add person')}</button>}
    </>
  );
}

// ---------------------------------------------------------------- people list

function PeopleTab({ version, onOpen }: { version: number; onOpen: (id: number) => void }) {
  const { t, lang, lt } = useI18n();
  // read-only accounts are not sent contact details: leave the columns out
  const { canEdit } = useSession();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const [status, setStatus] = useState<MemberStatus | 'all'>('all');
  const [cong, setCong, congs] = useCongregationFilter('members');
  const { data, error, loading, reload } = useApi<{ total: number; rows: PersonRow[] }>(`/people${qs({ q: dq, limit: 5000, congregation: cong })}`);
  // filter by one of the church's own yes / no or choice fields: "key=value"
  const { settings: st } = useSession();
  const filterable = (st?.member_fields ?? []).filter((d) => (d.type === 'yesno' || d.type === 'choice') && (canEdit || !d.sensitive));
  const [fieldFilter, setFieldFilter] = useState('');
  useEffect(() => {
    if (version) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const p of data?.rows ?? []) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [data]);
  const rows = useMemo(() => {
    const [fk, ...fv] = fieldFilter.split('=');
    const want = fv.join('=');
    return (data?.rows ?? []).filter((p) => (status === 'all' || p.status === status) && (!fieldFilter || (p.custom?.[fk] ?? '') === want));
  }, [data, status, fieldFilter]);
  const yr = (d: string | null) => (d ? d.slice(0, 4) : '');

  return (
    <div className="stack">
      <div className="row people-filters">
        <div className="grow" style={{ minWidth: 220, maxWidth: 380 }}>
          <SearchBox value={q} onChange={setQ} placeholder={t('Name, 中文名, email or phone…')} />
        </div>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        {filterable.length > 0 && (
          <select className="mini" value={fieldFilter} onChange={(e) => setFieldFilter(e.target.value)} aria-label={t('Member fields')} style={{ height: 32 }}>
            <option value="">{t('All members')}</option>
            {filterable.map((d) => (
              <optgroup key={d.key} label={lt(d.label)}>
                {(d.type === 'yesno' ? [['yes', t('Yes')], ['no', t('No')]] : (d.options ?? []).map((o) => [optionValue(o, st?.languages?.[0]), lt(o)])).map(([v, l]) => (
                  <option key={v} value={`${d.key}=${v}`}>{lt(d.label)}: {l}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        <div className="fchips" role="group" aria-label={t('Status')}>
          <button className={`fchip${status === 'all' ? ' on' : ''}`} onClick={() => setStatus('all')}>
            {t('All')} <span className="n">{data?.rows.length ?? 0}</span>
          </button>
          {STATUSES.map((s) => (
            <button key={s} className={`fchip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)} disabled={!counts[s] && status !== s}>
              {t(STATUS_LABEL[s])} <span className="n">{counts[s] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : rows.length === 0 ? (
        <div className="card"><Empty title={dq || status !== 'all' ? t('No matches.') : t('No people yet')}>{!dq && status === 'all' && <p>{t('Add people one by one or import a CSV file.')}</p>}</Empty></div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>{t('Name')}</th>
                <th>{t('Status')}</th>
                <th>{t('Household')}</th>
                {canEdit && <th>{t('Phone')}</th>}
                {canEdit && <th>{t('Email')}</th>}
                <th>{t('Baptism / membership')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="click" onClick={() => onOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}>
                  <td className="nowrap"><PersonName p={p} /> <CongregationBadge id={p.congregation_id} list={congs} /></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="muted">{p.household_name ?? ''}</td>
                  {canEdit && <td className="nowrap">{p.phone ?? ''}</td>}
                  {canEdit && <td>{p.email ?? ''}</td>}
                  <td className="small muted nowrap">
                    {p.baptism_date && <span title={fmtDate(p.baptism_date, lang)}>{t('Bapt.')} {yr(p.baptism_date)}</span>}
                    {p.baptism_date && p.membership_date && ' · '}
                    {p.membership_date && <span title={fmtDate(p.membership_date, lang)}>{t('Mem.')} {yr(p.membership_date)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- person editor

type Draft = {
  first_name: string; last_name: string; native_name: string; preferred_name: string; gender: string; birth_date: string;
  phone: string; email: string; address: string; household_id: string; household_role: string; status: MemberStatus;
  membership_date: string; baptism_date: string; baptism_type: string; profession_date: string; preferred_lang: string; notes: string;
  congregation_id: string;
};
const EMPTY: Draft = {
  first_name: '', last_name: '', native_name: '', preferred_name: '', gender: '', birth_date: '', phone: '', email: '', address: '',
  household_id: '', household_role: '', status: 'member', membership_date: '', baptism_date: '', baptism_type: '', profession_date: '',
  preferred_lang: '', notes: '', congregation_id: '',
};
const toDraft = (p: Person): Draft => {
  const d = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Draft)[]) {
    const v = p[k as keyof Person];
    (d as Record<string, unknown>)[k] = v === null || v === undefined ? '' : String(v);
  }
  return d;
};

function PersonEditor({ id, households, onClose, onSaved }: { id: number | null; households: HouseholdWithMembers[]; onClose: () => void; onSaved: () => void }) {
  const { t, lang, lt } = useI18n();
  const { canEdit, isAdmin, settings } = useSession();
  // the church's own fields; read-only accounts are not sent the sensitive ones, so leave those out
  const fieldDefs = (settings?.member_fields ?? []).filter((d) => canEdit || !d.sensitive);
  const detail = useApi<PersonDetail>(id ? `/people/${id}` : null);
  const teams = useApi<TeamWithRoles[]>('/teams');
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [honorific, setHonorific] = useState<L10n>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<number[]>([]);
  const [rolesDirty, setRolesDirty] = useState(false);
  const { run, busy } = useAction();

  // Initialise the form once; later reloads (e.g. after adding an away date) must not discard unsaved edits.
  const initialised = useRef(false);
  useEffect(() => {
    if (detail.data && !initialised.current) {
      initialised.current = true;
      setDraft(toDraft(detail.data));
      setHonorific(detail.data.honorific ?? {});
      setCustom(detail.data.custom ?? {});
      setRoles(detail.data.roles);
      setRolesDirty(false);
    }
  }, [detail.data]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const inp = (k: keyof Draft, type = 'text', extra: Record<string, unknown> = {}) => (
    <input type={type} value={draft[k]} onChange={(e) => set(k, e.target.value as never)} {...extra} />
  );

  const save = async () => {
    if (!draft.first_name.trim()) return run(async () => { throw new Error(t('First name is required.')); });
    const body = nullify({ ...draft }) as Record<string, unknown>;
    body.household_id = draft.household_id ? Number(draft.household_id) : null;
    if (!body.household_id) body.household_role = null;
    body.last_name = draft.last_name.trim();
    body.status = draft.status;
    body.congregation_id = draft.congregation_id ? Number(draft.congregation_id) : null;
    const h = Object.fromEntries(Object.entries(honorific).map(([k, v]) => [k, v?.trim()]).filter(([, v]) => v));
    body.honorific = Object.keys(h).length ? h : null;
    // the church's own fields: every defined one is sent ("" clears it)
    if (fieldDefs.length) body.custom = Object.fromEntries(fieldDefs.map((d) => [d.key, custom[d.key] ?? '']));
    const ok = await run(async () => {
      const p = id ? await api.patch<Person>(`/people/${id}`, body, detail.data?.updated_at) : await api.post<Person>('/people', body);
      if (rolesDirty || (!id && roles.length)) await api.put(`/people/${p.id}/roles`, { role_ids: roles });
      return p;
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const remove = async () => {
    if (!id || !confirmAction(t('Delete this person? Their serving history and qualifications will also be removed.'))) return;
    const ok = await run(() => api.del(`/people/${id}`), t('Deleted.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const title = id ? (detail.data ? fullName(detail.data) : t('Person')) : t('Add person');
  const pdpa = <span className="pdpa left">Personal data is used only for church administration (PDPA). / 个人资料仅用于教会行政用途。</span>;

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {pdpa}
          {isAdmin && id && <HistoryButton entity="people" id={id} />}
          {canEdit && id && <button className="btn danger" onClick={remove} disabled={busy}><Icon name="trash" />{t('Delete')}</button>}
          <button className="btn" onClick={onClose}>{canEdit ? t('Cancel') : t('Close')}</button>
          {canEdit && <button className="btn primary" onClick={save} disabled={busy || (!!id && !detail.data)}>{t('Save')}</button>}
        </>
      }
    >
      {id && detail.error && <ErrorBox error={detail.error} />}
      {id && !detail.data ? <Loading /> : (
        <div className="stack person-form">
          <fieldset disabled={!canEdit} className="bare stack">
            <section>
              <h3 className="sect">{t('Identity')}</h3>
              <div className="form-grid">
                <Field label={`${t('First name')} *`}>{inp('first_name', 'text', { autoFocus: !id, required: true })}</Field>
                <Field label={t('Last name')}>{inp('last_name')}</Field>
                <Field label={t('Chinese name')}>{inp('native_name', 'text', { lang: 'zh-Hans', placeholder: '陈伟明' })}</Field>
                <Field label={t('Preferred name')} hint={t('e.g. an English name used at church')}>{inp('preferred_name')}</Field>
                <HonorificField value={honorific} onChange={setHonorific} person={draft} />
                <Field label={t('Gender')}>
                  <select value={draft.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">—</option>
                    <option value="M">{t('Male')}</option>
                    <option value="F">{t('Female')}</option>
                  </select>
                </Field>
                <Field label={t('Birth date')}>{inp('birth_date', 'date')}</Field>
                <Field label={t('Preferred language')}>
                  <select value={draft.preferred_lang} onChange={(e) => set('preferred_lang', e.target.value)}>
                    <option value="">—</option>
                    <option value="en">{t('English')}</option>
                    <option value="zh">{t('Chinese')}</option>
                  </select>
                </Field>
              </div>
            </section>
            <section>
              <h3 className="sect">{t('Contact')}</h3>
              <div className="form-grid">
                <Field label={t('Phone')}>{inp('phone', 'tel', { placeholder: '+60 12-345 6789' })}</Field>
                <Field label={t('Email')}>{inp('email', 'email')}</Field>
                <Field label={t('Address')} className="span-all">
                  <textarea rows={2} value={draft.address} onChange={(e) => set('address', e.target.value)} style={{ minHeight: 56 }} />
                </Field>
              </div>
            </section>
            <section>
              <h3 className="sect">{t('Church')}</h3>
              <div className="form-grid">
                <CongregationField value={draft.congregation_id ? Number(draft.congregation_id) : null} onChange={(v) => set('congregation_id', v ? String(v) : '')} wholeChurchLabel="—" />
                <Field label={t('Status')}>
                  <select value={draft.status} onChange={(e) => set('status', e.target.value as MemberStatus)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
                  </select>
                </Field>
                <Field label={t('Membership date')}>{inp('membership_date', 'date')}</Field>
                <Field label={t('Baptism date')}>{inp('baptism_date', 'date')}</Field>
                <Field label={t('Baptism type')}>
                  <select value={draft.baptism_type} onChange={(e) => set('baptism_type', e.target.value)}>
                    <option value="">—</option>
                    <option value="infant">{t('Infant')}</option>
                    <option value="adult">{t('Adult')}</option>
                  </select>
                </Field>
                <Field label={t('Profession of faith')}>{inp('profession_date', 'date')}</Field>
                <Field label={t('Household')}>
                  <Combo value={draft.household_id} noneLabel="—" ariaLabel={t('Household')}
                    options={households.map((h) => ({ value: String(h.id), label: h.name, search: h.members.map((m) => [m.first_name, m.last_name, m.native_name].filter(Boolean).join(' ')).join(' ') }))}
                    onChange={(v) => set('household_id', v)} />
                </Field>
                {draft.household_id && (
                  <Field label={t('Household role')}>
                    <select value={draft.household_role} onChange={(e) => set('household_role', e.target.value)}>
                      <option value="">—</option>
                      {HH_ROLES.map((r) => <option key={r} value={r}>{t(HH_ROLE_LABEL[r])}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            </section>
            {fieldDefs.length > 0 && (
              <section>
                <h3 className="sect">{t('More details')}</h3>
                <div className="form-grid">
                  {fieldDefs.map((d) => (
                    <CustomFieldInput key={d.key} def={d} value={custom[d.key] ?? ''} onChange={(v) => setCustom((c) => ({ ...c, [d.key]: v }))} />
                  ))}
                </div>
              </section>
            )}
            {canEdit && (
              <section>
                <h3 className="sect">{t('Notes')}</h3>
                <textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
              </section>
            )}
          </fieldset>

          <div className="grid cols-2">
            <section className="card sub-card">
              <h3 className="sect">{t('Qualified for')}</h3>
              {teams.data ? (
                <div className="stack tight">
                  {teams.data.map((tm) => (
                    <div key={tm.id}>
                      <div className="small muted row" style={{ gap: 6 }}><span className="dot" style={{ background: tm.color }} /><Bi v={tm.name} /></div>
                      <div className="row" style={{ gap: '2px 14px', margin: '2px 0 6px 14px' }}>
                        {tm.roles.map((r) => (
                          <label key={r.id} className="check small">
                            <input
                              type="checkbox" disabled={!canEdit} checked={roles.includes(r.id)}
                              onChange={(e) => {
                                setRoles((rs) => (e.target.checked ? [...rs, r.id] : rs.filter((x) => x !== r.id)));
                                setRolesDirty(true);
                              }}
                            />
                            {lt(r.name)}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                  {!teams.data.length && <span className="muted small">{t('No teams yet')}</span>}
                </div>
              ) : <Loading />}
            </section>
            {id && detail.data && (
              <section className="card sub-card">
                <h3 className="sect">{t('Serving schedule')}</h3>
                {detail.data.schedule.length ? (
                  <ul className="plain small">
                    {detail.data.schedule.slice(0, 12).map((s, i) => (
                      <li key={i} className="row between">
                        <Link to={`/services/${s.service_id}`}>{fmtDate(s.date, lang, { day: 'numeric', month: 'short', weekday: 'short' })}</Link>
                        <span className="grow">{lt(s.role_name)}</span>
                        <span className={`badge ${s.status === 'confirmed' ? 'ok' : s.status === 'declined' ? 'danger' : 'lapis'}`}>{t(ASSIGN_LABEL[s.status] ?? s.status)}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted small">{t('Not scheduled to serve.')}</p>}
                {detail.data.coworker.length > 0 && (
                  <>
                    <h3 className="sect mt">{t('Co-worker positions')}</h3>
                    <ul className="plain small">
                      {detail.data.coworker.map((c) => (
                        <li key={c.id} className="row between">
                          <span><strong>{c.position}</strong> · {t(CAT_LABEL[c.category])}</span>
                          <span className="muted nowrap">{c.start_date?.slice(0, 4) ?? ''}–{c.end_date?.slice(0, 4) ?? ''}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )}
          </div>
          {id && detail.data && <GroupsTeamsEditor personId={id} onQualsRemoved={(ids) => setRoles((rs) => rs.filter((r) => !ids.includes(r)))} />}
          {id && detail.data && <AwayEditor personId={id} items={detail.data.unavailability} onChanged={detail.reload} />}
        </div>
      )}
    </Modal>
  );
}

/** The person's groups (committees, fellowships, cell groups…) and volunteer teams, with quick add / remove (saved immediately). */
function GroupsTeamsEditor({ personId, onQualsRemoved }: { personId: number; onQualsRemoved: (roleIds: number[]) => void }) {
  const { t, lt } = useI18n();
  const { canEdit } = useSession();
  const mine = useApi<PersonGroups>(`/people/${personId}/groups`);
  const groups = useApi<GroupRow[]>(canEdit ? '/groups' : null);
  const teams = useApi<TeamWithRoles[]>(canEdit ? '/teams' : null);
  const { run, busy } = useAction();
  const [gid, setGid] = useState('');
  const [role, setRole] = useState('');
  const [tid, setTid] = useState('');
  const mg = mine.data?.groups ?? [];
  const mt = mine.data?.teams ?? [];
  const freeGroups = (groups.data ?? []).filter((g) => !mg.some((x) => x.group_id === g.id));
  const freeTeams = (teams.data ?? []).filter((x) => !mt.some((m) => m.team_id === x.id));

  const addGroup = async () => {
    if (!gid) return;
    if (await run(() => api.post(`/groups/${gid}/members`, { person_id: personId, role: role.trim() || null }), t('Saved.'))) {
      setGid('');
      setRole('');
      mine.reload();
    }
  };
  const delGroup = async (memberId: number, name: string) => {
    if (!confirmAction(t('Remove from {name}?').replace('{name}', name))) return;
    if (await run(() => api.del(`/group-members/${memberId}`))) mine.reload();
  };
  const addTeam = async () => {
    if (!tid) return;
    if (await run(() => api.post(`/teams/${tid}/members`, { person_id: personId }), t('Saved.'))) {
      setTid('');
      mine.reload();
    }
  };
  const delTeam = async (teamId: number, name: string) => {
    if (!confirmAction(t('Remove from {name}?').replace('{name}', name))) return;
    try {
      await api.del(`/teams/${teamId}/members/${personId}`);
      mine.reload();
    } catch (e) {
      // still qualified for roles in that team: offer to drop those qualifications too
      if (e instanceof ApiError && e.status === 409 && confirmAction(t('This person is still qualified for roles in this team. Remove them from the team and drop those qualifications?'))) {
        const r = await run(() => api.del<{ removed_qualifications: number[] }>(`/teams/${teamId}/members/${personId}?cascade=1`));
        if (r) {
          onQualsRemoved(r.removed_qualifications);
          mine.reload();
        }
      } else if (!(e instanceof ApiError && e.status === 409)) {
        await run(async () => { throw e; });
      }
    }
  };

  return (
    <section className="card sub-card">
      <h3 className="sect">{t('Groups & teams')}</h3>
      {!mine.data ? <Loading /> : (
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Groups')}</div>
            {mg.length ? (
              <ul className="plain small pg-list">
                {mg.map((g) => (
                  <li key={g.id} className="row between" style={{ flexWrap: 'nowrap', opacity: g.current && g.active ? 1 : 0.6 }}>
                    <GroupTag name={g.name} color={g.color} />
                    <span className="grow muted">{t(KIND_LABEL[g.kind])}{!g.current && ` · ${t('Past')}`}</span>
                    <RoleLabel role={g.role} />
                    {canEdit && <button className="btn ghost sm icon" onClick={() => delGroup(g.id, lt(g.name))} disabled={busy} aria-label={t('Remove')}><Icon name="x" /></button>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>{t('Not in any group.')}</p>}
            {canEdit && freeGroups.length > 0 && (
              <div className="pg-add">
                <select value={gid} onChange={(e) => setGid(e.target.value)} aria-label={t('Group')}>
                  <option value="">{t('Add to group…')}</option>
                  {KINDS.map((k) => {
                    const gs = freeGroups.filter((g) => g.kind === k);
                    return gs.length ? (
                      <optgroup key={k} label={t(KIND_PLURAL[k])}>{gs.map((g) => <option key={g.id} value={g.id}>{lt(g.name)}</option>)}</optgroup>
                    ) : null;
                  })}
                </select>
                <RoleInput value={role} onChange={setRole} />
                <button className="btn" onClick={addGroup} disabled={busy || !gid}><Icon name="plus" />{t('Add')}</button>
              </div>
            )}
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>{t('Volunteer teams')}</div>
            {mt.length ? (
              <ul className="plain small pg-list">
                {mt.map((x) => (
                  <li key={x.team_id} className="row between" style={{ flexWrap: 'nowrap' }}>
                    <span className="row grow" style={{ gap: 6 }}><span className="dot" style={{ background: x.color }} /><Bi v={x.name} /></span>
                    {x.is_leader && <span className="badge reed">{t('Team leader')}</span>}
                    {canEdit && <button className="btn ghost sm icon" onClick={() => delTeam(x.team_id, lt(x.name))} disabled={busy} aria-label={t('Remove')}><Icon name="x" /></button>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted small" style={{ margin: 0 }}>{t('Not on any team.')}</p>}
            {canEdit && freeTeams.length > 0 && (
              <div className="pg-add" style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
                <select value={tid} onChange={(e) => setTid(e.target.value)} aria-label={t('Team')}>
                  <option value="">{t('Add to team…')}</option>
                  {freeTeams.map((x) => <option key={x.id} value={x.id}>{lt(x.name)}</option>)}
                </select>
                <button className="btn" onClick={addTeam} disabled={busy || !tid}><Icon name="plus" />{t('Add')}</button>
              </div>
            )}
          </div>
        </div>
      )}
      {canEdit && <p className="muted small" style={{ margin: '8px 0 0' }}>{t('Group and team changes are saved immediately.')}</p>}
    </section>
  );
}

function AwayEditor({ personId, items, onChanged }: { personId: number; items: Unavailability[]; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const { canEdit } = useSession();
  const { run, busy } = useAction();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');
  const upcoming = items.filter((u) => u.end_date >= today());

  const add = async () => {
    if (to < from) return run(async () => { throw new Error(t('The end date is before the start date.')); });
    const ok = await run(() => api.post('/unavailability', { person_id: personId, start_date: from, end_date: to, reason: reason.trim() || null }));
    if (ok) {
      setReason('');
      onChanged();
    }
  };
  const del = async (uid: number) => {
    const ok = await run(() => api.del(`/unavailability/${uid}`));
    if (ok) onChanged();
  };
  const range = (u: Unavailability) =>
    u.start_date === u.end_date ? fmtDate(u.start_date, lang) : `${fmtDate(u.start_date, lang, { day: 'numeric', month: 'short' })} – ${fmtDate(u.end_date, lang)}`;

  return (
    <section className="card sub-card">
      <h3 className="sect">{t('Away / unavailable')}</h3>
      {upcoming.length ? (
        <ul className="plain small">
          {upcoming.map((u) => (
            <li key={u.id} className="row between">
              <span className="nowrap">{range(u)}</span>
              <span className="grow muted">{u.reason ?? ''}</span>
              {canEdit && <button className="btn ghost sm icon" onClick={() => del(u.id)} aria-label={t('Delete')} disabled={busy}><Icon name="x" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="muted small">{t('No upcoming dates.')}</p>}
      {canEdit && (
        <div className="form-grid away-add mt">
          <Field label={t('From')}><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label={t('To')}><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label={t('Reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. overseas, exams')} /></Field>
          <div className="row" style={{ alignSelf: 'end' }}><button className="btn" onClick={add} disabled={busy}><Icon name="plus" />{t('Add')}</button></div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- households

function HouseholdsTab({
  households, error, people, onChanged, onOpen,
}: { households?: HouseholdWithMembers[]; error: string | null; people: PersonRow[]; onChanged: () => void; onOpen: (id: number) => void }) {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const { run, busy } = useAction();
  const [edit, setEdit] = useState<Household | 'new' | null>(null);
  const [q, setQ] = useState('');

  if (error) return <ErrorBox error={error} />;
  if (!households) return <Loading />;
  const s = q.trim().toLowerCase();
  const shown = s ? households.filter((h) => `${h.name} ${h.members.map(fullName).join(' ')}`.toLowerCase().includes(s)) : households;

  const setMember = async (personId: number, household_id: number | null, household_role: HhRole | null) => {
    const ok = await run(() => api.patch(`/people/${personId}`, { household_id, household_role }));
    if (ok) onChanged();
  };
  const remove = async (h: Household) => {
    if (!confirmAction(t('Delete this household? Its members stay in the register.'))) return;
    const ok = await run(() => api.del(`/households/${h.id}`), t('Deleted.'));
    if (ok) onChanged();
  };

  return (
    <div className="stack">
      <div className="row between">
        <div style={{ minWidth: 220, maxWidth: 380 }} className="grow"><SearchBox value={q} onChange={setQ} /></div>
        {canEdit && <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" />{t('New household')}</button>}
      </div>
      {!shown.length ? (
        <div className="card"><Empty title={s ? t('No matches.') : t('No households yet')}>{!s && <p>{t('Group family members together to see who lives with whom.')}</p>}</Empty></div>
      ) : (
        <div className="grid cols-3">
          {shown.map((h) => (
            <div key={h.id} className="card hh-card">
              <div className="card-head">
                <h3>{h.name}</h3>
                {canEdit && (
                  <div className="row" style={{ gap: 2 }}>
                    <button className="btn ghost sm icon" onClick={() => setEdit(h)} aria-label={t('Edit')} title={t('Edit')}><Icon name="edit" /></button>
                    <button className="btn ghost sm icon" onClick={() => remove(h)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>
                  </div>
                )}
              </div>
              {(h.address || h.phone) && <div className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>{[h.address, h.phone].filter(Boolean).join(' · ')}</div>}
              <ul className="plain">
                {sortMembers(h.members).map((m) => (
                  <li key={m.id} className="row between hh-member">
                    <button className="linkish grow" onClick={() => onOpen(m.id)}><PersonName p={m} /></button>
                    {canEdit ? (
                      <select className="mini" value={m.household_role ?? ''} onChange={(e) => setMember(m.id, h.id, (e.target.value || null) as HhRole | null)} aria-label={t('Household role')}>
                        <option value="">—</option>
                        {HH_ROLES.map((r) => <option key={r} value={r}>{t(HH_ROLE_LABEL[r])}</option>)}
                      </select>
                    ) : m.household_role && <span className="badge">{t(HH_ROLE_LABEL[m.household_role])}</span>}
                    {canEdit && <button className="btn ghost sm icon" onClick={() => setMember(m.id, null, null)} aria-label={t('Remove from household')} title={t('Remove from household')} disabled={busy}><Icon name="x" /></button>}
                  </li>
                ))}
                {!h.members.length && <li className="muted small">{t('No members yet')}</li>}
              </ul>
              {canEdit && (
                <select
                  className="cell-add mt" value="" aria-label={t('Add member')}
                  onChange={(e) => {
                    const pid = Number(e.target.value);
                    if (pid) setMember(pid, h.id, h.members.some((m) => m.household_role === 'head') ? 'other' : 'head');
                  }}
                >
                  <option value="">+ {t('Add member')}</option>
                  {people.filter((p) => p.household_id !== h.id).map((p) => (
                    <option key={p.id} value={p.id}>{fullName(p)}{p.household_name ? ` (${p.household_name})` : ''}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
      )}
      {edit && <HouseholdModal household={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={onChanged} />}
    </div>
  );
}

const ROLE_ORDER: Record<string, number> = { head: 0, spouse: 1, child: 2, other: 3 };
const sortMembers = (ms: Person[]) =>
  [...ms].sort((a, b) => (ROLE_ORDER[a.household_role ?? ''] ?? 4) - (ROLE_ORDER[b.household_role ?? ''] ?? 4) || (a.birth_date ?? '9').localeCompare(b.birth_date ?? '9'));

function HouseholdModal({ household, onClose, onSaved }: { household: Household | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [d, setD] = useState({ name: household?.name ?? '', address: household?.address ?? '', phone: household?.phone ?? '', notes: household?.notes ?? '' });
  const save = async () => {
    if (!d.name.trim()) return run(async () => { throw new Error(t('Name is required.')); });
    const body = nullify(d);
    const ok = await run(() => (household ? api.patch(`/households/${household.id}`, body) : api.post('/households', body)), t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal
      title={household ? household.name : t('New household')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}
    >
      <div className="form-grid">
        <Field label={`${t('Name')} *`} className="span-all"><input autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder={t('e.g. Tan family')} /></Field>
        <Field label={t('Address')} className="span-all"><input value={d.address} onChange={(e) => setD({ ...d, address: e.target.value })} /></Field>
        <Field label={t('Phone')}><input value={d.phone} onChange={(e) => setD({ ...d, phone: e.target.value })} /></Field>
        <Field label={t('Notes')} className="span-all"><textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- birthdays

function BirthdaysTab({ people, onOpen }: { people?: PersonRow[]; onOpen: (id: number) => void }) {
  const { t, lang } = useI18n();
  // read-only accounts get only the birthday (day and month): no age, no phone
  const { canEdit } = useSession();
  const list = useMemo(() => {
    if (!people) return [];
    const start = today();
    const end = addDays(start, 30);
    const y = Number(start.slice(0, 4));
    return people
      .filter((p) => (p.birth_date || p.birthday) && p.status !== 'deceased' && p.status !== 'transferred')
      .map((p) => {
        const md = p.birth_date ? p.birth_date.slice(5) : p.birthday!;
        let next = `${y}-${md}`;
        if (md === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) next = `${y}-03-01`;
        if (next < start) next = `${y + 1}-${md}`;
        const days = Math.round((new Date(next + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000);
        return { p, next, days, age: p.birth_date ? ageOn(p.birth_date, next) : null };
      })
      .filter((x) => x.next <= end)
      .sort((a, b) => a.days - b.days);
  }, [people]);

  if (!people) return <Loading />;
  if (!list.length) return <div className="card"><Empty title={t('No birthdays in the next 30 days.')} /></div>;
  return (
    <div className="card flush table-wrap">
      <table className="t">
        <thead>
          <tr><th>{t('Date')}</th><th>{t('Name')}</th>{canEdit && <th>{t('Turning')}</th>}<th>{t('Days away')}</th>{canEdit && <th>{t('Phone')}</th>}</tr>
        </thead>
        <tbody>
          {list.map(({ p, next, days, age }) => (
            <tr key={p.id} className="click" onClick={() => onOpen(p.id)}>
              <td className="nowrap"><Icon name="cake" className="ico-inline" /> {fmtDate(next, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
              <td className="nowrap"><PersonName p={p} /></td>
              {canEdit && <td>{age}</td>}
              <td className="nowrap">{days === 0 ? <span className="badge reed">{t('Today')}</span> : `${days} ${t(days === 1 ? 'day' : 'days')}`}</td>
              {canEdit && <td className="nowrap">{p.phone ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// ---------------------------------------------------------------- honorific title

/** Common church titles per language. Chinese titles follow the name (林明华弟兄); others precede it (Bro. Lim). */
const TITLE_PICKS: Record<string, string[]> = {
  zh: ['弟兄', '姐妹', '传道', '牧师', '长老', '执事'],
  'zh-Hant': ['弟兄', '姊妹', '傳道', '牧師', '長老', '執事'],
  en: ['Bro.', 'Sis.', 'Ps.', 'Rev.', 'Elder', 'Dn.'],
};

/** "Title" per church language, with quick picks and a preview of how the name prints in the bulletin. */
function HonorificField({ value, onChange, person }: { value: L10n; onChange: (v: L10n) => void; person: { first_name: string; last_name: string; preferred_name: string; native_name: string } }) {
  const { t } = useI18n();
  const langs = useContentLangs();
  const set = (l: string, v: string) => onChange({ ...value, [l]: v });
  return (
    <Field label={t('Honorific title')} hint={t('Printed with the name in bulletins, e.g. 陈以诺传道 / Ps. Chen')} className="span-all">
      <div className="stack tight">
        {langs.map((l) => {
          const picks = TITLE_PICKS[l] ?? [];
          const preview = person.first_name.trim() || person.native_name.trim()
            ? personDisplay({ ...person, honorific: value }, l)
            : '';
          return (
            <div key={l} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="small muted" style={{ minWidth: 64 }} lang={langInfo(l).htmlLang}>{langInfo(l).native}</span>
              <input value={value[l] ?? ''} onChange={(e) => set(l, e.target.value)} style={{ width: 110 }} lang={langInfo(l).htmlLang} />
              {picks.map((p) => (
                <button key={p} type="button" className={`btn sm${value[l] === p ? ' primary' : ' ghost'}`} onClick={() => set(l, value[l] === p ? '' : p)}>{p}</button>
              ))}
              {preview && <span className="small muted" lang={langInfo(l).htmlLang}>→ {preview}</span>}
            </div>
          );
        })}
      </div>
    </Field>
  );
}

/** One of the church's own fields (Settings → Member fields) on a member's page. */
function CustomFieldInput({ def, value, onChange }: { def: MemberField; value: string; onChange: (v: string) => void }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const label = <>{lt(def.label)}{def.sensitive && <span className="badge" style={{ marginLeft: 6 }} title={t('Hidden from read-only accounts and AI assistants.')}>{t('Sensitive')}</span>}</>;
  if (def.type === 'date') return <Field label={label}><input type="date" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
  if (def.type === 'yesno') {
    return (
      <Field label={label}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option>
        </select>
      </Field>
    );
  }
  if (def.type === 'choice') {
    const opts = (def.options ?? []).map((o) => ({ value: optionValue(o, settings?.languages?.[0]), label: lt(o) }));
    return (
      <Field label={label}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {value && !opts.some((o) => o.value === value) && <option value={value}>{value}</option>}
        </select>
      </Field>
    );
  }
  return <Field label={label}><input value={value} maxLength={500} onChange={(e) => onChange(e.target.value)} /></Field>;
}
