// The church calendar (0.12): services, meetings and other church events (a retreat, a wedding, a working bee …) in
// one list for a period, filtered by congregation and group. Events are kept here; services and meetings are read
// from the services table.
import type { L10n } from '../../shared/types.ts';
import { all, type SqlValue } from '../db.ts';
import { BadRequest, table } from '../lib/table.ts';

export interface ChurchEvent {
  id: number;
  title: L10n;
  date: string;
  /** the last day, for an event over several days */
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  place: string | null;
  description: string | null;
  congregation_id: number | null;
  group_id: number | null;
  created_at: string;
  updated_at: string;
}

export const events = table<ChurchEvent>({
  name: 'events',
  cols: ['title', 'date', 'end_date', 'start_time', 'end_time', 'place', 'description', 'congregation_id', 'group_id'],
  json: ['title'],
  touch: true,
});

/** Check an event's dates and times make sense together. */
export function checkEvent(e: Partial<ChurchEvent>) {
  if (e.end_date && e.date && e.end_date < e.date) throw new BadRequest('The event ends before it starts.');
  if (e.end_time && !e.start_time) throw new BadRequest('Give a start time with the end time.');
  if (e.start_time && e.end_time && (!e.end_date || e.end_date === e.date) && e.end_time < e.start_time) throw new BadRequest('The event ends before it starts.');
}

export interface CalendarItem {
  type: 'service' | 'meeting' | 'event';
  id: number;
  date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  title: L10n;
  place: string | null;
  congregation_id: number | null;
  group_id: number | null;
  group_name: L10n | null;
  color: string | null;
}

export interface CalendarQuery {
  from: string;
  to: string;
  congregation_id?: number;
  group_id?: number;
}

/** Everything on the calendar from `from` to `to` (an event over several days shows if it touches the period). */
export function calendarItems(q: CalendarQuery): CalendarItem[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.from) || !/^\d{4}-\d{2}-\d{2}$/.test(q.to)) throw new BadRequest('Choose a period.');
  const filter = (alias: string) => {
    const w: string[] = [];
    const p: SqlValue[] = [];
    // a congregation's calendar shows the whole church's items too
    if (q.congregation_id) {
      w.push(`(${alias}.congregation_id = ? OR ${alias}.congregation_id IS NULL)`);
      p.push(q.congregation_id);
    }
    if (q.group_id) {
      w.push(`${alias}.group_id = ?`);
      p.push(q.group_id);
    }
    return { where: w.length ? ` AND ${w.join(' AND ')}` : '', params: p };
  };
  const s = filter('s');
  const svc = all<Record<string, unknown>>(
    `SELECT s.id, s.kind, s.date, s.start_time, s.title, s.place, s.congregation_id, s.group_id, g.name AS group_name, g.color
     FROM services s LEFT JOIN groups g ON g.id = s.group_id
     WHERE s.date BETWEEN ? AND ?${s.where}`,
    q.from, q.to, ...s.params,
  );
  const e = filter('e');
  const evs = all<Record<string, unknown>>(
    `SELECT e.*, g.name AS group_name, g.color FROM events e LEFT JOIN groups g ON g.id = e.group_id
     WHERE e.date <= ? AND IFNULL(e.end_date, e.date) >= ?${e.where}`,
    q.to, q.from, ...e.params,
  );
  const l10n = (v: unknown) => (v ? JSON.parse(String(v)) as L10n : null);
  const items: CalendarItem[] = [
    ...svc.map((r) => ({
      type: (r.kind === 'meeting' ? 'meeting' : 'service') as CalendarItem['type'], id: r.id as number, date: r.date as string, end_date: null,
      start_time: r.start_time as string, end_time: null, title: l10n(r.title) ?? {}, place: (r.place as string | null) ?? null,
      congregation_id: (r.congregation_id as number | null) ?? null, group_id: (r.group_id as number | null) ?? null,
      group_name: l10n(r.group_name), color: (r.color as string | null) ?? null,
    })),
    ...evs.map((r) => ({
      type: 'event' as const, id: r.id as number, date: r.date as string, end_date: (r.end_date as string | null) ?? null,
      start_time: (r.start_time as string | null) ?? null, end_time: (r.end_time as string | null) ?? null, title: l10n(r.title) ?? {},
      place: (r.place as string | null) ?? null, congregation_id: (r.congregation_id as number | null) ?? null, group_id: (r.group_id as number | null) ?? null,
      group_name: l10n(r.group_name), color: (r.color as string | null) ?? null,
    })),
  ];
  return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.type.localeCompare(b.type));
}
