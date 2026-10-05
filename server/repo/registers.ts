// Member register (people, households) and co-worker register.
import type { Coworker, Household, Person } from '../../shared/types.ts';
import { all, type SqlValue } from '../db.ts';
import { BadRequest, table, likeTerm } from '../lib/table.ts';
import { cleanCustomValues } from '../../shared/member-fields.ts';
import { getSettings } from './settings.ts';
import { wallSql } from '../lib/walls.ts';

export const people = table<Person>({
  name: 'people',
  cols: [
    'first_name', 'last_name', 'native_name', 'preferred_name', 'gender', 'birth_date', 'phone', 'email', 'address',
    'household_id', 'household_role', 'status', 'membership_date', 'baptism_date', 'baptism_type', 'profession_date',
    'preferred_lang', 'honorific', 'notes', 'congregation_id', 'custom',
  ],
  json: ['honorific', 'custom'],
  touch: true,
  revision: true,
  guard: { own: 'people' },
});

export const households = table<Household>({ name: 'households', cols: ['name', 'address', 'phone', 'notes'] });

export const coworkers = table<Coworker>({
  name: 'coworkers',
  cols: ['person_id', 'position', 'category', 'employment', 'ministry_area', 'ordained', 'start_date', 'end_date', 'notes'],
  bool: ['ordained'],
  guard: { refs: { person_id: 'people' } },
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
  const wall = wallSql('p.congregation_id');
  if (wall.sql) {
    where.push(wall.sql.replace(/^ AND /, ''));
    params.push(...wall.params);
  }
  // members whose personal data was erased are placeholders for history, not members
  where.push('p.erased_at IS NULL');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = (all<{ n: number }>(`SELECT COUNT(*) n FROM people p ${w}`, ...params)[0]).n;
  const rows = all<Person & { household_name: string | null }>(
    `SELECT p.*, h.name AS household_name FROM people p LEFT JOIN households h ON h.id = p.household_id ${w}
     ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ? OFFSET ?`,
    ...params, f.limit ?? 500, f.offset ?? 0,
  ).map(withCustom);
  return { total, rows };
}

/** Rows read with plain SQL carry `custom` as JSON text: decode it like table() does. */
const withCustom = <T extends { custom?: unknown }>(p: T): T => {
  if (typeof p.custom !== 'string') return p;
  try {
    return { ...p, custom: JSON.parse(p.custom) };
  } catch {
    return { ...p, custom: {} };
  }
};

export function householdsWithMembers() {
  const hs = households.list('', [], 'name COLLATE NOCASE');
  const wall = wallSql('congregation_id');
  const members = all<Person>(`SELECT * FROM people WHERE household_id IS NOT NULL${wall.sql} ORDER BY household_role, birth_date`, ...wall.params).map(withCustom);
  // behind a congregation wall: the households with someone in it
  return hs.map((h) => ({ ...h, members: members.filter((m) => m.household_id === h.id) })).filter((h) => !wall.sql || h.members.length);
}

/** People with birthdays in the next `days` days (wraps around year end). */
export function upcomingBirthdays(days = 14, from = new Date()) {
  const wall = wallSql('congregation_id');
  const rows = all<Person>(`SELECT * FROM people WHERE birth_date IS NOT NULL AND status NOT IN ('deceased','transferred')${wall.sql}`, ...wall.params);
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
  return all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM people WHERE erased_at IS NULL GROUP BY status');
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

// ---------------------------------------------------------------- custom member fields

/** A person's custom values for saving: the stored ones with the given ones on top ("" or null clears a field). */
export function customFor(current: Record<string, string> | null | undefined, given: Record<string, string | null> | undefined, sensitiveAllowed = true): Record<string, string> | undefined {
  if (given === undefined) return undefined;
  const defs = getSettings().member_fields ?? [];
  // a role that doesn't see sensitive fields never changes them (its screens don't show them: an empty value there
  // is not a request to clear one)
  if (!sensitiveAllowed) given = Object.fromEntries(Object.entries(given).filter(([k]) => !defs.some((d) => d.key === k && d.sensitive)));
  const merged: Record<string, unknown> = { ...(current ?? {}), ...given };
  const { values, errors } = cleanCustomValues(merged, defs, getSettings().languages[0]);
  if (errors.length) throw new BadRequest(errors.join(' '));
  // values of fields that were removed are kept (they come back if the field is added again)
  const kept = Object.fromEntries(Object.entries(current ?? {}).filter(([k]) => !defs.some((d) => d.key === k)));
  return { ...kept, ...values };
}
