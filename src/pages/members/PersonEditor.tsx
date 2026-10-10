// Members: one member's details — the form, groups and teams, times away and custom fields.
import { optionValue, type MemberField } from '../../../shared/member-fields.ts';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, useApi } from '../../api.ts';
import { useContentLangs, useI18n } from '../../i18n.tsx';
import { langInfo } from '../../../shared/languages.ts';
import { personDisplay } from '../../../shared/people-names.ts';
import { Bi, ErrorBox, Field, Loading, Modal, confirmAction, fmtDate, today, useAction, useSession } from '../../components/ui.tsx';
import { Combo } from '../../components/Combo.tsx';
import { Icon } from '../../components/icons.tsx';
import { HistoryButton } from '../../components/LogTools.tsx';
import { CongregationField } from '../../components/Congregations.tsx';
import type { L10n, MemberStatus, Person, TeamWithRoles, Unavailability } from '../../types-client.ts';
import { STATUSES, STATUS_LABEL, fullName, nullify } from '../people-common.tsx';
import {
  GroupTag, KINDS, KIND_LABEL, KIND_PLURAL, RoleInput, RoleLabel, type GroupRow, type PersonGroups,
} from '../groups-common.tsx';
import { ASSIGN_LABEL, CAT_LABEL, HH_ROLE_LABEL, HH_ROLES, type HouseholdWithMembers, type PersonDetail } from './common.ts';

export type Draft = {
  first_name: string; last_name: string; native_name: string; preferred_name: string; gender: string; birth_date: string;
  phone: string; email: string; address: string; household_id: string; household_role: string; status: MemberStatus;
  membership_date: string; baptism_date: string; baptism_type: string; profession_date: string; preferred_lang: string; notes: string;
  congregation_id: string;
};

export const EMPTY: Draft = {
  first_name: '', last_name: '', native_name: '', preferred_name: '', gender: '', birth_date: '', phone: '', email: '', address: '',
  household_id: '', household_role: '', status: 'member', membership_date: '', baptism_date: '', baptism_type: '', profession_date: '',
  preferred_lang: '', notes: '', congregation_id: '',
};

export const toDraft = (p: Person): Draft => {
  const d = { ...EMPTY };
  for (const k of Object.keys(EMPTY) as (keyof Draft)[]) {
    const v = p[k as keyof Person];
    (d as Record<string, unknown>)[k] = v === null || v === undefined ? '' : String(v);
  }
  return d;
};

export function PersonEditor({ id, households, onClose, onSaved }: { id: number | null; households: HouseholdWithMembers[]; onClose: () => void; onSaved: () => void }) {
  const { t, lang, lt } = useI18n();
  const { canEdit: mayEdit, isAdmin, settings, user } = useSession();
  // the church's own fields; roles that don't see sensitive ones aren't sent them, so leave those out (saving an
  // empty box would otherwise look like clearing the value)
  const seesSensitive = isAdmin || !!user.role_def?.sensitive_fields;
  const fieldDefs = (settings?.member_fields ?? []).filter((d) => seesSensitive || !d.sensitive);
  const detail = useApi<PersonDetail>(id ? `/people/${id}` : null);
  // a member whose personal data was erased (PDPA) stays only as a placeholder: nothing to edit
  const erased = !!detail.data?.erased_at;
  const canEdit = mayEdit && !erased;
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
  // a family that is new to the church: its household made here, without leaving the form (0.19.7, from a UX test)
  const [madeHouseholds, setMadeHouseholds] = useState<{ id: number; name: string }[]>([]);
  const newHousehold = async () => {
    const name = window.prompt(t('Name of the new household'), draft.last_name.trim() ? t('{name} family').replace('{name}', draft.last_name.trim()) : '');
    if (!name?.trim()) return;
    const h = await run(() => api.post<{ id: number; name: string }>('/households', { name: name.trim() }));
    if (h) {
      setMadeHouseholds((x) => [...x, h]);
      set('household_id', String(h.id));
    }
  };
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
      const p = id ? await api.patch<Person>(`/people/${id}`, body, detail.data?.revision != null ? String(detail.data.revision) : null) : await api.post<Person>('/people', body);
      if (rolesDirty || (!id && roles.length)) await api.put(`/people/${p.id}/roles`, { role_ids: roles });
      return p;
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };

  const remove = async () => {
    if (!id || !await confirmAction(t('Delete this person? Their serving history and qualifications will also be removed.'), { danger: true, ok: t('Delete') })) return;
    const ok = await run(() => api.del(`/people/${id}`), t('Deleted.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };

  // PDPA: the member asks what Canon holds about them, or asks for it to be erased (administrators)
  const erase = async () => {
    if (!id || !detail.data) return;
    const name = fullName(detail.data);
    const typed = window.prompt(`${t('Erase this member’s personal data? Their name, contact details, dates, notes and church fields are cleared for good; qualifications, team places, time away, staff records and future duties are removed, and the change log forgets them. Past rotas and group histories keep an anonymous “(erased)” so counts stay right. Names typed on services and offering records (preacher, counters, signatures) are kept as church records. Export their personal data first if they asked for it.')}

${t('Type the member’s name to confirm:')} ${name}`);
    if (typed === null) return;
    const r = await run(() => api.post<{ kept: { services: number; records: number; items: number } }>(`/people/${id}/erase`, { confirm: typed }));
    if (r) {
      const kept = r.kept.services + r.kept.records + r.kept.items;
      window.alert(`${t('Personal data erased.')}${kept ? `
${t('Their name is still typed on {n} services or records (kept as church records; listed in the export).').replace('{n}', String(kept))}` : ''}`);
      onSaved();
      onClose();
    }
  };

  const title = id ? (detail.data ? (erased ? t('Erased member') : fullName(detail.data)) : t('Person')) : t('Add person');
  const pdpa = <span className="pdpa left">{t('Personal data is used only for church administration (PDPA).')}</span>;

  return (
    <Modal
      title={title}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {pdpa}
          {isAdmin && id && <HistoryButton entity="people" id={id} />}
          {isAdmin && id && detail.data && !erased && (
            <a className="btn" href={`/api/people/${id}/personal-data`} download title={t('Everything Canon holds about this person, as a file for them (PDPA access request)')}><Icon name="download" />{t('Personal data')}</a>
          )}
          {isAdmin && id && detail.data && !erased && <button className="btn danger ghost" onClick={erase} disabled={busy} title={t('Erase this member’s personal data (PDPA)')}>{t('Erase…')}</button>}
          {mayEdit && id && <button className="btn danger" onClick={remove} disabled={busy}><Icon name="trash" />{t('Delete')}</button>}
          <button className="btn" onClick={onClose}>{canEdit ? t('Cancel') : t('Close')}</button>
          {canEdit && <button className="btn primary" onClick={save} disabled={busy || (!!id && !detail.data)}>{t('Save')}</button>}
        </>
      }
    >
      {id && detail.error && <ErrorBox error={detail.error} />}
      {erased && (
        <div className="callout small">
          {t('This member’s personal data was erased on {date} (PDPA). The record stays, anonymous, so past rotas and group histories still count.').replace('{date}', fmtDate(detail.data!.erased_at!.slice(0, 10), lang))}
        </div>
      )}
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
                    options={[
                      // who is in it, so that two households of the same name can be told apart
                      ...households.map((h) => ({
                        value: String(h.id), label: h.name,
                        hint: h.members.length ? h.members.slice(0, 3).map((m) => m.first_name).join(', ') + (h.members.length > 3 ? '…' : '') : t('nobody yet'),
                        search: h.members.map((m) => [m.first_name, m.last_name, m.native_name].filter(Boolean).join(' ')).join(' '),
                      })),
                      ...madeHouseholds.map((h) => ({ value: String(h.id), label: h.name, hint: t('just added') })),
                    ]}
                    footer={<button type="button" className="btn ghost sm" onClick={newHousehold}><Icon name="plus" />{t('New household…')}</button>}
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
export function GroupsTeamsEditor({ personId, onQualsRemoved }: { personId: number; onQualsRemoved: (roleIds: number[]) => void }) {
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
    if (!await confirmAction(t('Remove from {name}?').replace('{name}', name), { danger: true, ok: t('Remove') })) return;
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
    if (!await confirmAction(t('Remove from {name}?').replace('{name}', name), { danger: true, ok: t('Remove') })) return;
    try {
      await api.del(`/teams/${teamId}/members/${personId}`);
      mine.reload();
    } catch (e) {
      // still qualified for roles in that team: offer to drop those qualifications too
      if (e instanceof ApiError && e.status === 409 && await confirmAction(t('This person is still qualified for roles in this team. Remove them from the team and drop those qualifications?'))) {
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

export function AwayEditor({ personId, items, onChanged }: { personId: number; items: Unavailability[]; onChanged: () => void }) {
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

/** Common church titles per language. Chinese titles follow the name (林明华弟兄); others precede it (Bro. Lim). */
export const TITLE_PICKS: Record<string, string[]> = {
  zh: ['弟兄', '姐妹', '传道', '牧师', '长老', '执事'],
  'zh-Hant': ['弟兄', '姊妹', '傳道', '牧師', '長老', '執事'],
  en: ['Bro.', 'Sis.', 'Ps.', 'Rev.', 'Elder', 'Dn.'],
};

/** "Title" per church language, with quick picks and a preview of how the name prints in the bulletin. */
export function HonorificField({ value, onChange, person }: { value: L10n; onChange: (v: L10n) => void; person: { first_name: string; last_name: string; preferred_name: string; native_name: string } }) {
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
export function CustomFieldInput({ def, value, onChange }: { def: MemberField; value: string; onChange: (v: string) => void }) {
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
