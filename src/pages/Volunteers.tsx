// Volunteer planner: rota grid (services × roles), teams & roles, unavailability.
import { Fragment, useMemo, useState } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import {
  Bi, Empty, ErrorBox, Field, L10nInput, Loading, Modal, PageHead, addDays, confirmAction, fmtDate, today, useAction, useSession, useToast,
} from '../components/ui.tsx';
import { CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { Combo } from '../components/Combo.tsx';
import { Icon } from '../components/icons.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import type {
  AssignmentStatus, L10n, PersonRow, RoleWithMembers, Rota, Team, TeamWithRoles, Unavailability,
} from '../types-client.ts';
import { PeopleMultiSelect, fullName, isActive } from './people-common.tsx';
import { type TeamFull, type TeamMemberRef } from './groups-common.tsx';

type Tab = 'rota' | 'teams' | 'away';
const NEXT: Record<AssignmentStatus, AssignmentStatus> = { scheduled: 'confirmed', confirmed: 'declined', declined: 'scheduled' };
const ST_LABEL: Record<string, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', declined: 'Declined' };

export default function Volunteers() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>('rota');
  const people = useApi<{ total: number; rows: PersonRow[] }>('/people?limit=5000');
  return (
    <div className="page wide people-page vol-page">
      <PageHead eyebrow={t('Congregation')} title={t('Volunteer rota')} />
      <div className="tabs no-print" role="tablist">
        {([['rota', 'Rota'], ['teams', 'Teams & roles'], ['away', 'Unavailability']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
        ))}
      </div>
      {tab === 'rota' && <RotaTab people={people.data?.rows ?? []} />}
      {tab === 'teams' && <TeamsTab people={people.data?.rows ?? []} />}
      {tab === 'away' && <AwayTab people={people.data?.rows ?? []} />}
    </div>
  );
}

// ---------------------------------------------------------------- rota grid

type Cell = Rota['assignments'][number];

function RotaTab({ people }: { people: PersonRow[] }) {
  const { t, lt, lang } = useI18n();
  const { canEdit } = useSession();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(addDays(today(), 56));
  const [cong, setCong, congs] = useCongregationFilter('rota');
  const { data, error, loading, reload, setData } = useApi<Rota>(`/rota${qs({ from, to, congregation: cong })}`);
  const { run, busy } = useAction();

  const away = (personId: number, date: string) =>
    !!data?.unavailability.some((u) => u.person_id === personId && u.start_date <= date && u.end_date >= date);
  const byCell = useMemo(() => {
    const m = new Map<string, Cell[]>();
    for (const a of data?.assignments ?? []) {
      const k = `${a.service_id}:${a.role_id}`;
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return m;
  }, [data]);
  const roleName = useMemo(() => {
    const m = new Map<number, L10n>();
    for (const tm of data?.teams ?? []) for (const r of tm.roles) m.set(r.id, r.name);
    return m;
  }, [data]);
  const active = useMemo(() => people.filter(isActive), [people]);

  const setWeeks = (n: number) => setTo(addDays(from, n * 7));
  const patchCells = (fn: (a: Cell[]) => Cell[]) => setData((d) => (d ? { ...d, assignments: fn(d.assignments) } : d));

  const add = async (serviceId: number, roleId: number, personId: number) => {
    const a = await run(() => api.post<{ id: number; status: string }>(`/services/${serviceId}/assignments`, { role_id: roleId, person_id: personId }));
    if (!a) return;
    const p = people.find((x) => x.id === personId);
    patchCells((cs) => [...cs.filter((c) => c.id !== a.id), { id: a.id, service_id: serviceId, role_id: roleId, person_id: personId, status: a.status, person_name: p ? fullName(p) : '' }]);
  };
  const cycle = async (c: Cell) => {
    const status = NEXT[c.status as AssignmentStatus] ?? 'scheduled';
    const ok = await run(() => api.patch(`/assignments/${c.id}`, { status }));
    if (ok) patchCells((cs) => cs.map((x) => (x.id === c.id ? { ...x, status } : x)));
  };
  const remove = async (c: Cell) => {
    const ok = await run(() => api.del(`/assignments/${c.id}`));
    if (ok) patchCells((cs) => cs.filter((x) => x.id !== c.id));
  };
  const autofill = async () => {
    if (!data?.services.length || !confirmAction(t('Fill empty slots fairly across these services?'))) return;
    const r = await run(() => api.post<unknown[]>('/rota/autofill', { service_ids: data.services.map((s) => s.id) }));
    if (r) {
      toastFilled(r.length);
      reload();
    }
  };
  const toast = useToast();
  const toastFilled = (n: number) => toast(n ? t(n === 1 ? 'Filled 1 empty slot.' : 'Filled {n} empty slots.').replace('{n}', String(n)) : t('Nothing to fill — every slot with a qualified, available person is taken.'));

  // fairness: assignments per person in range (declined excluded), including qualified people with none
  const load = useMemo(() => {
    if (!data) return [];
    const m = new Map<number, { name: string; n: number }>();
    for (const tm of data.teams) for (const r of tm.roles) for (const p of r.members) if (!m.has(p.person_id)) m.set(p.person_id, { name: p.name, n: 0 });
    for (const a of data.assignments) {
      if (a.status === 'declined') continue;
      const e = m.get(a.person_id) ?? { name: a.person_name, n: 0 };
      e.n++;
      m.set(a.person_id, e);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [data]);
  const maxLoad = Math.max(1, ...load.map((l) => l.n));

  return (
    <div className="stack">
      <div className="row between rota-toolbar no-print">
        <div className="row">
          <Field label={t('From')}><input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
          <Field label={t('To')}><input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
          <div style={{ alignSelf: 'flex-end' }}><CongregationFilter value={cong} onChange={setCong} list={congs} /></div>
          <div className="seg" role="group" style={{ alignSelf: 'flex-end' }}>
            {[4, 8, 12].map((n) => (
              <button key={n} type="button" className={to === addDays(from, n * 7) ? 'on' : ''} onClick={() => setWeeks(n)}>{n} {t('Weeks')}</button>
            ))}
          </div>
        </div>
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          {canEdit && (
            <button className="btn" onClick={autofill} disabled={busy || !data?.services.length}><Icon name="wand" />{t('Auto-fill')}</button>
          )}
          <button className="btn" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
        </div>
      </div>
      <div className="legend no-print">
        <span className="chip">{t('Scheduled')}</span>
        <span className="chip confirmed">{t('Confirmed')}</span>
        <span className="chip declined">{t('Declined')}</span>
        <span className="chip away">{t('Away')}</span>
        {canEdit && <span>{t('Click a name to change its status.')}</span>}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data ? null : !data.services.length ? (
        <div className="card"><Empty title={t('No services in this period')}><p><Link to="/services">{t('Plan services')}</Link></p></Empty></div>
      ) : !data.teams.length ? (
        <div className="card"><Empty title={t('No teams yet')} /></div>
      ) : (
        <div className="rota-wrap">
          <table className="rota">
            <thead>
              <tr>
                <th className="role">{t('Role')}</th>
                {data.services.map((s) => (
                  <th key={s.id}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <Link to={`/services/${s.id}`} className="svc-date">{fmtDate(s.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}</Link>
                      <span className={`badge ${s.status === 'final' ? 'ok' : ''}`}>{t(s.status === 'final' ? 'Final' : 'Draft')}</span>
                    </div>
                    <span className="svc-title"><Bi v={s.title} /> · {s.start_time}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.teams as TeamFull[]).filter((tm) => tm.roles.length).map((tm) => (
                <Fragment key={tm.id}>
                  <tr className="team">
                    <td className="role">
                      <span className="dot" style={{ background: tm.color }} />{lt(tm.name)}
                      <span className="cnt" title={t('Team members')}><Icon name="users" width={11} height={11} style={{ verticalAlign: -1, marginRight: 2 }} />{tm.members?.length ?? 0}</span>
                    </td>
                    <td colSpan={data.services.length} />
                  </tr>
                  {tm.roles.map((r) => (
                    <tr key={r.id}>
                      <td className="role">
                        <Bi v={r.name} />
                        <div className="need">{r.needed ? `${t('Needed')}: ${r.needed}` : t('Optional')}</div>
                      </td>
                      {data.services.map((s) => {
                        const cs = byCell.get(`${s.id}:${r.id}`) ?? [];
                        const filled = cs.filter((c) => c.status !== 'declined').length;
                        return (
                          <td key={s.id} className={filled < r.needed ? 'under' : ''} title={filled < r.needed ? `${filled}/${r.needed}` : undefined}>
                            {cs.length > 0 && (
                              <div className="chips">
                                {cs.map((c) => (
                                  <span key={c.id} className={`chip ${c.status}${away(c.person_id, s.date) ? ' away' : ''}`} title={`${t(ST_LABEL[c.status] ?? c.status)}${away(c.person_id, s.date) ? ' · ' + t('Away') : ''}`}>
                                    {canEdit ? (
                                      <span className="who" role="button" tabIndex={0} onClick={() => cycle(c)} onKeyDown={(e) => e.key === 'Enter' && cycle(c)}>{c.person_name}</span>
                                    ) : <span>{c.person_name}</span>}
                                    {canEdit && <button onClick={() => remove(c)} aria-label={`${t('Remove')} ${c.person_name}`} title={t('Remove')}>×</button>}
                                  </span>
                                ))}
                              </div>
                            )}
                            {canEdit && (
                              <AddSelect
                                role={r} date={s.date} people={active} taken={cs.map((c) => c.person_id)}
                                servingAs={(pid) => {
                                  const other = data.assignments.find((a) => a.service_id === s.id && a.person_id === pid && a.role_id !== r.id && a.status !== 'declined');
                                  return other ? lt(roleName.get(other.role_id)) : null;
                                }}
                                away={(pid) => away(pid, s.date)}
                                onPick={(pid) => add(s.id, r.id, pid)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.services.length > 0 && load.length > 0 && (
        <div className="card no-print">
          <div className="card-head">
            <h3>{t('Serving load in this period')}</h3>
            <span className="muted small">{t('Assignments per person, declined excluded')}</span>
          </div>
          <div className="load-list">
            {load.map((l) => (
              <div key={l.id} className="load-row">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.name}>{l.name}</span>
                <span className="bar"><span style={{ width: `${(l.n / maxLoad) * 100}%` }} /></span>
                <span className="n">{l.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AddSelect({
  role, people, taken, away, servingAs, onPick,
}: {
  role: RoleWithMembers; date: string; people: PersonRow[]; taken: number[];
  away: (pid: number) => boolean; servingAs: (pid: number) => string | null; onPick: (pid: number) => void;
}) {
  const { t } = useI18n();
  const qualified = new Set(role.members.map((m) => m.person_id));
  const label = (pid: number, name: string) => {
    const bits = [name];
    if (away(pid)) bits.push(`— ${t('away')}`);
    const as = servingAs(pid);
    if (as) bits.push(`— ${t('serving as')} ${as}`);
    return bits.join(' ');
  };
  const others = people.filter((p) => !qualified.has(p.id) && !taken.includes(p.id));
  return (
    <select className="cell-add" value="" onChange={(e) => e.target.value && onPick(Number(e.target.value))} aria-label={t('Add')}>
      <option value="">+ {t('Add')}</option>
      {role.members.filter((m) => !taken.includes(m.person_id)).map((m) => (
        <option key={m.person_id} value={m.person_id}>{label(m.person_id, m.name)}</option>
      ))}
      {others.length > 0 && (
        <optgroup label={t('Everyone else')}>
          {others.map((p) => <option key={p.id} value={p.id}>{label(p.id, fullName(p))}</option>)}
        </optgroup>
      )}
    </select>
  );
}

// ---------------------------------------------------------------- teams & roles

function TeamsTab({ people }: { people: PersonRow[] }) {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const { data, error, loading, reload } = useApi<TeamFull[]>('/teams');
  const { run, busy } = useAction();
  const [team, setTeam] = useState<Team | 'new' | null>(null);
  const [role, setRole] = useState<{ team: TeamFull; role: RoleWithMembers | null } | null>(null);
  const [roster, setRoster] = useState<number | null>(null);

  const delTeam = async (tm: TeamWithRoles) => {
    if (!confirmAction(t('Delete this team, its roles and all their rota assignments?'))) return;
    if (await run(() => api.del(`/teams/${tm.id}`), t('Deleted.'))) reload();
  };
  const delRole = async (r: RoleWithMembers) => {
    if (!confirmAction(t('Delete this role and all its rota assignments?'))) return;
    if (await run(() => api.del(`/roles/${r.id}`), t('Deleted.'))) reload();
  };

  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="stack">
      <div className="row end">
        <CsvTools entity="team_members" label={t('Team members')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setTeam('new')}><Icon name="plus" />{t('Add team')}</button>}
      </div>
      {!data?.length && <div className="card"><Empty title={t('No teams yet')} /></div>}
      {data?.map((tm) => (
        <div key={tm.id} className="card flush">
          <div className="card-head" style={{ padding: '14px 16px 0' }}>
            <h3><span className="dot" style={{ background: tm.color, width: 10, height: 10 }} /><Bi v={tm.name} /></h3>
            {canEdit && (
              <div className="row" style={{ gap: 4 }}>
                <button className="btn sm" onClick={() => setRole({ team: tm, role: null })}><Icon name="plus" />{t('Add role')}</button>
                <button className="btn ghost sm icon" onClick={() => setTeam(tm)} aria-label={t('Edit')} title={t('Edit')}><Icon name="edit" /></button>
                <button className="btn ghost sm icon" onClick={() => delTeam(tm)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>
              </div>
            )}
          </div>
          {tm.description && <p className="muted small" style={{ padding: '0 16px' }}>{tm.description}</p>}
          <div className="roster">
            <span className="lbl">{t('Team members')} · {tm.members.length}</span>
            {tm.members.map((m) => (
              <span key={m.person_id} className={`rchip${m.is_leader ? ' lead' : ''}`} title={m.is_leader ? t('Team leader') : undefined}>
                {m.is_leader && <Icon name="check" />}{m.name}
              </span>
            ))}
            {!tm.members.length && <span className="muted small">{t('Nobody yet')}</span>}
            {canEdit && <button className="btn ghost sm" onClick={() => setRoster(tm.id)}><Icon name="users" />{t('Manage members')}</button>}
          </div>
          <div className="table-wrap">
            <table className="t teams-table">
              <thead><tr><th>{t('Role')}</th><th>{t('Needed per service')}</th><th>{t('Qualified people')}</th>{canEdit && <th />}</tr></thead>
              <tbody>
                {tm.roles.map((r) => (
                  <tr key={r.id} className={canEdit ? 'click' : ''} onClick={() => canEdit && setRole({ team: tm, role: r })}>
                    <td className="nowrap"><Bi v={r.name} /></td>
                    <td>{r.needed || <span className="muted">{t('Optional')}</span>}</td>
                    <td className="small">
                      {r.members.length ? r.members.map((m) => m.name).join(', ') : <span className="muted">{t('Nobody yet')}</span>}
                    </td>
                    {canEdit && (
                      <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                        <button className="btn ghost sm icon" onClick={() => delRole(r)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>
                      </td>
                    )}
                  </tr>
                ))}
                {!tm.roles.length && <tr><td colSpan={4} className="muted small">{t('No roles yet')}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {team && <TeamModal team={team === 'new' ? null : team} nextSort={data?.length ?? 0} onClose={() => setTeam(null)} onSaved={reload} />}
      {role && <RoleModal team={role.team} role={role.role} people={people} onClose={() => setRole(null)} onSaved={reload} />}
      {roster && data?.find((x) => x.id === roster) && (
        <TeamMembersModal team={data.find((x) => x.id === roster)!} people={people} onClose={() => setRoster(null)} onChanged={reload} />
      )}
    </div>
  );
}

/** A team's roster: add / remove members and mark leaders. Changes are saved immediately. */
function TeamMembersModal({ team, people, onClose, onChanged }: { team: TeamFull; people: PersonRow[]; onClose: () => void; onChanged: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [adding, setAdding] = useState<number[]>([]);
  const inTeam = useMemo(() => new Set(team.members.map((m) => m.person_id)), [team]);
  const candidates = useMemo(() => people.filter((p) => !inTeam.has(p.id) && isActive(p)), [people, inTeam]);
  const rolesOf = (pid: number) => team.roles.filter((r) => r.members.some((m) => m.person_id === pid));

  const add = async () => {
    const ok = await run(async () => {
      for (const pid of adding) await api.post(`/teams/${team.id}/members`, { person_id: pid });
      return true;
    }, t('Saved.'));
    if (ok) {
      setAdding([]);
      onChanged();
    }
  };
  const lead = async (m: TeamMemberRef, v: boolean) => {
    if (await run(() => api.patch(`/teams/${team.id}/members/${m.person_id}`, { is_leader: v }))) onChanged();
  };
  const remove = async (m: TeamMemberRef) => {
    const held = rolesOf(m.person_id);
    const msg = held.length
      ? t('{name} is qualified for {roles} in this team. Remove them from the team and drop those qualifications?')
        .replace('{name}', m.name).replace('{roles}', held.map((r) => lt(r.name)).join(', '))
      : t('Remove {name} from this team?').replace('{name}', m.name);
    if (!confirmAction(msg)) return;
    const path = `/teams/${team.id}/members/${m.person_id}${held.length ? '?cascade=1' : ''}`;
    if (await run(() => api.del(path), t('Removed.'))) onChanged();
  };

  return (
    <Modal
      title={<span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: team.color, width: 10, height: 10 }} />{lt(team.name)} · {t('Team members')}</span>}
      onClose={onClose} size="lg" footer={<button className="btn" onClick={onClose}>{t('Close')}</button>}
    >
      <div className="stack">
        {team.members.length ? (
          <div className="card flush table-wrap">
            <table className="t roster-table">
              <thead><tr><th>{t('Name')}</th><th>{t('Qualified for')}</th><th>{t('Team leader')}</th><th /></tr></thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.person_id}>
                    <td>{m.name}</td>
                    <td className="small">{rolesOf(m.person_id).map((r) => lt(r.name)).join(', ') || <span className="muted">—</span>}</td>
                    <td><input type="checkbox" checked={m.is_leader} disabled={busy} onChange={(e) => lead(m, e.target.checked)} aria-label={t('Team leader')} /></td>
                    <td className="right"><button className="btn ghost sm icon" onClick={() => remove(m)} disabled={busy} aria-label={t('Remove')} title={t('Remove')}><Icon name="trash" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted small">{t('Nobody yet')}</p>}
        <div className="gm-add stack tight">
          <h3 className="sect" style={{ margin: 0 }}>{t('Add members')}</h3>
          <PeopleMultiSelect people={candidates} value={adding} onChange={setAdding} height={200} />
          <div className="row end">
            <button className="btn primary" onClick={add} disabled={busy || !adding.length}><Icon name="plus" />{t('Add')}{adding.length > 0 && ` (${adding.length})`}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TeamModal({ team, nextSort, onClose, onSaved }: { team: Team | null; nextSort: number; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(team?.name ?? {});
  const [description, setDescription] = useState(team?.description ?? '');
  const [color, setColor] = useState(team?.color ?? '#2f4a7a');
  const [sort, setSort] = useState(team?.sort ?? nextSort);
  const save = async () => {
    const ok = await run(async () => {
      if (!hasAnyText(name)) throw new Error(t('Name is required.'));
      const body = { name, description: description.trim() || null, color, sort };
      return team ? api.patch(`/teams/${team.id}`, body) : api.post('/teams', body);
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title={team ? t('Edit team') : t('Add team')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <div className="stack">
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} placeholder={{ en: 'Hospitality', zh: '招待' }} /></Field>
        <Field label={t('Description')}><input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="form-grid">
          <Field label={t('Colour')}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></Field>
          <Field label={t('Order')}><input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function RoleModal({ team, role, people, onClose, onSaved }: { team: TeamFull; role: RoleWithMembers | null; people: PersonRow[]; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(role?.name ?? {});
  const [needed, setNeeded] = useState(role?.needed ?? 1);
  const [sort, setSort] = useState(role?.sort ?? team.roles.length);
  const [members, setMembers] = useState<number[]>(role?.members.map((m) => m.person_id) ?? []);
  // qualification is chosen from the team roster first; anyone else picked joins the team on save
  const roster = useMemo(() => new Set(team.members.map((m) => m.person_id)), [team]);
  const outsiders = useMemo(() => people.filter((p) => !roster.has(p.id)), [people, roster]);
  const outsideSel = members.filter((id) => !roster.has(id));
  const [showOthers, setShowOthers] = useState(outsideSel.length > 0 || !team.members.length);
  const toggle = (id: number, on: boolean) => setMembers((ms) => (on ? [...ms, id] : ms.filter((x) => x !== id)));
  const save = async () => {
    const ok = await run(async () => {
      if (!hasAnyText(name)) throw new Error(t('Name is required.'));
      const body = { team_id: team.id, name, needed, sort };
      const r = role ? await api.patch<{ id: number }>(`/roles/${role.id}`, body) : await api.post<{ id: number }>('/roles', body);
      await api.put(`/roles/${r.id}/members`, { person_ids: members });
      return r;
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title={`${lt(team.name)} · ${role ? lt(role.name) : t('Add role')}`} onClose={onClose} size="lg"
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <div className="stack">
        <Field label={t('Name')}><L10nInput value={name} onChange={setName} placeholder={{ en: 'Ushers', zh: '招待员' }} /></Field>
        <div className="form-grid">
          <Field label={t('Needed per service')} hint={t('0 = optional; auto-fill skips it')}><input type="number" min={0} max={50} value={needed} onChange={(e) => setNeeded(Math.max(0, Number(e.target.value) || 0))} /></Field>
          <Field label={t('Order')}><input type="number" value={sort} onChange={(e) => setSort(Number(e.target.value) || 0)} /></Field>
        </div>
        <div>
          <h3 className="sect" style={{ marginBottom: 2 }}>{t('Qualified people')}</h3>
          <p className="muted small">{t('Auto-fill only picks from these people; they are listed first when adding by hand.')}</p>
        </div>
        {team.members.length > 0 && (
          <div className="qual-list">
            {team.members.map((m) => (
              <label key={m.person_id} className="check small">
                <input type="checkbox" checked={members.includes(m.person_id)} onChange={(e) => toggle(m.person_id, e.target.checked)} />
                <span>{m.name}{m.is_leader && <span className="muted"> · {t('Team leader')}</span>}</span>
              </label>
            ))}
          </div>
        )}
        {showOthers ? (
          <div className="stack tight">
            {team.members.length > 0 && <p className="muted small" style={{ margin: 0 }}>{t('Not in the team yet — they join the team when saved:')}</p>}
            <PeopleMultiSelect people={outsiders} value={outsideSel} onChange={(ids) => setMembers([...members.filter((x) => roster.has(x)), ...ids])} />
          </div>
        ) : (
          <div><button type="button" className="btn ghost sm" onClick={() => setShowOthers(true)}><Icon name="plus" />{t('Someone not in the team…')}</button></div>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- unavailability

function AwayTab({ people }: { people: PersonRow[] }) {
  const { t, lang } = useI18n();
  const { canEdit } = useSession();
  const { data, error, loading, reload } = useApi<(Unavailability & { person_name: string })[]>(`/unavailability${qs({ from: today() })}`);
  const { run, busy } = useAction();
  const [pid, setPid] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [reason, setReason] = useState('');
  const sorted = useMemo(() => [...people].sort((a, b) => fullName(a).localeCompare(fullName(b))), [people]);

  const add = async () => {
    const ok = await run(async () => {
      if (!pid) throw new Error(t('Choose a person.'));
      if (to < from) throw new Error(t('The end date is before the start date.'));
      return api.post('/unavailability', { person_id: Number(pid), start_date: from, end_date: to, reason: reason.trim() || null });
    }, t('Saved.'));
    if (ok) {
      setReason('');
      reload();
    }
  };
  const del = async (id: number) => {
    if (await run(() => api.del(`/unavailability/${id}`))) reload();
  };
  const days = (u: Unavailability) => Math.round((new Date(u.end_date).getTime() - new Date(u.start_date).getTime()) / 86400000) + 1;

  return (
    <div className="stack">
      <div className="row end"><CsvTools entity="unavailability" label={t('Unavailability')} onImported={reload} /></div>
      {canEdit && (
        <div className="card">
          <h3 className="sect">{t('Add unavailability')}</h3>
          <div className="form-grid">
            <Field label={t('Person')}>
              <Combo value={pid} noneLabel="—" ariaLabel={t('Person')}
                options={sorted.filter(isActive).map((p) => ({ value: String(p.id), label: fullName(p), search: [p.first_name, p.last_name, p.native_name, p.preferred_name].filter(Boolean).join(' ') }))}
                onChange={setPid} />
            </Field>
            <Field label={t('From')}><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} /></Field>
            <Field label={t('To')}><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
            <Field label={t('Reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('e.g. overseas, exams')} /></Field>
            <div className="row" style={{ alignSelf: 'end' }}><button className="btn primary" onClick={add} disabled={busy}><Icon name="plus" />{t('Add')}</button></div>
          </div>
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? (
        <div className="card"><Empty title={t('Nobody is away.')} /></div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Person')}</th><th>{t('From')}</th><th>{t('To')}</th><th>{t('Days')}</th><th>{t('Reason')}</th>{canEdit && <th />}</tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{u.person_name}</td>
                  <td className="nowrap">{fmtDate(u.start_date, lang)}</td>
                  <td className="nowrap">{fmtDate(u.end_date, lang)}</td>
                  <td>{days(u)}</td>
                  <td className="muted">{u.reason ?? ''}</td>
                  {canEdit && <td className="right"><button className="btn ghost sm icon" onClick={() => del(u.id)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
