import { db, tx, type SqlValue } from '../db.ts';
import { currentActor } from './actor.ts';
import { logChange } from '../repo/changelog.ts';
import { checkMove, checkRef, checkRow, type WallEntity } from './walls.ts';

export class NotFound extends Error {
  status = 404;
}
export class BadRequest extends Error {
  status = 400;
}
export class Forbidden extends Error {
  status = 403;
}
export class Conflict extends Error {
  status = 409;
}

interface Spec {
  name: string;
  /** writable columns (id excluded) */
  cols: string[];
  json?: string[];
  bool?: string[];
  touch?: boolean; // maintain updated_at
  revision?: boolean; // count saves in `revision` (edit conflicts: see lib/versions.ts)
  /** change log: false = not logged; parent = the record this one belongs to (shown in that record's history) */
  log?: false | { parent?: (row: Record<string, unknown>) => { entity: string; id: number } | null };
  /**
   * Who may use a row (lib/walls.ts), checked on every read and change whatever the channel (web, AI agents,
   * imports): `own` = the row has its own congregation_id (and kind); `refs` = columns naming rows that must be usable
   * too (a group member's person, a service item's service).
   */
  guard?: { own?: WallEntity; refs?: Record<string, WallEntity> };
}

/** Thin typed CRUD wrapper over one table with JSON / boolean column (de)serialisation. */
export function table<T extends { id: number }>(spec: Spec) {
  const json = new Set(spec.json ?? []);
  const bool = new Set(spec.bool ?? []);

  const decode = (row: Record<string, unknown> | undefined): T | undefined => {
    if (!row) return undefined;
    const out: Record<string, unknown> = { ...row };
    for (const k of json) if (typeof out[k] === 'string') out[k] = JSON.parse(out[k] as string);
    for (const k of bool) if (k in out) out[k] = !!out[k];
    return out as T;
  };

  const logged = () => spec.log !== false && !!currentActor();
  const guard = spec.guard;
  /** Throws when the current request may not use this row (another congregation's; refused by the request's gate). */
  const checkGuard = (row: Record<string, unknown>, mode: 'read' | 'write') => {
    if (!guard || !currentActor()) return;
    if (guard.own) checkRow(guard.own, row as { congregation_id?: number | null; kind?: string | null }, mode, row.id as number);
    for (const [col, entity] of Object.entries(guard.refs ?? {})) if (row[col] != null) checkRef(entity, Number(row[col]), mode);
  };
  const raw = (id: number) => decode(db.prepare(`SELECT * FROM ${spec.name} WHERE id = ?`).get(id) as Record<string, unknown>);
  const parentOf = (row: T | undefined) => (row && spec.log ? spec.log.parent?.(row as Record<string, unknown>) ?? null : null);

  const encode = (data: Record<string, unknown>) => {
    const out: Record<string, SqlValue> = {};
    for (const k of spec.cols) {
      if (!(k in data) || data[k] === undefined) continue;
      const v = data[k];
      if (json.has(k)) out[k] = v === null ? null : JSON.stringify(v);
      else if (bool.has(k)) out[k] = v ? 1 : 0;
      else if (v === '' && k !== 'last_name') out[k] = null;
      else out[k] = v as SqlValue;
    }
    return out;
  };

  return {
    decode,
    list(where = '', params: SqlValue[] = [], order = 'id'): T[] {
      const sql = `SELECT * FROM ${spec.name} ${where ? 'WHERE ' + where : ''} ORDER BY ${order}`;
      return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => decode(r)!);
    },
    get(id: number): T {
      const r = raw(id);
      if (!r) throw new NotFound(`${spec.name} ${id} not found`);
      checkGuard(r as Record<string, unknown>, 'read');
      return r;
    },
    /** undefined when there is no such row or the current request may not see it */
    find(id: number): T | undefined {
      const r = raw(id);
      if (!r || !guard || !currentActor()) return r;
      try {
        checkGuard(r as Record<string, unknown>, 'read');
        return r;
      } catch (e) {
        if ((e as { status?: number }).status === 404) return undefined;
        throw e;
      }
    },
    insert(data: Record<string, unknown>): T {
      // the change and its log entry are written together, or neither is
      return logged() ? tx(() => this.insertNow(data)) : this.insertNow(data);
    },
    insertNow(data: Record<string, unknown>): T {
      const e = encode(data);
      if (guard && currentActor()) {
        // behind a wall, new rows are the congregation's own (or the whole church's)
        if (guard.own && e.congregation_id != null) checkMove(currentActor()!.congregation_id ?? null, e.congregation_id as number);
        checkGuard({ ...e, congregation_id: e.congregation_id ?? null }, 'write');
      }
      // the first save is revision 1, so a screen that saw no record (0) notices one made meanwhile
      if (spec.revision) e.revision = 1;
      const keys = Object.keys(e);
      const sql = keys.length
        ? `INSERT INTO ${spec.name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
        : `INSERT INTO ${spec.name} DEFAULT VALUES`;
      const r = db.prepare(sql).run(...keys.map((k) => e[k]));
      const row = this.get(Number(r.lastInsertRowid));
      if (logged()) logChange({ entity: spec.name, entity_id: row.id, action: 'create', after: row as Record<string, unknown>, parent: parentOf(row) });
      return row;
    },
    update(id: number, patch: Record<string, unknown>): T {
      return logged() ? tx(() => this.updateNow(id, patch)) : this.updateNow(id, patch);
    },
    updateNow(id: number, patch: Record<string, unknown>): T {
      const e = encode(patch);
      if (guard && currentActor()) {
        // the row as it is, then what the change names (another person, a move to another congregation)
        const cur = raw(id) as Record<string, unknown> | undefined;
        if (!cur) throw new NotFound(`${spec.name} ${id} not found`);
        checkGuard(cur, 'write');
        if (guard.own && 'congregation_id' in e) checkMove((cur.congregation_id as number | null) ?? null, (e.congregation_id as number | null) ?? null);
        for (const [col, entity] of Object.entries(guard.refs ?? {})) if (col in e && e[col] != null && e[col] !== cur[col]) checkRef(entity, Number(e[col]), 'write');
      }
      const keys = Object.keys(e);
      const before = keys.length && logged() ? this.find(id) : undefined;
      if (keys.length) {
        const sets = keys.map((k) => `${k} = ?`);
        if (spec.touch) sets.push(`updated_at = datetime('now')`);
        if (spec.revision) sets.push('revision = revision + 1');
        const r = db.prepare(`UPDATE ${spec.name} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map((k) => e[k]), id);
        if (!r.changes) throw new NotFound(`${spec.name} ${id} not found`);
      }
      const after = this.get(id);
      if (before) logChange({ entity: spec.name, entity_id: id, action: 'update', before: before as Record<string, unknown>, after: after as Record<string, unknown>, parent: parentOf(after) });
      return after;
    },
    remove(id: number): void {
      if (logged()) tx(() => this.removeNow(id));
      else this.removeNow(id);
    },
    removeNow(id: number): void {
      if (guard && currentActor()) {
        const cur = raw(id);
        if (cur) checkGuard(cur as Record<string, unknown>, 'write');
      }
      const before = logged() ? this.find(id) : undefined;
      const r = db.prepare(`DELETE FROM ${spec.name} WHERE id = ?`).run(id);
      if (!r.changes) throw new NotFound(`${spec.name} ${id} not found`);
      if (before) logChange({ entity: spec.name, entity_id: id, action: 'delete', before: before as Record<string, unknown>, parent: parentOf(before) });
    },
  };
}

/** Escape a user search term for LIKE ... ESCAPE '\'. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
