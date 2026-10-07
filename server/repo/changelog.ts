// The change log: every create / update / delete made by a person (web app), an AI agent (MCP) or a CSV import,
// with who, when, how and what changed (old → new per field). Administrators read it in Settings → Change log and
// on a record's History. Start-up seeding and migrations are not logged. Long values are shortened; passwords and
// other secrets are never stored.
import { all, get, run, type SqlValue } from '../db.ts';
import { currentActor, type Via } from '../lib/actor.ts';

/** Escape a search term for LIKE … ESCAPE '\' (as lib/table.ts does; not imported: table.ts imports this file). */
const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** What each table's records are called in the log. */
export const ENTITY_LABEL: Record<string, { en: string; zh: string }> = {
  spaces: { en: 'Space', zh: '场地' },
  people: { en: 'Member', zh: '会友' },
  households: { en: 'Household', zh: '家庭' },
  coworkers: { en: 'Co-worker', zh: '同工' },
  groups: { en: 'Group', zh: '小组' },
  group_members: { en: 'Group member', zh: '小组成员' },
  teams: { en: 'Team', zh: '事奉团队' },
  team_members: { en: 'Team member', zh: '团队成员' },
  roles: { en: 'Role', zh: '岗位' },
  role_members: { en: 'Role qualification', zh: '岗位资格' },
  assignments: { en: 'Rota assignment', zh: '事奉安排' },
  unavailability: { en: 'Away dates', zh: '请假日期' },
  services: { en: 'Service', zh: '聚会' },
  service_items: { en: 'Service item', zh: '聚会项目' },
  templates: { en: 'Service template', zh: '聚会模板' },
  songs: { en: 'Song', zh: '诗歌' },
  texts: { en: 'Liturgical text', zh: '礼文' },
  hymnals: { en: 'Hymnal', zh: '诗本' },
  bulletin_blocks: { en: 'QR code / note', zh: '二维码与短句' },
  slide_themes: { en: 'Slide template', zh: '投影模板' },
  bulletin_templates: { en: 'Bulletin template', zh: '次序单模板' },
  users: { en: 'User account', zh: '用户帐户' },
  settings: { en: 'Settings', zh: '设置' },
  bibles: { en: 'Bible version', zh: '圣经译本' },
  backups: { en: 'Backup', zh: '备份' },
  congregations: { en: 'Congregation', zh: '会众' },
  service_records: { en: 'Service record', zh: '聚会记录' },
  events: { en: 'Calendar event', zh: '日历活动' },
  access_roles: { en: 'Role', zh: '角色' },
  backgrounds: { en: 'Slide background', zh: '投影背景' },
  lending_books: { en: 'Library book', zh: '图书馆书目' },
  lending_copies: { en: 'Library copy', zh: '图书副本' },
  lending_loans: { en: 'Library loan', zh: '借阅' },
  equipment: { en: 'Asset', zh: '资产' },
  equipment_maintenance: { en: 'Maintenance', zh: '维修保养' },
  equipment_files: { en: 'Asset photo or receipt', zh: '资产照片或收据' },
  bk_accounts: { en: 'Account', zh: '会计科目' },
  bk_funds: { en: 'Fund', zh: '款项' },
  bk_projects: { en: 'Project', zh: '项目' },
  bk_ministries: { en: 'Ministry', zh: '事工' },
  bk_journals: { en: 'Journal', zh: '分录' },
  bk_statements: { en: 'Bank statement', zh: '银行对账单' },
};

/** Columns never written to the log. */
const SKIP = new Set(['updated_at', 'created_at', 'password_hash', 'share_token', 'position', 'sort', 'revision']);
const MAX_VALUE = 400;

type Row = Record<string, unknown>;

const short = (v: unknown): unknown => {
  if (v === undefined) return null;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s == null) return null;
  if (s.length <= MAX_VALUE) return typeof v === 'string' ? v : v;
  return `${s.slice(0, MAX_VALUE)}… (${s.length} characters)`;
};

/** A readable name for a record: a person's name, an L10n title / name in English and Chinese, else "#id". */
export function recordName(row: Row | null | undefined, id?: number | null): string {
  if (!row) return id != null ? `#${id}` : '';
  const l10n = (v: unknown) => {
    const o = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
    if (o && typeof o === 'object') {
      const x = o as Record<string, string>;
      return [x.en, x.zh ?? x['zh-Hant']].filter(Boolean).join(' ') || Object.values(x).find(Boolean) || '';
    }
    return typeof v === 'string' ? v : '';
  };
  if (row.first_name || row.last_name) return [row.first_name, row.last_name].filter(Boolean).join(' ') + (row.native_name ? ` ${row.native_name}` : '');
  for (const k of ['title', 'name', 'display_name', 'username', 'date', 'position']) {
    if (row[k]) {
      const n = l10n(row[k]);
      if (n) return k === 'date' && row.title ? `${row.date} ${l10n(row.title)}` : n;
    }
  }
  return `#${row.id ?? id ?? ''}`;
}

/**
 * Fields kept in full (not shortened) because they are financial records; signatures are kept without their images.
 */
const FULL: Record<string, Set<string>> = {
  service_records: new Set(['offerings', 'cash', 'foreign_cash', 'currency', 'counters', 'verified_at', 'verified_by', 'signatures']),
  bk_journals: new Set(['lines', 'memo']),
};
const fullValue = (k: string, v: unknown): unknown => {
  if (k !== 'signatures') return v ?? null;
  const list = typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return []; } })() : v;
  return Array.isArray(list) ? list.map((s: Record<string, unknown>) => ({ name: s.name, signed_at: s.signed_at, by: s.by, hash: s.hash })) : null;
};

/** Field-by-field differences between two versions of a record. */
export function diff(before: Row | null, after: Row | null, entity?: string): Record<string, [unknown, unknown]> {
  const full = entity ? FULL[entity] : undefined;
  const out: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const k of keys) {
    if (SKIP.has(k) || k === 'id') continue;
    const a = before?.[k] ?? null;
    const b = after?.[k] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    out[k] = full?.has(k) ? [fullValue(k, a), fullValue(k, b)] : [short(a), short(b)];
  }
  return out;
}

export interface ChangeInput {
  entity: string;
  entity_id: number | null;
  action: 'create' | 'update' | 'delete';
  before?: Row | null;
  after?: Row | null;
  /** a sentence instead of / besides the field changes, e.g. "Restored backup canon-…db" */
  summary?: string;
  /** a related record shown with it, e.g. the service an item belongs to */
  parent?: { entity: string; id: number } | null;
}

/** Record one change by the current actor. Outside a request (start-up, seeding) nothing is logged. */
export function logChange(c: ChangeInput): void {
  const actor = currentActor();
  if (!actor) return;
  const changes = c.action === 'update' ? diff(c.before ?? null, c.after ?? null, c.entity) : c.action === 'create' ? diff(null, c.after ?? null, c.entity) : diff(c.before ?? null, null, c.entity);
  if (c.action === 'update' && !Object.keys(changes).length && !c.summary) return;
  run(
    `INSERT INTO change_log (user_id, user_name, via, client, entity, entity_id, action, name, summary, changes, parent_entity, parent_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    actor.user_id, actor.user_name, actor.via, actor.client ?? null, c.entity, c.entity_id, c.action,
    recordName(c.after ?? c.before, c.entity_id).slice(0, 200), c.summary ?? null, JSON.stringify(changes),
    c.parent?.entity ?? null, c.parent?.id ?? null,
  );
}

export interface LogQuery {
  /** every matching row (CSV export), not one page */
  all?: boolean;
  entity?: string;
  entity_id?: number;
  user_id?: number;
  via?: Via;
  action?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  q?: string;
  page?: number;
  size?: number;
}

export interface ChangeRow {
  id: number;
  at: string;
  user_id: number | null;
  user_name: string | null;
  via: Via;
  client: string | null;
  entity: string;
  entity_id: number | null;
  action: string;
  name: string;
  summary: string | null;
  changes: Record<string, [unknown, unknown]>;
  parent_entity: string | null;
  parent_id: number | null;
}

/** Shared paging: page from 1, size 10–200 (default 50). */
/** Up to this many rows go into a CSV export. */
export const EXPORT_MAX = 20000;
export const paging = (q: { page?: number; size?: number; all?: boolean }) => {
  if (q.all) return { size: EXPORT_MAX, page: 1, offset: 0 };
  const size = Math.min(200, Math.max(10, Math.floor(q.size ?? 50)));
  const page = Math.max(1, Math.floor(q.page ?? 1));
  return { size, page, offset: (page - 1) * size };
};

/** Date range filter on a timestamp column ("YYYY-MM-DD" inclusive, in UTC storage). */
export function dateRange(col: string, from?: string, to?: string): { where: string[]; params: SqlValue[] } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push(`${col} >= ?`);
    params.push(`${from} 00:00:00`);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push(`${col} < date(?, '+1 day')`);
    params.push(to);
  }
  return { where, params };
}

export function listChanges(q: LogQuery): { rows: ChangeRow[]; total: number; page: number; size: number } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.entity) {
    // a record's history includes changes to its parts (e.g. a service's items)
    if (q.entity_id) {
      where.push('((entity = ? AND entity_id = ?) OR (parent_entity = ? AND parent_id = ?))');
      params.push(q.entity, q.entity_id, q.entity, q.entity_id);
    } else {
      where.push('entity = ?');
      params.push(q.entity);
    }
  }
  if (q.user_id) {
    where.push('user_id = ?');
    params.push(q.user_id);
  }
  if (q.via) {
    where.push('via = ?');
    params.push(q.via);
  }
  if (q.action) {
    where.push('action = ?');
    params.push(q.action);
  }
  const d = dateRange('at', q.from, q.to);
  where.push(...d.where);
  params.push(...d.params);
  if (q.q?.trim()) {
    where.push("(name LIKE ? ESCAPE '\\' OR summary LIKE ? ESCAPE '\\' OR changes LIKE ? ESCAPE '\\')");
    const t = likeTerm(q.q.trim());
    params.push(t, t, t);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { size, page, offset } = paging(q);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM change_log ${w}`, ...params)?.n ?? 0;
  const rows = all<Omit<ChangeRow, 'changes'> & { changes: string }>(`SELECT * FROM change_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, size, offset)
    .map((r) => ({ ...r, changes: JSON.parse(r.changes || '{}') as ChangeRow['changes'] }));
  return { rows, total, page, size };
}

// ---------------------------------------------------------------- AI activity log (mcp_audit), same filters and paging

export interface AuditQuery {
  /** every matching row (CSV export), not one page */
  all?: boolean;
  user_id?: number;
  client?: string;
  tool?: string;
  module?: string;
  ok?: boolean;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  size?: number;
}

export function listAudit(q: AuditQuery) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.user_id) {
    where.push('a.user_id = ?');
    params.push(q.user_id);
  }
  if (q.client) {
    where.push('a.client_id = ?');
    params.push(q.client);
  }
  if (q.tool) {
    where.push('a.tool = ?');
    params.push(q.tool);
  }
  if (q.module) {
    where.push('a.module = ?');
    params.push(q.module);
  }
  if (q.ok !== undefined) {
    where.push('a.ok = ?');
    params.push(q.ok ? 1 : 0);
  }
  const d = dateRange('a.at', q.from, q.to);
  where.push(...d.where);
  params.push(...d.params);
  if (q.q?.trim()) {
    where.push("(a.args LIKE ? ESCAPE '\\' OR a.error LIKE ? ESCAPE '\\')");
    const t = likeTerm(q.q.trim());
    params.push(t, t);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { size, page, offset } = paging(q);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM mcp_audit a ${w}`, ...params)?.n ?? 0;
  const rows = all(
    `SELECT a.*, u.display_name AS user_name, c.client_name FROM mcp_audit a
     LEFT JOIN users u ON u.id = a.user_id LEFT JOIN oauth_clients c ON c.client_id = a.client_id
     ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params, size, offset,
  );
  // choices for the filter menus
  const facets = {
    users: all<{ id: number; name: string }>('SELECT DISTINCT a.user_id AS id, COALESCE(u.display_name, a.user_id) AS name FROM mcp_audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.user_id IS NOT NULL ORDER BY name'),
    clients: all<{ id: string; name: string }>('SELECT DISTINCT a.client_id AS id, COALESCE(c.client_name, a.client_id) AS name FROM mcp_audit a LEFT JOIN oauth_clients c ON c.client_id = a.client_id ORDER BY name'),
    tools: all<{ tool: string }>('SELECT DISTINCT tool FROM mcp_audit ORDER BY tool').map((r) => r.tool),
  };
  return { rows, total, page, size, facets };
}

export function pruneAudit(months: number): number {
  if (!months) return 0;
  return Number(run(`DELETE FROM mcp_audit WHERE at < datetime('now', ?)`, `-${months} months`).changes);
}

/** Who appears in the change log (for the filter menu). */
export const changeLogUsers = () =>
  all<{ id: number | null; name: string }>('SELECT DISTINCT user_id AS id, COALESCE(user_name, user_id) AS name FROM change_log ORDER BY name');

/** Delete log entries older than `months` (0 = keep everything). Returns how many were removed. */
export function pruneChanges(months: number): number {
  if (!months) return 0;
  return Number(run(`DELETE FROM change_log WHERE at < datetime('now', ?)`, `-${months} months`).changes);
}
