// Roles and permissions on the server (0.13): which role an account has, what it allows, and the gate every signed-in
// request passes (auth.requireUser). The model and the path → module table are in shared/permissions.ts, so the web
// app and AI agents follow the same rules.
import { CSV_MODULE, PERM_MODULES, allows, routeAccess, type Access, type PermModule, type RoleDef } from '../../shared/permissions.ts';
import { all, get } from '../db.ts';
import { leadsMeeting } from './leaders.ts';

type Row = { key: string; name: string; description: string; builtin: number; admin: number; access: string; member_details: number; sensitive_fields: number; reopen_counts: number; sort: number; archived?: number };

const decode = (r: Row): RoleDef => {
  const access = JSON.parse(r.access || '{}') as Partial<Record<PermModule, Access>>;
  return {
    key: r.key, name: JSON.parse(r.name || '{}'), description: JSON.parse(r.description || '{}'), builtin: !!r.builtin, admin: !!r.admin,
    // a module added after the role was saved starts with no access (administrators have everything anyway)
    access: Object.fromEntries(PERM_MODULES.map((m) => [m, access[m] ?? 'none'])) as Record<PermModule, Access>,
    member_details: !!r.member_details, sensitive_fields: !!r.sensitive_fields, reopen_counts: !!r.reopen_counts, sort: r.sort,
    ...(r.archived ? { archived: true } : {}),
  };
};

let cache: Map<string, RoleDef> | null = null;
/** Forget the cached roles (after one is changed). */
export const clearRoleCache = () => {
  cache = null;
};
export function listRoles(): RoleDef[] {
  if (!cache) cache = new Map(all<Row>('SELECT * FROM access_roles ORDER BY sort, key').map((r) => [r.key, decode(r)]));
  return [...cache.values()];
}

/**
 * A role by its key. A key Canon doesn't know (a role missing from the database, e.g. in an older copy of the data)
 * gets no access at all (0.19.9): it used to get read-only access, which reads most of Canon. The account can still
 * sign in, change its password and read why; an administrator gives it a role (Settings → User accounts).
 */
export function roleDef(key: string | null | undefined): RoleDef {
  listRoles();
  return cache!.get(key ?? '') ?? {
    key: key ?? '', name: { en: key || '?' }, description: {}, builtin: false, admin: false, unknown: true,
    access: Object.fromEntries(PERM_MODULES.map((m) => [m, 'none'])) as Record<PermModule, Access>,
    member_details: false, sensitive_fields: false, reopen_counts: false, sort: 999,
  };
}

type WithRole = { role: string } | null | undefined;
export const roleOf = (u: WithRole) => (u ? roleDef(u.role) : null);
export const isAdmin = (u: WithRole) => !!roleOf(u)?.admin;
/** Does this account have at least this access to this module? */
export const can = (u: WithRole, m: PermModule, need: Access) => allows(roleOf(u), m, need);
/** Members' contact details, notes, reasons for absence, birth year. */
export const seesMemberDetails = (u: WithRole) => !!roleOf(u)?.member_details;
export const seesSensitiveFields = (u: WithRole) => !!roleOf(u)?.sensitive_fields;
export const mayReopenCounts = (u: WithRole) => !!roleOf(u)?.reopen_counts;
/**
 * The money of a service (its offerings and cash count), or of the records in general (no service): one rule for the
 * record page, the records list, saving, the reports and AI agents (0.20.0, Daedalus Workshop study of 0.19.10: three
 * places had three rules). Offerings access in the role decides; the leader of a meeting also reads and records its
 * own meeting's money.
 */
export function moneyAccess(u: (WithRole & { person_id?: number | null }) | undefined, serviceId?: number | null): 'none' | 'read' | 'edit' {
  if (can(u, 'contributions', 'edit')) return 'edit';
  if (serviceId != null && leadsMeeting(u?.person_id, serviceId)) return 'edit';
  return can(u, 'contributions', 'read') ? 'read' : 'none';
}
/** Can this account change anything at all (else it is read-only, e.g. for AI connections)? */
export const editsAnything = (u: WithRole) => { const r = roleOf(u); return !!r && (r.admin || PERM_MODULES.some((m) => r.access[m] === 'edit')); };

/** Whether a service-shaped path is a meeting's (its service row, its items, its record). */
export const meetingPath = (path: string) => /^\/(services|items)\/\d+/.test(path) && serviceModule(path) === 'meetings';

/** The module of a service-shaped path: a meeting's service row belongs to Meetings, not Services. */
function serviceModule(path: string): PermModule {
  const s = /^\/services\/(\d+)/.exec(path);
  const i = /^\/items\/(\d+)/.exec(path);
  const kind = s
    ? get<{ kind: string }>('SELECT kind FROM services WHERE id = ?', Number(s[1]))?.kind
    : i ? get<{ kind: string }>('SELECT s.kind FROM service_items it JOIN services s ON s.id = it.service_id WHERE it.id = ?', Number(i[1]))?.kind : undefined;
  return kind === 'meeting' ? 'meetings' : 'services';
}

/**
 * The gate: may this account make this request? Returns why not, or null. Leaders' exception (a read-only account
 * recording its own meeting) is checked by the caller.
 */
export function gateRequest(u: { role: string }, method: string, path: string): string | null {
  const need = routeAccess(method, path);
  const role = roleDef(u.role);
  if (role.admin || need.kind === 'signed_in') return null;
  if (role.unknown) return `This account’s role (“${role.key}”) is not one Canon knows, so it has no access. Ask an administrator to choose a role for it in Settings → User accounts.`;
  if (need.kind === 'admin') return 'Administrators only';
  if (need.kind === 'csv') {
    const entity = /^\/csv\/([a-z_]+)/.exec(path)?.[1];
    if (!entity) return need.access === 'read' ? null : 'Administrators only';
    const m = CSV_MODULE[entity];
    return m && allows(role, m, need.access) ? null : need.access === 'read' ? 'Not available to your role' : 'Your role can’t change this';
  }
  const m = need.module === 'services' ? serviceModule(path) : need.module;
  if (allows(role, m, need.access)) return null;
  return need.access === 'read' ? 'Not available to your role' : role.key === 'viewer' ? 'Read-only account' : 'Your role can’t change this';
}
