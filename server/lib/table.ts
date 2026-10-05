import { db, tx, type SqlValue } from '../db.ts';
import { currentActor } from './actor.ts';
import { logChange } from '../repo/changelog.ts';

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
      const r = decode(db.prepare(`SELECT * FROM ${spec.name} WHERE id = ?`).get(id) as Record<string, unknown>);
      if (!r) throw new NotFound(`${spec.name} ${id} not found`);
      return r;
    },
    find(id: number): T | undefined {
      return decode(db.prepare(`SELECT * FROM ${spec.name} WHERE id = ?`).get(id) as Record<string, unknown>);
    },
    insert(data: Record<string, unknown>): T {
      // the change and its log entry are written together, or neither is
      return logged() ? tx(() => this.insertNow(data)) : this.insertNow(data);
    },
    insertNow(data: Record<string, unknown>): T {
      const e = encode(data);
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
      const before = logged() ? this.find(id) : undefined;
      const r = db.prepare(`DELETE FROM ${spec.name} WHERE id = ?`).run(id);
      if (!r.changes) throw new NotFound(`${spec.name} ${id} not found`);
      if (before) logChange({ entity: spec.name, entity_id: id, action: 'delete', before: before as Record<string, unknown>, parent: parentOf(before) });
    },
  };
}

/** Escape a user search term for LIKE ... ESCAPE '\'. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
