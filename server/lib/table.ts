import { db, type SqlValue } from '../db.ts';

export class NotFound extends Error {
  status = 404;
}
export class BadRequest extends Error {
  status = 400;
}

interface Spec {
  name: string;
  /** writable columns (id excluded) */
  cols: string[];
  json?: string[];
  bool?: string[];
  touch?: boolean; // maintain updated_at
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
      const e = encode(data);
      const keys = Object.keys(e);
      const sql = keys.length
        ? `INSERT INTO ${spec.name} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`
        : `INSERT INTO ${spec.name} DEFAULT VALUES`;
      const r = db.prepare(sql).run(...keys.map((k) => e[k]));
      return this.get(Number(r.lastInsertRowid));
    },
    update(id: number, patch: Record<string, unknown>): T {
      const e = encode(patch);
      const keys = Object.keys(e);
      if (keys.length) {
        const sets = keys.map((k) => `${k} = ?`);
        if (spec.touch) sets.push(`updated_at = datetime('now')`);
        const r = db.prepare(`UPDATE ${spec.name} SET ${sets.join(', ')} WHERE id = ?`).run(...keys.map((k) => e[k]), id);
        if (!r.changes) throw new NotFound(`${spec.name} ${id} not found`);
      }
      return this.get(id);
    },
    remove(id: number): void {
      const r = db.prepare(`DELETE FROM ${spec.name} WHERE id = ?`).run(id);
      if (!r.changes) throw new NotFound(`${spec.name} ${id} not found`);
    },
  };
}

/** Escape a user search term for LIKE ... ESCAPE '\'. */
export const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
