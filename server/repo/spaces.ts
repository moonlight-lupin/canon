// The church's spaces (0.15.4): halls, rooms and other places in the building. A service, a meeting or a calendar
// event can be in one; two bookings of the same space that overlap are a clash (shown as a warning, never refused —
// two small groups may share a hall on purpose). A service lasts from its start time for the minutes of its order
// of service; a meeting or a service without items for an hour; an event as given (all day without times).
import type { L10n } from '../../shared/types.ts';
import { all, get } from '../db.ts';
import { BadRequest, Conflict, NotFound, table } from '../lib/table.ts';
import { churchToday } from '../lib/dates.ts';

export interface Space {
  id: number;
  name: L10n;
  capacity: number | null;
  notes: string | null;
  archived: boolean;
  sort: number;
  created_at: string;
  updated_at: string;
}

export const spaces = table<Space>({
  name: 'spaces',
  cols: ['name', 'capacity', 'notes', 'archived', 'sort'],
  json: ['name'],
  bool: ['archived'],
  touch: true,
});

const hasText = (l?: L10n) => !!l && Object.values(l).some((v) => v?.trim());

export const listSpaces = () => all<{ id: number }>('SELECT id FROM spaces ORDER BY archived, sort, id').map((r) => spaces.get(r.id));

export interface SpaceInput { name: L10n; capacity?: number | null; notes?: string | null; sort?: number }

export function createSpace(input: SpaceInput): Space {
  if (!hasText(input.name)) throw new BadRequest('Give the space a name.');
  const sort = input.sort ?? (get<{ n: number | null }>('SELECT MAX(sort) AS n FROM spaces')?.n ?? 0) + 1;
  return spaces.insert({ name: input.name, capacity: input.capacity ?? null, notes: input.notes?.trim() || null, archived: false, sort });
}

export function updateSpace(id: number, input: Partial<SpaceInput> & { archived?: boolean }): Space {
  spaces.get(id);
  if (input.name && !hasText(input.name)) throw new BadRequest('Give the space a name.');
  return spaces.update(id, { ...input, ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}) });
}

/** How many services, meetings and events use each space. */
export const spaceUse = (): Record<number, number> => Object.fromEntries(all<{ id: number; n: number }>(
  `SELECT space_id AS id, COUNT(*) AS n FROM (SELECT space_id FROM services WHERE space_id IS NOT NULL UNION ALL SELECT space_id FROM events WHERE space_id IS NOT NULL) GROUP BY space_id`,
).map((r) => [r.id, r.n]));

/** Delete a space nothing was ever booked in; one in use is archived instead (its bookings keep it). */
export function deleteSpace(id: number) {
  const s = spaces.get(id);
  const n = spaceUse()[id] ?? 0;
  if (n) throw new Conflict(`${n} service${n === 1 ? '' : 's'}, meeting${n === 1 ? '' : 's'} or event${n === 1 ? '' : 's'} use this space. Archive it instead.`);
  void s;
  spaces.remove(id);
  return { deleted: true };
}

// ---------------------------------------------------------------- bookings and clashes

export type BookingType = 'service' | 'meeting' | 'event';
export interface Booking {
  type: BookingType;
  id: number;
  space_id: number;
  date: string;
  /** the last day (events over several days) */
  end_date: string;
  /** minutes from midnight; an all-day event runs 0 – 1440 */
  start: number;
  end: number;
  title: L10n;
  start_time: string | null;
  end_time: string | null;
}

const mins = (t: string | null | undefined) => (t && /^\d{2}:\d{2}/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DEFAULT_MIN = 60;

/** Every booking of a space (or of every space) that touches the period. */
export function bookings(from: string, to: string, spaceId?: number): Booking[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new BadRequest('Choose a period.');
  const sp = spaceId ? ' AND s.space_id = ?' : ' AND s.space_id IS NOT NULL';
  const svc = all<{ id: number; kind: string | null; space_id: number; date: string; start_time: string | null; title: string; minutes: number | null }>(
    `SELECT s.id, s.kind, s.space_id, s.date, s.start_time, s.title, (SELECT SUM(duration_min) FROM service_items i WHERE i.service_id = s.id) AS minutes
     FROM services s WHERE s.date BETWEEN ? AND ?${sp}`,
    from, to, ...(spaceId ? [spaceId] : []),
  );
  const ep = spaceId ? ' AND e.space_id = ?' : ' AND e.space_id IS NOT NULL';
  const evs = all<{ id: number; space_id: number; date: string; end_date: string | null; start_time: string | null; end_time: string | null; title: string }>(
    `SELECT e.id, e.space_id, e.date, e.end_date, e.start_time, e.end_time, e.title FROM events e WHERE e.date <= ? AND IFNULL(e.end_date, e.date) >= ?${ep}`,
    to, from, ...(spaceId ? [spaceId] : []),
  );
  const out: Booking[] = svc.map((s) => {
    const start = mins(s.start_time) ?? 0;
    const end = Math.min(24 * 60, start + (s.minutes && s.minutes > 0 ? s.minutes : DEFAULT_MIN));
    return { type: s.kind === 'meeting' ? 'meeting' : 'service', id: s.id, space_id: s.space_id, date: s.date, end_date: s.date, start, end, title: JSON.parse(s.title || '{}'), start_time: hhmm(start), end_time: hhmm(end) };
  });
  for (const e of evs) {
    const start = mins(e.start_time);
    const end = mins(e.end_time);
    const allDay = start == null;
    out.push({
      type: 'event', id: e.id, space_id: e.space_id, date: e.date, end_date: e.end_date ?? e.date,
      start: allDay ? 0 : start, end: allDay ? 24 * 60 : end ?? Math.min(24 * 60, start + DEFAULT_MIN),
      title: JSON.parse(e.title || '{}'), start_time: allDay ? null : e.start_time, end_time: allDay ? null : (end != null ? e.end_time : hhmm(Math.min(24 * 60, start + DEFAULT_MIN))),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/** Do two bookings of the same space overlap? Events over several days use their times on every day they touch. */
function overlaps(a: Booking, b: Booking): boolean {
  if (a.space_id !== b.space_id || (a.type === b.type && a.id === b.id)) return false;
  if (a.end_date < b.date || b.end_date < a.date) return false;
  return a.start < b.end && b.start < a.end;
}

export interface Clash { space_id: number; date: string; a: Booking; b: Booking }

/** Every pair of overlapping bookings in the period. */
export function clashes(from: string, to: string): Clash[] {
  const list = bookings(from, to);
  const out: Clash[] = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      if (overlaps(list[i], list[j])) out.push({ space_id: list[i].space_id, date: list[i].date > list[j].date ? list[i].date : list[j].date, a: list[i], b: list[j] });
    }
  }
  return out;
}

/** What else is booked in the same space at the same time as this service, meeting or event (for the editors). */
export function clashesFor(type: BookingType, id: number): Booking[] {
  const row = type === 'event'
    ? get<{ space_id: number | null; date: string; end_date: string | null }>('SELECT space_id, date, end_date FROM events WHERE id = ?', id)
    : get<{ space_id: number | null; date: string; end_date: null }>('SELECT space_id, date, NULL AS end_date FROM services WHERE id = ?', id);
  if (!row) throw new NotFound('Not found.');
  if (!row.space_id) return [];
  const list = bookings(row.date, row.end_date ?? row.date, row.space_id);
  const me = list.find((b) => (b.type === type || (type !== 'event' && b.type !== 'event')) && b.id === id);
  return me ? list.filter((b) => overlaps(me, b)) : [];
}

/** Spaces report: per space, bookings and hours in the period; the clashes; and what is booked from today on. */
export function spacesReport(from: string, to: string) {
  const list = bookings(from, to);
  const days = (b: Booking) => Math.max(1, Math.round((Date.parse(`${b.end_date < to ? b.end_date : to}T00:00:00Z`) - Date.parse(`${b.date > from ? b.date : from}T00:00:00Z`)) / 86400_000) + 1);
  const rows = listSpaces().map((s) => {
    const mine = list.filter((b) => b.space_id === s.id);
    return {
      id: s.id, name: s.name, capacity: s.capacity, archived: s.archived,
      bookings: mine.length,
      services: mine.filter((b) => b.type === 'service').length,
      meetings: mine.filter((b) => b.type === 'meeting').length,
      events: mine.filter((b) => b.type === 'event').length,
      hours: Math.round(mine.reduce((n, b) => n + (b.end - b.start) * (b.type === 'event' ? days(b) : 1), 0) / 6) / 10,
    };
  }).filter((r) => !r.archived || r.bookings);
  const today = churchToday();
  return {
    from, to,
    spaces: rows,
    clashes: clashes(from, to),
    upcoming: list.filter((b) => b.end_date >= today).slice(0, 200),
  };
}
