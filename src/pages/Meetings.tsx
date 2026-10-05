// Meetings: fellowship meetings, cell groups, prayer meetings, Sunday school classes, committee meetings and one-off
// gatherings — a lighter kind of service, of a group or on its own, each with its own leader. A group's new meeting
// copies its previous one (time, place, leader, offering or not), so after the first it is mostly just a date. Each
// meeting has a record like a service's.
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, L10nInput, Loading, Modal, PageHead, Seg, fmtDate, today, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationBadge, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { meetingGroups, type GroupRow } from './groups-common.tsx';
import type { ServiceFull, ServiceListRow } from '../types-client.ts';
import type { L10n } from '../types-client.ts';

export type MeetingRow = ServiceListRow & { group_name: L10n | null; group_color: string | null; attendance: number | null; recorded: boolean; leader_name: string | null };


export default function Meetings() {
  const { t, lang } = useI18n();
  const { canEdit, user } = useSession();
  // leaders may start meetings of the groups they lead
  const mayCreate = canEdit || (user.leads ?? []).length > 0;
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [cong, setCong, congs] = useCongregationFilter('meetings');
  // a group's id, 'none' for one-off meetings, or all
  const group: number | 'none' | null = params.get('group') === 'none' ? 'none' : Number(params.get('group')) || null;
  const groups = useApi<GroupRow[]>('/groups');
  const path = when === 'upcoming'
    ? `/meetings${qs({ from: today(), congregation: cong, group })}`
    : `/meetings${qs({ to: today(), limit: 100, congregation: cong, group })}`;
  const { data, error } = useApi<MeetingRow[]>(path);
  const creating = params.get('new') !== null;
  const setGroup = (g: string) => setParams(g ? { group: g } : {});

  return (
    <div className="page">
      <PageHead eyebrow={t('Congregation')} title={t('Meetings')} sub={t('Fellowship meetings, cell groups, Sunday school classes, one-off gatherings and other meetings, with their records.')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        <select value={group ?? ''} onChange={(e) => setGroup(e.target.value)} aria-label={t('Group')}>
          <option value="">{t('All meetings')}</option>
          <option value="none">{t('One-off meetings')}</option>
          {meetingGroups(groups.data).map((g) => <option key={g.id} value={g.id}>{g.name[lang] || g.name.en || g.name.zh}</option>)}
        </select>
        <Seg value={when} onChange={setWhen} options={[{ value: 'upcoming', label: t('Upcoming') }, { value: 'past', label: t('Past') }]} />
        {mayCreate && <button className="btn primary" onClick={() => setParams({ ...(group ? { group: String(group) } : {}), new: '' })}><Icon name="plus" />{t('New meeting')}</button>}
      </PageHead>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.length ? (
        <div className="card">
          <Empty title={when === 'upcoming' ? t('No meetings planned') : t('No past meetings')}>
            <p>{t('A meeting can belong to a group — then each new one copies the one before — or stand on its own, such as a one-off prayer meeting.')}</p>
          </Empty>
        </div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Date')}</th><th>{t('Group')}</th><th>{t('Meeting')}</th><th>{t('Place')}</th><th>{t('Leader')}</th><th className="right">{t('Attendance')}</th></tr></thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id} className="click" onClick={() => nav(`/meetings/${m.id}`)}>
                  <td className="nowrap"><Link to={`/meetings/${m.id}`} onClick={(e) => e.stopPropagation()}><strong>{fmtDate(m.date, lang)}</strong></Link> <span className="muted">{m.start_time}</span></td>
                  <td className="nowrap">{m.group_name ? <span className="row" style={{ gap: 6 }}><span className="dot" style={{ background: m.group_color ?? undefined }} /><Bi v={m.group_name} /></span> : <span className="small muted">{t('One-off')}</span>}</td>
                  <td><CongregationBadge id={m.congregation_id} list={congs} /> <Bi v={m.title} />{m.topic && Object.values(m.topic).some(Boolean) && <div className="small muted serif"><Bi v={m.topic} />{m.sermon_ref ? ` · ${m.sermon_ref}` : ''}</div>}</td>
                  <td>{m.place}</td>
                  <td>{m.leader_name ?? m.chair}</td>
                  <td className="right nowrap">{m.recorded ? (m.attendance ?? '—') : <span className="small muted">{t('Not recorded')}</span>}{m.offering && <> <Icon name="gift" width={13} height={13} /></>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewMeetingDialog initialGroup={typeof group === 'number' ? group : null} onClose={() => setParams(group ? { group: String(group) } : {})} />}
    </div>
  );
}

/** A new meeting: of a group (the rest is copied from its previous meeting) or a one-off with its own title. */
export function NewMeetingDialog({ onClose, initialGroup }: { onClose: () => void; initialGroup?: number | null }) {
  const { t, lang } = useI18n();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const { canEdit, user } = useSession();
  const groups = useApi<GroupRow[]>('/groups');
  // a leader (read-only account) starts meetings of the groups they lead only
  const offered = meetingGroups(groups.data).filter((g) => canEdit || (user.leads ?? []).includes(g.id));
  // a group's id, 0 for a one-off meeting, null while not chosen
  const [groupId, setGroupId] = useState<number | null>(initialGroup ?? null);
  const [date, setDate] = useState(today());
  const [title, setTitle] = useState<L10n>({});
  const oneOff = groupId === 0;
  const ready = groupId !== null && (!oneOff || Object.values(title).some((v) => v?.trim()));
  const create = async () => {
    if (!ready) return;
    const r = await run(() => api.post<ServiceFull>('/meetings', oneOff ? { date, title } : { group_id: groupId, date }));
    if (r) {
      onClose();
      nav(`/meetings/${r.id}`);
    }
  };
  return (
    <Modal title={t('New meeting')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={create} disabled={busy || !ready}>{t('New meeting')}</button>
      </>
    }>
      <div className="stack">
        <div className="form-grid">
          <Field label={t('Group')}>
            <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">{t('Choose…')}</option>
              {canEdit && <option value="0">{t('No group (a one-off meeting)')}</option>}
              {offered.map((g) => <option key={g.id} value={g.id}>{g.name[lang] || g.name.en || g.name.zh}</option>)}
            </select>
          </Field>
          <Field label={t('Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {oneOff && <Field label={t('Title')}><L10nInput value={title} onChange={setTitle} placeholder={{ en: 'Prayer meeting for the building fund', zh: '建堂祷告会' }} /></Field>}
        <p className="small muted" style={{ margin: 0 }}>
          {oneOff
            ? t('Set the time, place, leader and offering on the meeting’s page next.')
            : t('The time, place, leader and whether an offering is taken are copied from the group’s previous meeting. Change them on the meeting’s page.')}
        </p>
      </div>
    </Modal>
  );
}
