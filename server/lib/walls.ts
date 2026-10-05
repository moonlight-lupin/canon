// Congregation walls (0.13): an account can be limited to one congregation (Settings → Users & access). It then sees
// that congregation's services, meetings, records, members, groups and events, and the whole church's (those with no
// congregation), but nothing of other congregations. Administrators are never walled.
//
// Lists read the wall from the request's actor (lib/actor.ts), so the web app and AI agents follow it alike; a
// request for one item names it in its path, which the sign-in gate checks here (outsideWall).
import { currentActor } from './actor.ts';
import { get, type SqlValue } from '../db.ts';

/** Tables whose rows belong to a congregation (null = the whole church). */
export type WallEntity = 'people' | 'services' | 'groups' | 'events';
const ROW_SQL: Record<WallEntity, string> = {
  people: 'SELECT congregation_id, NULL AS kind FROM people WHERE id = ?',
  services: 'SELECT congregation_id, kind FROM services WHERE id = ?',
  groups: 'SELECT congregation_id, NULL AS kind FROM groups WHERE id = ?',
  events: 'SELECT congregation_id, NULL AS kind FROM events WHERE id = ?',
};
const LABEL: Record<WallEntity, string> = { people: 'person', services: 'service', groups: 'group', events: 'event' };

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
