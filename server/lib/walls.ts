// Congregation walls (0.13): an account can be limited to one congregation (Settings → User accounts). It then sees
// that congregation's services, meetings, records, members, groups and events, and the whole church's (those with no
// congregation), but nothing of other congregations. Administrators are never walled.
//
// Lists read the wall from the request's actor (lib/actor.ts), so the web app and AI agents follow it alike; a
// request for one item names it in its path, which the sign-in gate checks here (outsideWall).
import { currentActor } from './actor.ts';
import { all, get, type SqlValue } from '../db.ts';

/** Tables whose rows belong to a congregation (null = the whole church); households belong to their members'. */
export type WallEntity = 'people' | 'services' | 'groups' | 'events' | 'households';
const ROW_SQL: Record<WallEntity, string> = {
  people: 'SELECT congregation_id, NULL AS kind FROM people WHERE id = ?',
  services: 'SELECT congregation_id, kind FROM services WHERE id = ?',
  groups: 'SELECT congregation_id, NULL AS kind FROM groups WHERE id = ?',
  events: 'SELECT congregation_id, NULL AS kind FROM events WHERE id = ?',
  households: 'SELECT NULL AS congregation_id, NULL AS kind FROM households WHERE id = ?',
};
const LABEL: Record<WallEntity, string> = { people: 'person', services: 'service', groups: 'group', events: 'event', households: 'household' };

class Hidden extends Error {
  status = 404;
}
class Refused extends Error {
  status = 403;
}

/** The congregation (and, for services, the kind) of one row, or undefined when there is no such row. */
export const rowInfo = (entity: WallEntity, id: number) => get<{ congregation_id: number | null; kind: string | null }>(ROW_SQL[entity], id);

/**
 * Refuse a row the current request may not use: another congregation's (404, as if it did not exist), or one the
 * request's gate refuses (MCP: meetings). Rows of the whole church pass the wall.
 */
export function checkRow(entity: WallEntity, row: { congregation_id?: number | null; kind?: string | null }, mode: 'read' | 'write', id?: number) {
  const actor = currentActor();
  if (!actor) return;
  if (entity === 'households') {
    // a household belongs to the congregations of its members: hidden behind a wall when it has members and none of
    // them is the congregation's or the whole church's (an empty one, e.g. just created, is not hidden)
    if (actor.congregation_id && id != null) {
      const cs = all<{ c: number | null }>('SELECT congregation_id AS c FROM people WHERE household_id = ?', id).map((r) => r.c);
      if (cs.length && !cs.some((c) => c == null || c === actor.congregation_id)) throw new Hidden(`household ${id} not found`);
    }
    return;
  }
  if (outside(row.congregation_id ?? null, actor.congregation_id ?? null)) throw new Hidden(`${LABEL[entity]}${id ? ` ${id}` : ''} not found`);
  actor.gate?.(entity, { id, congregation_id: row.congregation_id ?? null, kind: row.kind ?? null }, mode);
}

/** A row named by id (a related record: a group's new member, a rota entry's person): must exist and be usable. */
export function checkRef(entity: WallEntity, id: number, mode: 'read' | 'write' = 'read') {
  if (!currentActor()) return;
  const r = rowInfo(entity, id);
  if (!r) throw new Hidden(`${LABEL[entity]} ${id} not found`);
  checkRow(entity, r, mode, id);
}

/** People this request may see (all of them without a wall), for lists built with plain SQL: CSV, reports. */
export function visiblePeople<T = Record<string, unknown>>(columns = '*'): T[] {
  const w = wallSql('congregation_id');
  return all<T>(`SELECT ${columns} FROM people WHERE 1${w.sql}`, ...w.params);
}
/** The ids of those people, or null when there is no wall (everyone). */
export function visiblePeopleIds(): Set<number> | null {
  return currentWall() ? new Set(visiblePeople<{ id: number }>('id').map((p) => p.id)) : null;
}
/** May this request see a row of this congregation (null = the whole church)? */
export const inSight = (congregationId: number | null | undefined) => !outside(congregationId ?? null);
/** The current request may see and change member fields marked sensitive. */
export const seesSensitive = () => currentActor()?.sensitive !== false;

/** Moving a row to another congregation is for accounts of the whole church. */
export function checkMove(from: number | null, to: number | null) {
  const wall = currentWall();
  if (wall && (from ?? null) !== (to ?? null)) throw new Refused('Only an account for the whole church can move this to another congregation.');
}

/** The congregation the current request is limited to, or null. */
export const currentWall = (): number | null => currentActor()?.congregation_id ?? null;

/** `AND (col = ? OR col IS NULL)` for the current wall, or nothing. */
export function wallSql(col: string, wall = currentWall()): { sql: string; params: SqlValue[] } {
  return wall ? { sql: ` AND (${col} = ? OR ${col} IS NULL)`, params: [wall] } : { sql: '', params: [] };
}

/** Whether a row's congregation is outside the wall (rows of the whole church never are). */
export const outside = (rowCongregation: number | null | undefined, wall = currentWall()) => !!wall && rowCongregation != null && rowCongregation !== wall;

/** A new item made behind a wall belongs to that congregation (unless it is for the whole church). */
export const inWall = <T extends { congregation_id?: number | null }>(input: T, wall = currentWall()): T =>
  (wall && input.congregation_id !== null ? { ...input, congregation_id: wall } : input);

const PATHS: [RegExp, string][] = [
  [/^\/services\/(\d+)/, 'SELECT congregation_id AS c FROM services WHERE id = ?'],
  [/^\/items\/(\d+)/, 'SELECT s.congregation_id AS c FROM service_items i JOIN services s ON s.id = i.service_id WHERE i.id = ?'],
  [/^\/people\/(\d+)/, 'SELECT congregation_id AS c FROM people WHERE id = ?'],
  [/^\/groups\/(\d+)/, 'SELECT congregation_id AS c FROM groups WHERE id = ?'],
  [/^\/group-members\/(\d+)/, 'SELECT g.congregation_id AS c FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.id = ?'],
  [/^\/events\/(\d+)/, 'SELECT congregation_id AS c FROM events WHERE id = ?'],
  [/^\/visitor-cards\/(\d+)/, 'SELECT s.congregation_id AS c FROM visitor_cards v JOIN services s ON s.id = v.service_id WHERE v.id = ?'],
  [/^\/assignments\/(\d+)/, 'SELECT s.congregation_id AS c FROM assignments a JOIN services s ON s.id = a.service_id WHERE a.id = ?'],
];

/** Does this request name an item of another congregation? */
export function outsideWall(wall: number | null, path: string): boolean {
  if (!wall) return false;
  for (const [re, sql] of PATHS) {
    const m = re.exec(path);
    if (m) return outside(get<{ c: number | null }>(sql, Number(m[1]))?.c, wall);
  }
  return false;
}
