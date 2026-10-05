// Member register (people, households) and co-worker register.
import type { Coworker, Household, Person } from '../../shared/types.ts';
import { all, type SqlValue } from '../db.ts';
import { table, likeTerm } from '../lib/table.ts';

export const people = table<Person>({
  name: 'people',
  cols: [
    'first_name', 'last_name', 'native_name', 'preferred_name', 'gender', 'birth_date', 'phone', 'email', 'address',
    'household_id', 'household_role', 'status', 'membership_date', 'baptism_date', 'baptism_type', 'profession_date',
    'preferred_lang', 'honorific', 'notes', 'congregation_id',
  ],
  json: ['honorific'],
  touch: true,
});

export const households = table<Household>({ name: 'households', cols: ['name', 'address', 'phone', 'notes'] });

export const coworkers = table<Coworker>({
  name: 'coworkers',
  cols: ['person_id', 'position', 'category', 'employment', 'ministry_area', 'ordained', 'start_date', 'end_date', 'notes'],
  bool: ['ordained'],
});

export const displayName = (p: Pick<Person, 'first_name' | 'last_name' | 'preferred_name' | 'native_name'>) => {
  const latin = `${p.preferred_name || p.first_name} ${p.last_name ?? ''}`.trim();
  return p.native_name ? `${latin} ${p.native_name}` : latin;
};

export interface PeopleQuery {
  /** search names only, not e-mail or phone (read-only accounts) */
  names_only?: boolean;
  q?: string;
  status?: string;
  household_id?: number;
  limit?: number;
  offset?: number;
  congregation_id?: number;
}

export function listPeople(f: PeopleQuery = {}) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (f.q) {
    where.push(
      f.names_only
        ? `(p.first_name || ' ' || p.last_name || ' ' || IFNULL(p.native_name,'') || ' ' || IFNULL(p.preferred_name,'')) LIKE ? ESCAPE '\\'`
        : `(p.first_name || ' ' || p.last_name || ' ' || IFNULL(p.native_name,'') || ' ' || IFNULL(p.preferred_name,'') || ' ' || IFNULL(p.email,'') || ' ' || IFNULL(p.phone,'')) LIKE ? ESCAPE '\\'`,
    );
    params.push(likeTerm(f.q));
  }
  if (f.status) {
    where.push(`p.status IN (${f.status.split(',').map(() => '?').join(',')})`);
    params.push(...f.status.split(','));
  }
  if (f.congregation_id) {
    where.push('p.congregation_id = ?');
    params.push(f.congregation_id);
  }
  if (f.household_id) {
    where.push('p.household_id = ?');
    params.push(f.household_id);
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (all<{ n: number }>(`SELECT COUNT(*) n FROM people p ${w}`, ...params)[0]).n;
  const rows = all<Person & { household_name: string | null }>(
    `SELECT p.*, h.name AS household_name FROM people p LEFT JOIN households h ON h.id = p.household_id ${w}
     ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params, f.limit ?? 500, f.offset ?? 0,
  );
  return { total, rows };
}

export function householdsWithMembers() {
  const hs = households.list('', [], 'name COLLATE NOCASE');
  const members = all<Person>('SELECT * FROM people WHERE household_id IS NOT NULL ORDER BY household_role, birth_date');
  return hs.map((h) => ({ ...h, members: members.filter((m) => m.household_id === h.id) }));
}

/** People with birthdays in the next `days` days (wraps around year end). */
export function upcomingBirthdays(days = 14, from = new Date()) {
  const rows = all<Person>(`SELECT * FROM people WHERE birth_date IS NOT NULL AND status NOT IN ('deceased','transferred')`);
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  return rows
    .map((p) => {
      const [, m, d] = p.birth_date!.split('-').map(Number);
      let next = Date.UTC(from.getFullYear(), m - 1, d);
      if (next < start) next = Date.UTC(from.getFullYear() + 1, m - 1, d);
      return { person: p, in_days: Math.round((next - start) / 86400000), date: new Date(next).toISOString().slice(0, 10) };
    })
    .filter((x) => x.in_days <= days)
    .sort((a, b) => a.in_days - b.in_days);
}

export function memberStats() {
  return all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM people GROUP BY status');
}

export function listCoworkers(opts: { active?: boolean } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const where = opts.active ? `WHERE (c.end_date IS NULL OR c.end_date >= '${today}')` : '';
  return all<Coworker & { person_name: string; phone: string | null; email: string | null }>(
    `SELECT c.*, TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) ||
            CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END AS person_name,
            p.phone, p.email
     FROM coworkers c JOIN people p ON p.id = c.person_id ${where}
     ORDER BY CASE c.category WHEN 'pastor' THEN 1 WHEN 'elder' THEN 2 WHEN 'deacon' THEN 3 WHEN 'ministry_staff' THEN 4
              WHEN 'admin_staff' THEN 5 ELSE 6 END, c.start_date`,
  ).map((c) => ({ ...c, ordained: !!c.ordained }));
}

// CSV import / export of the register lives in server/csv/members.ts (CSV framework).
