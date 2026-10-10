// The church calendar: services, meetings and the church's other events (a retreat, a wedding, a working bee …) by
// month, week or as a list, for a congregation and a group. Services and meetings open their own pages; events are
// added and changed here (editors). On a phone the month and week show as a list.
import { dateLocale } from '../../shared/languages.ts';
import { SpaceClashes, SpaceField } from '../components/Spaces.tsx';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Field, L10nInput, Loading, Modal, PageHead, Seg, addDays, confirmAction, fmtDate, today, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationField, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import { meetingGroups, type GroupRow } from './groups-common.tsx';
import type { L10n } from '../types-client.ts';
import './calendar.css';

interface Item {
  type: 'service' | 'meeting' | 'event';
  id: number;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  title: L10n;
  place: string | null;
  space?: L10n | null;
  congregation_id: number | null;
  group_id: number | null;
  group_name: L10n | null;
  color: string | null;
}
type View = 'month' | 'week' | 'list';

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;
const weekStart = (d: string) => addDays(d, -new Date(`${d}T12:00:00Z`).getUTCDay());
const monthEnd = (d: string) => {
  const x = new Date(`${monthStart(d)}T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + 1);
  x.setUTCDate(0);
  return x.toISOString().slice(0, 10);
};
const shiftMonth = (d: string, n: number) => {
  const x = new Date(`${monthStart(d)}T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x.toISOString().slice(0, 10);
};
/** The days an item is on, within the period (events can span several days). */
const daysOf = (it: Item, from: string, to: string) => {
  const out: string[] = [];
  for (let d = it.date > from ? it.date : from; d <= (it.end_date ?? it.date) && d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

export default function Calendar() {
  const { t, lang, lt } = useI18n();
  const { canEdit } = useSession();
  const nav = useNavigate();
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'list' : 'month'));
  const [anchor, setAnchor] = useState(today());
  const [cong, setCong, congs] = useCongregationFilter('calendar');
  const [group, setGroup] = useState<number | null>(null);
  const groups = useApi<GroupRow[]>('/groups');
  const [editing, setEditing] = useState<number | 'new' | null>(null);

  // the period shown: a month (as whole weeks), a week, or the next eight weeks as a list
  const [from, to] = view === 'month'
    ? [weekStart(monthStart(anchor)), addDays(weekStart(monthEnd(anchor)), 6)]
    : view === 'week' ? [weekStart(anchor), addDays(weekStart(anchor), 6)] : [anchor, addDays(anchor, 55)];
  const { data, error, reload } = useApi<Item[]>(`/calendar${qs({ from, to, congregation: cong, group })}`);
  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of data ?? []) for (const d of daysOf(it, from, to)) m.set(d, [...(m.get(d) ?? []), it]);
    return m;
  }, [data, from, to]);
  const open = (it: Item) => {
    if (it.type === 'service') nav(`/services/${it.id}`);
    else if (it.type === 'meeting') nav(`/meetings/${it.id}`);
    else setEditing(it.id);
  };
  const step = (n: number) => setAnchor(view === 'month' ? shiftMonth(anchor, n) : addDays(anchor, n * (view === 'week' ? 7 : 56)));
  const heading = view === 'month'
    ? new Date(`${monthStart(anchor)}T12:00:00Z`).toLocaleDateString(dateLocale(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${fmtDate(from, lang)} – ${fmtDate(to, lang)}`;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const weekdays = days.slice(0, 7).map((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(dateLocale(lang), { weekday: 'short', timeZone: 'UTC' }));

  const chip = (it: Item, d: string) => (
    <button key={`${it.type}-${it.id}-${d}`} type="button" className={`cal-item ${it.type}`} onClick={() => open(it)}
      style={it.color ? { ['--gc' as string]: it.color } : undefined} title={`${it.start_time ?? ''} ${lt(it.title)}`}>
      {it.start_time && d === it.date && <span className="cal-time">{it.start_time}</span>}
      <Bi v={it.title} />
    </button>
  );

  return (
    <div className="page cal-page">
      <PageHead eyebrow={t('Church')} title={t('Calendar')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        <select value={group ?? ''} onChange={(e) => setGroup(Number(e.target.value) || null)} aria-label={t('Group')} style={{ maxWidth: 220 }}>
          <option value="">{t('All groups')}</option>
          {meetingGroups(groups.data).map((g) => <option key={g.id} value={g.id}>{lt(g.name)}</option>)}
        </select>
        <Seg<View> value={view} onChange={setView} options={[{ value: 'month', label: t('Month') }, { value: 'week', label: t('Week') }, { value: 'list', label: t('List') }]} />
        {canEdit && <button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" />{t('New event')}</button>}
      </PageHead>
      <div className="cal-bar">
        <button className="btn sm ghost icon" onClick={() => step(-1)} aria-label={t('Earlier')}><Icon name="chevronLeft" /></button>
        <button className="btn sm" onClick={() => setAnchor(today())}>{t('Today')}</button>
        <button className="btn sm ghost icon" onClick={() => step(1)} aria-label={t('Later')}><Icon name="chevronRight" /></button>
        <h2 className="cal-heading">{heading}</h2>
        <span className="cal-key small muted">
          <span className="cal-dot service" />{t('Services')} <span className="cal-dot meeting" />{t('Meetings')} <span className="cal-dot event" />{t('Events')}
        </span>
      </div>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : view === 'list' ? (
        <div className="card cal-list">
          {!data.length && <p className="muted small" style={{ margin: 0 }}>{t('Nothing on the calendar in these weeks.')}</p>}
          {days.filter((d) => byDay.has(d)).map((d) => (
            <div key={d} className={`cal-list-day${d === today() ? ' today' : ''}`}>
              <div className="cal-list-date">{fmtDate(d, lang)}</div>
              <div className="stack tight">
                {byDay.get(d)!.map((it) => (
                  <button key={`${it.type}-${it.id}`} type="button" className={`cal-row ${it.type}`} onClick={() => open(it)} style={it.color ? { ['--gc' as string]: it.color } : undefined}>
                    <span className="cal-time">{it.start_time ?? ''}{it.end_time ? `–${it.end_time}` : ''}</span>
                    <span><strong><Bi v={it.title} /></strong>{it.group_name && <span className="small muted"> · <Bi v={it.group_name} /></span>}{it.space && <span className="small muted"> · <Bi v={it.space} /></span>}{it.place && <span className="small muted"> · {it.place}</span>}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`cal-grid ${view}`}>
          {weekdays.map((w) => <div key={w} className="cal-wd">{w}</div>)}
          {days.map((d) => (
            <div key={d} className={`cal-day${d === today() ? ' today' : ''}${view === 'month' && d.slice(0, 7) !== anchor.slice(0, 7) ? ' other' : ''}`}>
              <div className="cal-num">{Number(d.slice(8))}</div>
              {(byDay.get(d) ?? []).map((it) => chip(it, d))}
            </div>
          ))}
        </div>
      )}
      {editing != null && <EventDialog id={editing === 'new' ? null : editing} initialDate={anchor} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

interface EventRow { title: L10n; date: string; end_date: string | null; start_time: string | null; end_time: string | null; place: string | null; space_id?: number | null; description: string | null; congregation_id: number | null; group_id: number | null }

/** Add or change one of the church's events (editors; others see it read-only). */
function EventDialog({ id, initialDate, onClose, onSaved }: { id: number | null; initialDate: string; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { canEdit } = useSession();
  const { run, busy } = useAction();
  const existing = useApi<EventRow>(id ? `/events/${id}` : null);
  const groups = useApi<GroupRow[]>('/groups');
  const [d, setD] = useState<EventRow | null>(id ? null : { title: {}, date: initialDate, end_date: null, start_time: null, end_time: null, place: null, space_id: null, description: null, congregation_id: null, group_id: null });
  const e = d ?? existing.data ?? null;
  const set = (p: Partial<EventRow>) => setD({ ...(e as EventRow), ...p });
  const save = () => run(async () => {
    const body = { ...e, place: e?.place?.trim() || null, description: e?.description?.trim() || null };
    if (id) await api.patch(`/events/${id}`, body);
    else await api.post('/events', body);
    onSaved();
    onClose();
  }, t('Saved.'));
  const remove = async () => {
    if (!id || !await confirmAction(t('Delete this event?'), { danger: true, ok: t('Delete') })) return;
    run(async () => {
      await api.del(`/events/${id}`);
      onSaved();
      onClose();
    }, t('Deleted.'));
  };
  return (
    <Modal title={id ? t('Event') : t('New event')} onClose={onClose} footer={
      <>
        {canEdit && id && <button className="btn danger" onClick={remove} disabled={busy} style={{ marginRight: 'auto' }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{canEdit ? t('Cancel') : t('Close')}</button>
        {canEdit && <button className="btn primary" onClick={save} disabled={busy || !e}>{t('Save')}</button>}
      </>
    }>
      {!e ? <Loading /> : (
        <fieldset disabled={!canEdit} className="bare stack">
          <Field label={t('Title')}><L10nInput value={e.title} onChange={(v: L10n) => set({ title: v })} placeholder={{ en: 'Church camp', zh: '教会营会' }} /></Field>
          <div className="form-grid">
            <Field label={t('Date')}><input type="date" value={e.date} onChange={(x) => set({ date: x.target.value })} /></Field>
            <Field label={t('Until')} hint={t('for an event over several days')}><input type="date" value={e.end_date ?? ''} min={e.date} onChange={(x) => set({ end_date: x.target.value || null })} /></Field>
            <Field label={t('Start time')}><input type="time" value={e.start_time ?? ''} onChange={(x) => set({ start_time: x.target.value || null })} /></Field>
            <Field label={t('End time')}><input type="time" value={e.end_time ?? ''} onChange={(x) => set({ end_time: x.target.value || null })} /></Field>
            <SpaceField value={e.space_id} onChange={(v) => set({ space_id: v })} />
            <Field label={t('Place')}><input value={e.place ?? ''} onChange={(x) => set({ place: x.target.value })} /></Field>
            <CongregationField value={e.congregation_id} onChange={(v) => set({ congregation_id: v })} />
            <Field label={t('Group')}>
              <select value={e.group_id ?? ''} onChange={(x) => set({ group_id: Number(x.target.value) || null })}>
                <option value="">—</option>
                {meetingGroups(groups.data).map((g) => <option key={g.id} value={g.id}>{lt(g.name)}</option>)}
              </select>
            </Field>
          </div>
          {id && existing.data?.space_id && <SpaceClashes type="event" id={id} version={JSON.stringify(existing.data)} />}
          <Field label={t('Description')}><textarea rows={3} value={e.description ?? ''} onChange={(x) => set({ description: x.target.value })} /></Field>
        </fieldset>
      )}
    </Modal>
  );
}
