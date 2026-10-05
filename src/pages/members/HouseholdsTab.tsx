// Members → Households.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Modal, SearchBox, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { Household, Person, PersonRow } from '../../types-client.ts';
import { PersonName, fullName, nullify } from '../people-common.tsx';
import { HH_ROLE_LABEL, HH_ROLES, type HhRole, type HouseholdWithMembers } from './common.ts';

export const ROLE_ORDER: Record<string, number> = { head: 0, spouse: 1, child: 2, other: 3 };

export const sortMembers = (ms: Person[]) =>
  [...ms].sort((a, b) => (ROLE_ORDER[a.household_role ?? ''] ?? 4) - (ROLE_ORDER[b.household_role ?? ''] ?? 4) || (a.birth_date ?? '9').localeCompare(b.birth_date ?? '9'));

export function HouseholdsTab({
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

export function HouseholdModal({ household, onClose, onSaved }: { household: Household | null; onClose: () => void; onSaved: () => void }) {
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
