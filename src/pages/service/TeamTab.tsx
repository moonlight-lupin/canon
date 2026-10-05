// The service planner: who serves at this service.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { ServiceFull, TeamWithRoles, RosterWarning } from '../../types-client.ts';
import { Combo } from '../../components/Combo.tsx';
import { ReminderDialog } from './ServiceDialogs.tsx';

export function TeamTab({ svc, teams, canEdit, onChange }: { svc: ServiceFull; teams: TeamWithRoles[]; canEdit: boolean; onChange: () => void }) {
  const { t, lt } = useI18n();
  const { run } = useAction();
  const [remind, setRemind] = useState(false);
  const { data: warnings, reload: reloadWarnings } = useApi<RosterWarning[]>(`/services/${svc.id}/warnings`);
  const { data: people } = useApi<{ rows: { id: number; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }[] }>('/people?status=member,regular&limit=2000');
  const { data: away } = useApi<{ person_id: number; start_date: string; end_date: string }[]>(`/unavailability?from=${svc.date}&to=${svc.date}`);
  const awaySet = new Set((away ?? []).map((a) => a.person_id));
  const nameOf = (p: { first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }) =>
    `${p.preferred_name || p.first_name} ${p.last_name}${p.native_name ? ' ' + p.native_name : ''}`.trim();

  const refresh = () => {
    onChange();
    reloadWarnings();
  };
  const assign = async (roleId: number, personId: number) => {
    if (await run(() => api.post(`/services/${svc.id}/assignments`, { role_id: roleId, person_id: personId }))) refresh();
  };
  const cycle = async (a: ServiceFull['assignments'][number]) => {
    const next = a.status === 'scheduled' ? 'confirmed' : a.status === 'confirmed' ? 'declined' : 'scheduled';
    if (await run(() => api.patch(`/assignments/${a.id}`, { status: next }))) refresh();
  };
  const unassign = async (aid: number) => {
    if (await run(() => api.del(`/assignments/${aid}`))) refresh();
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start' }}>
      <div className="stack">
        {canEdit && (
          <div className="row between">
            <span className="muted small">{t('E-mail each volunteer their role, items and times for this service.')}</span>
            <button className="btn sm" onClick={() => setRemind(true)}><Icon name="mail" />{t('Send reminders')}</button>
            {remind && <ReminderDialog svc={svc} onClose={() => setRemind(false)} />}
          </div>
        )}
        {teams.map((tm) => (
          <div key={tm.id} className="card flush">
            <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
              <span className="dot" style={{ background: tm.color }} />
              <h3><Bi v={tm.name} /></h3>
            </div>
            <table className="t">
              <tbody>
                {tm.roles.map((r) => {
                  const as = svc.assignments.filter((a) => a.role_id === r.id);
                  const active = as.filter((a) => a.status !== 'declined').length;
                  const qualified = new Set(r.members.map((m) => m.person_id));
                  return (
                    <tr key={r.id}>
                      <td style={{ width: 200 }}>
                        <Bi v={r.name} />
                        {r.needed > 0 && <div className={`small ${active < r.needed ? '' : 'muted'}`} style={{ color: active < r.needed ? 'var(--warn)' : undefined }}>{active}/{r.needed}</div>}
                      </td>
                      <td>
                        {as.map((a) => (
                          <span key={a.id} className={`chip ${a.status}${awaySet.has(a.person_id) ? ' warn' : ''}`}>
                            <span onClick={() => canEdit && cycle(a)} style={{ cursor: canEdit ? 'pointer' : undefined }} title={t(a.status[0].toUpperCase() + a.status.slice(1))}>
                              {a.status === 'confirmed' && '✓ '}{a.person_name}
                            </span>
                            {canEdit && <button onClick={() => unassign(a.id)} aria-label={t('Delete')}>×</button>}
                          </span>
                        ))}
                        {canEdit && (
                          <span style={{ display: 'inline-block', width: 170, marginLeft: 4 }}>
                            <Combo
                              className="cell-add"
                              value=""
                              placeholder={`+ ${t('Add')}`}
                              ariaLabel={t('Add')}
                              options={[
                                ...r.members.filter((m) => !as.some((a) => a.person_id === m.person_id)).map((m) => ({ value: String(m.person_id), label: m.name, hint: awaySet.has(m.person_id) ? t('away') : undefined, group: t('Qualified for') })),
                                ...(people?.rows ?? []).filter((p) => !qualified.has(p.id) && !as.some((a) => a.person_id === p.id)).map((p) => ({ value: String(p.id), label: nameOf(p), hint: awaySet.has(p.id) ? t('away') : undefined, group: t('All') })),
                              ]}
                              onChange={(v) => v && assign(r.id, Number(v))}
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {!teams.length && <div className="empty">{t('Teams')}: —  <Link to="/volunteers">{t('Volunteers')} →</Link></div>}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('Warnings')}</h3>
        {warnings && warnings.length === 0 && <div className="muted small">{t('No warnings.')}</div>}
        <div className="stack tight">
          {(warnings ?? []).map((w, i) => (
            <div key={i} className="small row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <Icon name="alert" width={14} height={14} style={{ color: w.type === 'unfilled' ? 'var(--ink-3)' : 'var(--warn)', flex: 'none', marginTop: 2 }} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
        <hr />
        <div className="small muted">{lt({ en: 'Click a name to cycle scheduled → confirmed → declined.', zh: '点击姓名切换：已安排 → 已确认 → 已婉拒。' })}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dialogs
