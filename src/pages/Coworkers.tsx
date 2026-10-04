// Co-worker register: pastors, elders, deacons, staff and lay leaders, grouped by category.
import { useMemo, useState } from 'react';
import { api, qs, useApi } from '../api.ts';
import { DICTS, useI18n } from '../i18n.tsx';
import {
  Bi, Empty, ErrorBox, Field, Loading, Modal, PageHead, SearchBox, confirmAction, fmtDate, today, useAction, useDebounced, useSession,
} from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import type { CoworkerCategory, CoworkerRow, Person, PersonRow } from '../types-client.ts';
import { PersonName, StatusBadge, fullName, nullify } from './people-common.tsx';
import {
  GroupDetailModal, GroupFormModal, GroupTag, RoleInput, RoleLabel, groupStyle, type CommitteesView, type GroupRow, type PersonGroups,
} from './groups-common.tsx';

const CATS: CoworkerCategory[] = ['pastor', 'elder', 'deacon', 'ministry_staff', 'admin_staff', 'lay_leader'];
const CAT_LABEL: Record<CoworkerCategory, string> = {
  pastor: 'Pastor', elder: 'Elder', deacon: 'Deacon', ministry_staff: 'Ministry staff', admin_staff: 'Admin staff', lay_leader: 'Lay leader',
};
const CAT_PLURAL: Record<CoworkerCategory, string> = {
  pastor: 'Pastors', elder: 'Elders', deacon: 'Deacons', ministry_staff: 'Ministry staff', admin_staff: 'Admin staff', lay_leader: 'Lay leaders',
};
type Employment = 'full_time' | 'part_time' | 'volunteer';
const EMP_LABEL: Record<Employment, string> = { full_time: 'Full-time', part_time: 'Part-time', volunteer: 'Volunteer' };

const isPast = (c: CoworkerRow) => !!c.end_date && c.end_date < today();

export default function Coworkers() {
  const { t, lang } = useI18n();
  const { canEdit } = useSession();
  const { data, error, loading, reload } = useApi<CoworkerRow[]>('/coworkers');
  const [showPast, setShowPast] = useState(false);
  const [edit, setEdit] = useState<CoworkerRow | 'new' | null>(null);
  const { run, busy } = useAction();
  const [view, setView] = useState<'register' | 'committees'>('register');
  const committees = useApi<CommitteesView>('/groups/committees');

  const list = useMemo(() => (data ?? []).filter((c) => showPast || !isPast(c)), [data, showPast]);
  const pastCount = (data ?? []).filter(isPast).length;
  const groups = CATS.map((cat) => ({ cat, items: list.filter((c) => c.category === cat) })).filter((g) => g.items.length);

  const remove = async (c: CoworkerRow) => {
    if (!confirmAction(t('Remove this co-worker record? The person stays in the member register.'))) return;
    const ok = await run(() => api.del(`/coworkers/${c.id}`), t('Deleted.'));
    if (ok) reload();
  };
  const year = (d: string | null) => (d ? fmtDate(d, lang, { month: 'short', year: 'numeric' }) : '');

  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Congregation')} title={t('Co-worker register')} sub={data ? `${data.length - pastCount} ${t('serving')} · ${pastCount} ${t('past')}` : undefined}>
        {view === 'register' && <label className="check">
          <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
          {t('Show past co-workers')}
        </label>}
        {view === 'register' && <CsvTools entity="coworkers" label={t('Co-worker register')} onImported={reload} />}
        {canEdit && view === 'register' && <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" />{t('Add co-worker')}</button>}
      </PageHead>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'register'} className={view === 'register' ? 'on' : ''} onClick={() => setView('register')}>{t('Co-workers')}</button>
        <button role="tab" aria-selected={view === 'committees'} className={view === 'committees' ? 'on' : ''} onClick={() => setView('committees')}>
          {t('Committees')}{committees.data ? ` · ${committees.data.committees.length}` : ''}
        </button>
      </div>
      {view === 'committees' ? <CommitteesTab view={committees} /> : <>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !groups.length ? (
        <div className="card"><Empty title={t('No co-workers yet')}><p>{t('Record pastors, elders, deacons, staff and lay leaders here.')}</p></Empty></div>
      ) : (
        groups.map((g) => (
          <section key={g.cat} className="cw-section">
            <h2>
              {t(CAT_PLURAL[g.cat])}
              <span className="zh">{lang === 'en' ? DICTS.zh[CAT_PLURAL[g.cat]] : CAT_PLURAL[g.cat]}</span>
              <span className="badge">{g.items.length}</span>
            </h2>
            <div className="grid cols-3">
              {g.items.map((c) => (
                <article key={c.id} className={`card cw-card${isPast(c) ? ' past' : ''}`}>
                  <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="pos">{c.position}</div>
                      <div>{c.person_name}</div>
                    </div>
                    {canEdit && (
                      <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                        <button className="btn ghost sm icon" onClick={() => setEdit(c)} aria-label={t('Edit')} title={t('Edit')}><Icon name="edit" /></button>
                        <button className="btn ghost sm icon" onClick={() => remove(c)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge">{t(EMP_LABEL[c.employment])}</span>
                    {c.ordained && <span className="badge reed"><Icon name="check" width={11} height={11} />{t('Ordained')}</span>}
                    {isPast(c) && <span className="badge">{t('Past')}</span>}
                  </div>
                  {!!committees.data?.tags[c.person_id]?.length && (
                    <div className="gtags">
                      {committees.data.tags[c.person_id].map((g) => <GroupTag key={g.member_id} name={g.name} color={g.color} role={g.role} />)}
                    </div>
                  )}
                  {c.ministry_area && <div className="small"><span className="muted">{t('Ministry area')}:</span> {c.ministry_area}</div>}
                  {(c.start_date || c.end_date) && (
                    <div className="small muted">{year(c.start_date) || '…'} – {c.end_date ? year(c.end_date) : t('present')}</div>
                  )}
                  {(c.phone || c.email) && (
                    <div className="contact">
                      {c.phone && <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>}
                      {c.email && <a href={`mailto:${c.email}`}><Icon name="mail" />{c.email}</a>}
                    </div>
                  )}
                  {c.notes && <div className="small muted">{c.notes}</div>}
                </article>
              ))}
            </div>
          </section>
        ))
      )}
      </>}
      {edit && <CoworkerModal row={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={reload} onCommittees={committees.reload} />}
    </div>
  );
}

// ---------------------------------------------------------------- add / edit

type Draft = {
  position: string; category: CoworkerCategory; employment: Employment; ministry_area: string; ordained: boolean;
  start_date: string; end_date: string; notes: string;
};

function CoworkerModal({ row, onClose, onSaved, onCommittees }: { row: CoworkerRow | null; onClose: () => void; onSaved: () => void; onCommittees: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [personId, setPersonId] = useState<number | null>(row?.person_id ?? null);
  const [personLabel, setPersonLabel] = useState(row?.person_name ?? '');
  const [mode, setMode] = useState<'pick' | 'create'>('pick');
  const [np, setNp] = useState({ first_name: '', last_name: '', native_name: '', phone: '', email: '' });
  const [d, setD] = useState<Draft>({
    position: row?.position ?? '', category: row?.category ?? 'elder', employment: row?.employment ?? 'volunteer',
    ministry_area: row?.ministry_area ?? '', ordained: row?.ordained ?? false, start_date: row?.start_date ?? '', end_date: row?.end_date ?? '',
    notes: row?.notes ?? '',
  });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = async () => {
    const ok = await run(async () => {
      if (!d.position.trim()) throw new Error(t('Position is required.'));
      let pid = personId;
      if (!row && mode === 'create') {
        if (!np.first_name.trim()) throw new Error(t('First name is required.'));
        const p = await api.post<Person>('/people', { ...nullify(np), last_name: np.last_name.trim(), status: 'member' });
        pid = p.id;
      }
      if (!pid) throw new Error(t('Choose a person.'));
      const body = { ...nullify({ ...d }), person_id: pid, position: d.position.trim(), ordained: d.ordained, category: d.category, employment: d.employment };
      return row ? api.patch(`/coworkers/${row.id}`, body) : api.post('/coworkers', body);
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };

  return (
    <Modal
      title={row ? `${row.position} · ${row.person_name}` : t('Add co-worker')}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}
    >
      <div className="stack">
        <section>
          <h3 className="sect">{t('Person')}</h3>
          {row ? (
            <div>{row.person_name}</div>
          ) : (
            <>
              <div className="seg" role="group" style={{ marginBottom: 8 }}>
                <button type="button" className={mode === 'pick' ? 'on' : ''} onClick={() => setMode('pick')}>{t('From the register')}</button>
                <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>{t('New person')}</button>
              </div>
              {mode === 'pick' ? (
                <PersonPicker value={personId} label={personLabel} onChange={(id, label) => { setPersonId(id); setPersonLabel(label); }} />
              ) : (
                <div className="form-grid">
                  <Field label={`${t('First name')} *`}><input value={np.first_name} onChange={(e) => setNp({ ...np, first_name: e.target.value })} /></Field>
                  <Field label={t('Last name')}><input value={np.last_name} onChange={(e) => setNp({ ...np, last_name: e.target.value })} /></Field>
                  <Field label={t('Chinese name')}><input lang="zh-Hans" value={np.native_name} onChange={(e) => setNp({ ...np, native_name: e.target.value })} /></Field>
                  <Field label={t('Phone')}><input type="tel" value={np.phone} onChange={(e) => setNp({ ...np, phone: e.target.value })} /></Field>
                  <Field label={t('Email')}><input type="email" value={np.email} onChange={(e) => setNp({ ...np, email: e.target.value })} /></Field>
                </div>
              )}
            </>
          )}
        </section>
        <section>
          <h3 className="sect">{t('Position')}</h3>
          <div className="form-grid">
            <Field label={`${t('Position')} *`}><input value={d.position} onChange={(e) => set('position', e.target.value)} placeholder={t('e.g. Senior Pastor, Ruling Elder')} /></Field>
            <Field label={t('Category')}>
              <select value={d.category} onChange={(e) => set('category', e.target.value as CoworkerCategory)}>
                {CATS.map((c) => <option key={c} value={c}>{t(CAT_LABEL[c])}</option>)}
              </select>
            </Field>
            <Field label={t('Employment')}>
              <select value={d.employment} onChange={(e) => set('employment', e.target.value as Employment)}>
                {(Object.keys(EMP_LABEL) as Employment[]).map((k) => <option key={k} value={k}>{t(EMP_LABEL[k])}</option>)}
              </select>
            </Field>
            <Field label={t('Ministry area')}><input value={d.ministry_area} onChange={(e) => set('ministry_area', e.target.value)} placeholder={t('e.g. Youth, Chinese congregation')} /></Field>
            <Field label={t('Start date')}><input type="date" value={d.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
            <Field label={t('End date')} hint={t('Leave blank while serving')}><input type="date" value={d.end_date} onChange={(e) => set('end_date', e.target.value)} /></Field>
            <label className="check" style={{ alignSelf: 'center' }}>
              <input type="checkbox" checked={d.ordained} onChange={(e) => set('ordained', e.target.checked)} />{t('Ordained')}
            </label>
            <Field label={t('Notes')} className="span-all"><textarea rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
          </div>
        </section>
        {(row?.person_id ?? personId) && <CommitteeTagger personId={(row?.person_id ?? personId)!} onChanged={onCommittees} />}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- committees

/** Committees (groups of kind 'committee') with their members and committee roles. */
function CommitteesTab({ view }: { view: ReturnType<typeof useApi<CommitteesView>> }) {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const { data, error, loading, reload } = view;
  return (
    <div className="stack">
      <div className="row between">
        <p className="muted small" style={{ margin: 0 }}>{t('Committees are groups of kind “Committee”; they also appear under Groups.')}</p>
        {canEdit && <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('Add committee')}</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data?.committees.length ? (
        <div className="card"><Empty title={t('No committees yet')}><p>{t('e.g. Session 堂会, Board of Deacons 执事会, Missions Committee 宣教委员会.')}</p></Empty></div>
      ) : (
        <div className="grid cols-2">
          {data.committees.map((c) => (
            <article key={c.id} className="card cm-card" style={groupStyle(c.color)}>
              <div className="row between" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <div>
                  <h3><Bi v={c.name} /></h3>
                  {c.meeting && <div className="small muted">{c.meeting}</div>}
                </div>
                <button className="btn sm" onClick={() => setOpen(c.id)}>{canEdit ? <><Icon name="edit" />{t('Edit members')}</> : t('Open')}</button>
              </div>
              {c.members.length ? (
                <ul className="cm-list">
                  {c.members.map((m) => (
                    <li key={m.id}>
                      <span>{m.name}{m.positions.length > 0 && <span className="muted small"> · {m.positions.join(', ')}</span>}</span>
                      <RoleLabel role={m.role} className="r" />
                    </li>
                  ))}
                </ul>
              ) : <p className="muted small" style={{ margin: 0 }}>{t('No members yet')}</p>}
            </article>
          ))}
        </div>
      )}
      {creating && <GroupFormModal group={null} kind="committee" nextSort={data?.committees.length ?? 0} onClose={() => setCreating(false)} onSaved={(g) => { reload(); setOpen(g.id); }} />}
      {open && <GroupDetailModal groupId={open} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

/** Tag a person into committees with a role (saved immediately). */
function CommitteeTagger({ personId, onChanged }: { personId: number; onChanged: () => void }) {
  const { t, lt } = useI18n();
  const mine = useApi<PersonGroups>(`/people/${personId}/groups`);
  const all = useApi<GroupRow[]>('/groups?kind=committee');
  const { run, busy } = useAction();
  const [gid, setGid] = useState('');
  const [role, setRole] = useState('');
  const current = (mine.data?.groups ?? []).filter((g) => g.kind === 'committee' && g.current);
  const free = (all.data ?? []).filter((g) => !(mine.data?.groups ?? []).some((x) => x.group_id === g.id));
  const changed = () => {
    mine.reload();
    onChanged();
  };
  const add = async () => {
    if (!gid) return;
    if (await run(() => api.post(`/groups/${gid}/members`, { person_id: personId, role: role.trim() || null }), t('Saved.'))) {
      setGid('');
      setRole('');
      changed();
    }
  };
  const remove = async (memberId: number, name: string) => {
    if (!confirmAction(t('Remove from {name}?').replace('{name}', name))) return;
    if (await run(() => api.del(`/group-members/${memberId}`))) changed();
  };
  return (
    <section>
      <h3 className="sect">{t('Committees')}</h3>
      <div className="gtags" style={{ marginBottom: 8 }}>
        {current.map((g) => <GroupTag key={g.id} name={g.name} color={g.color} role={g.role} onRemove={busy ? undefined : () => remove(g.id, lt(g.name))} />)}
        {!current.length && <span className="muted small">{t('Not on any committee.')}</span>}
      </div>
      {free.length > 0 && (
        <div className="pg-add">
          <select value={gid} onChange={(e) => setGid(e.target.value)} aria-label={t('Committee')}>
            <option value="">{t('Add to committee…')}</option>
            {free.map((g) => <option key={g.id} value={g.id}>{lt(g.name)}</option>)}
          </select>
          <RoleInput value={role} onChange={setRole} />
          <button className="btn" onClick={add} disabled={busy || !gid}><Icon name="plus" />{t('Add')}</button>
        </div>
      )}
      <p className="muted small" style={{ margin: '6px 0 0' }}>{t('Committee changes are saved immediately.')}</p>
    </section>
  );
}

/** Search the member register and pick one person. */
function PersonPicker({ value, label, onChange }: { value: number | null; label: string; onChange: (id: number | null, label: string) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim(), 200);
  const { data } = useApi<{ total: number; rows: PersonRow[] }>(`/people${qs({ q: dq, limit: 30 })}`);
  if (value) {
    return (
      <div className="row between card sub-card" style={{ padding: '8px 12px' }}>
        <strong>{label}</strong>
        <button className="btn sm" onClick={() => onChange(null, '')}>{t('Change')}</button>
      </div>
    );
  }
  return (
    <div className="stack tight">
      <SearchBox value={q} onChange={setQ} placeholder={t('Name, 中文名, email or phone…')} autoFocus />
      <div className="person-results">
        {(data?.rows ?? []).map((p) => (
          <button key={p.id} type="button" onClick={() => onChange(p.id, fullName(p))}>
            <PersonName p={p} />
            <StatusBadge status={p.status} />
          </button>
        ))}
        {data && !data.rows.length && <div className="muted small" style={{ padding: 10 }}>{t('No matches.')}</div>}
      </div>
    </div>
  );
}
