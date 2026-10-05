// One meeting: its details (date, time, place, who chairs, topic and passage, offering or not), its record, an
// optional order of service, and the next meeting (a copy a week later, or another date).
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { useCanRecord, Bi, ErrorBox, Field, L10nInput, Loading, confirmAction, fmtDate, addDays, useAction, useSession, L10nEditScope, L10nSwitcher } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Combo, type ComboOption } from '../../components/Combo.tsx';
import type { ServiceFull, L10n } from '../../types-client.ts';
import type { ServiceRecord } from '../../../shared/records.ts';
import type { Group } from '../../../shared/types.ts';

type Draft = Pick<ServiceFull, 'title' | 'date' | 'start_time' | 'place' | 'leader_id' | 'chair' | 'topic' | 'sermon_ref' | 'offering' | 'notes'>;
const draftOf = (m: ServiceFull): Draft => ({
  title: m.title, date: m.date, start_time: m.start_time, place: m.place ?? '', leader_id: m.leader_id ?? null, chair: m.chair ?? '', topic: m.topic ?? {},
  sermon_ref: m.sermon_ref ?? '', offering: !!m.offering, notes: m.notes ?? '',
});

export default function MeetingPage() {
  const { id } = useParams();
  const mid = Number(id);
  const nav = useNavigate();
  const { t, lang } = useI18n();
  const { canEdit: editor } = useSession();
  const canRecord = useCanRecord();
  const meeting = useApi<ServiceFull>(`/services/${mid}`);
  const record = useApi<ServiceRecord & { saved: boolean }>(`/services/${mid}/record`);
  const groupId = meeting.data?.group_id ?? null;
  const group = useApi<Group & { members: { person_id: number; name: string; current: boolean; leads?: boolean | number }[] }>(groupId ? `/groups/${groupId}` : null);
  const people = useApi<{ rows: { id: number; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }[] }>(editor ? '/people?limit=5000' : null);
  const { run, busy } = useAction();
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (meeting.data) setD(draftOf(meeting.data));
  }, [meeting.data]);
  const [nextDate, setNextDate] = useState('');

  if (meeting.error) return <div className="page"><ErrorBox error={meeting.error} /></div>;
  if (!meeting.data || !d) return <div className="page"><Loading /></div>;
  const m = meeting.data;
  // editors, or the leader of this meeting: its details, record and next meeting (deleting stays with editors)
  const canEdit = editor || canRecord(m);
  if (m.kind !== 'meeting') {
    nav(`/services/${mid}`, { replace: true });
    return null;
  }
  const dirty = JSON.stringify(d) !== JSON.stringify(draftOf(m));
  const set = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));
  const save = () => run(async () => {
    const r = await api.patch<ServiceFull>(`/services/${mid}`, {
      ...d, place: d.place?.trim() || null, chair: d.leader_id ? null : d.chair?.trim() || null, sermon_ref: d.sermon_ref?.trim() || null, notes: d.notes?.trim() || null,
    }, String(m.revision ?? 0));
    meeting.setData(r);
  }, t('Saved.'));
  const next = () => run(async () => {
    const r = await api.post<ServiceFull>(`/services/${mid}/duplicate`, { date: nextDate || addDays(m.date, 7) });
    nav(`/meetings/${r.id}`);
  }, t('Next meeting created.'));
  const remove = () => {
    if (!confirmAction(t('Delete this meeting? A meeting with a record can’t be deleted.'))) return;
    run(async () => {
      await api.del(`/services/${mid}`);
      nav(groupId ? `/meetings?group=${groupId}` : '/meetings');
    }, t('Deleted.'));
  };
  // the leader: a member (the group's leaders first), or a name typed for someone outside the register
  const leads = new Set((group.data?.members ?? []).filter((x) => x.current && x.leads).map((x) => x.person_id));
  const inGroup = new Set((group.data?.members ?? []).filter((x) => x.current).map((x) => x.person_id));
  const leaderOptions: ComboOption[] = (people.data?.rows ?? []).map((p) => ({
    value: String(p.id),
    label: `${p.preferred_name || p.first_name} ${p.last_name}`.trim() + (p.native_name ? ` ${p.native_name}` : ''),
    group: leads.has(p.id) ? t('Leads this group') : inGroup.has(p.id) ? t('In this group') : t('Everyone'),
  })).sort((a, b) => (a.group === b.group ? a.label.localeCompare(b.label) : (a.group === t('Leads this group') ? -1 : b.group === t('Leads this group') ? 1 : a.group === t('In this group') ? -1 : 1)));
  const leaderName = m.leader_id ? (leaderOptions.find((o) => o.value === String(m.leader_id))?.label ?? '') : '';
  const rec = record.data;

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="rec-head">
        <Link className="btn sm ghost" to={groupId ? `/meetings?group=${groupId}` : '/meetings'}><Icon name="chevronLeft" />{t('Meetings')}</Link>
        <h1><Bi v={m.title} /></h1>
        <span className="muted">{fmtDate(m.date, lang)} · {m.start_time}</span>
        {group.data ? <span className="row small" style={{ gap: 6 }}><span className="dot" style={{ background: group.data.color }} /><Bi v={group.data.name} /></span> : !groupId && <span className="badge">{t('One-off')}</span>}
      </div>

      <section className="card stack">
        <div className="row between">
          <h3 style={{ margin: 0 }}>{t('Record')}</h3>
          <Link className="btn primary sm" to={`/records/${mid}`}><Icon name="list" />{rec?.saved ? t('Open the record') : t('Record this meeting')}</Link>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {rec?.saved
            ? `${t('Attendance')}: ${rec.attendance ?? '—'} · ${t('New visitors')}: ${rec.visitors.length}${m.offering ? ` · ${t('Offering')}: ${rec.verified_at ? t('Verified') : rec.offerings.length ? t('Not verified yet') : '—'}` : ''}`
            : t('Headcount, new visitors and notes for the leaders — and the offering, if one is taken.')}
        </p>
      </section>

      <fieldset disabled={!canEdit} className="bare stack">
        <L10nEditScope>
        <section className="card stack">
          <div className="l10n-section-head">
            <h3 style={{ margin: 0 }}>{t('Details')}</h3>
            <L10nSwitcher min={2} />
          </div>
          <Field label={t('Title')}><L10nInput value={d.title} onChange={(v: L10n) => set({ title: v })} /></Field>
          <div className="form-grid">
            <Field label={t('Date')}><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
            <Field label={t('Start time')}><input type="time" value={d.start_time} onChange={(e) => set({ start_time: e.target.value })} /></Field>
            <Field label={t('Place')}><input value={d.place ?? ''} onChange={(e) => set({ place: e.target.value })} placeholder={t('e.g. church hall, or a home')} /></Field>
            <Field label={<>{t('Leader')} <InfoTip text={t('Pick the member who leads this meeting: if their Canon account is linked to them (Settings → Users), they can record it. For someone outside the register, type their name instead.')} /></>}>
              {editor
                ? <Combo value={d.leader_id ? String(d.leader_id) : ''} options={leaderOptions} noneLabel="—" ariaLabel={t('Leader')} onChange={(v) => set({ leader_id: v ? Number(v) : null })} />
                : <input value={leaderName || (d.chair ?? '')} readOnly />}
            </Field>
            {editor && !d.leader_id && <Field label={t('Or the leader’s name')}><input value={d.chair ?? ''} onChange={(e) => set({ chair: e.target.value })} placeholder={t('someone not in the register')} /></Field>}
            <Field label={t('Passage')}><input value={d.sermon_ref ?? ''} onChange={(e) => set({ sermon_ref: e.target.value })} placeholder="Acts 2:42-47" /></Field>
          </div>
          <Field label={t('Topic')}><L10nInput value={d.topic ?? {}} onChange={(v: L10n) => set({ topic: v })} /></Field>
          <label className="check">
            <input type="checkbox" checked={!!d.offering} onChange={(e) => set({ offering: e.target.checked })} />
            {t('An offering is taken at this meeting')} <InfoTip text={t('With an offering, the record has the cash count, declaration and signing, as for a service. The next meeting copies this choice.')} />
          </label>
          {!d.offering && rec?.saved && rec.offerings.length > 0 && <div className="callout small">{t('This meeting’s record already has offerings. They stay in the record but are not counted in the offerings reports while no offering is taken.')}</div>}
          <Field label={t('Notes')}><textarea rows={3} value={d.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} /></Field>
          {canEdit && <div><button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button></div>}
        </section>
        </L10nEditScope>
      </fieldset>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>{t('More')}</h3>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm" to={`/services/${mid}`}><Icon name="list" />{m.items.length ? t('Order of service') : t('Add an order of service')}</Link>
          {canEdit && (
            <>
              <span className="row" style={{ gap: 6 }}>
                <input type="date" value={nextDate || addDays(m.date, 7)} onChange={(e) => setNextDate(e.target.value)} style={{ width: 160 }} aria-label={t('Date of the next meeting')} />
                <button className="btn sm" onClick={next} disabled={busy}><Icon name="copy" />{t('Next meeting')}</button>
              </span>
              {editor && <button className="btn sm danger" onClick={remove} disabled={busy} style={{ marginLeft: 'auto' }}><Icon name="trash" />{t('Delete')}</button>}
            </>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{t('An order of service, bulletin and slides are optional for a meeting. Next meeting copies this one to the date chosen.')}</p>
      </section>
    </div>
  );
}
