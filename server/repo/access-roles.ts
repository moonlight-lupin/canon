// Roles for accounts (Settings → Roles & permissions), administrators only. Canon's ready-made roles can be
// changed (not deleted); the Administrator role always keeps everything. A church can add its own roles. Not to be
// confused with rota roles (Volunteers), which are positions people serve in.
import { GUEST_ROLE } from '../../shared/permissions.ts';
import { PERM_MODULES, type Access, type PermModule, type RoleDef } from '../../shared/permissions.ts';
import type { L10n } from '../../shared/types.ts';
import { get, run, tx } from '../db.ts';
import { BadRequest, Conflict, NotFound } from '../lib/table.ts';
import { clearRoleCache, listRoles } from '../lib/permissions.ts';
import { logChange } from './changelog.ts';

export interface RoleInput {
  name: L10n;
  description?: L10n;
  access: Partial<Record<PermModule, Access>>;
  member_details?: boolean;
  sensitive_fields?: boolean;
  reopen_counts?: boolean;
}

const hasText = (l?: L10n) => !!l && Object.values(l).some((v) => v?.trim());
const fullAccess = (a: Partial<Record<PermModule, Access>>) => Object.fromEntries(PERM_MODULES.map((m) => [m, a[m] ?? 'none'])) as Record<PermModule, Access>;
const asRow = (r: RoleDef) => ({ name: r.name, access: r.access, member_details: r.member_details, sensitive_fields: r.sensitive_fields, reopen_counts: r.reopen_counts });

/** Offerings depend on records: a role can't see money it can't place. */
function checkAccess(a: Record<PermModule, Access>) {
  if (a.contributions !== 'none' && a.records === 'none') throw new BadRequest('Offerings need Service records: give records at least read access.');
}

export function createRole(input: RoleInput): RoleDef {
  if (!hasText(input.name)) throw new BadRequest('Give the role a name.');
  const base = (input.name.en || Object.values(input.name).find(Boolean) || 'role').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'role';
  let key = base;
  for (let i = 2; get('SELECT 1 FROM access_roles WHERE key = ?', key); i++) key = `${base}-${i}`;
  const access = fullAccess(input.access);
  checkAccess(access);
  run(
    `INSERT INTO access_roles (key, name, description, builtin, admin, access, member_details, sensitive_fields, reopen_counts, sort)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`,
    key, JSON.stringify(input.name), JSON.stringify(input.description ?? {}), JSON.stringify(access),
    input.member_details ? 1 : 0, input.sensitive_fields ? 1 : 0, input.reopen_counts ? 1 : 0, 80,
  );
  clearRoleCache();
  const r = listRoles().find((x) => x.key === key)!;
  logChange({ entity: 'access_roles', entity_id: null, action: 'create', after: asRow(r), summary: `Role ${r.name.en ?? key} added` });
  return r;
}

export function updateRole(key: string, input: Partial<RoleInput>): RoleDef {
  const cur = listRoles().find((r) => r.key === key);
  if (!cur) throw new NotFound('That role does not exist.');
  if (cur.admin && (input.access || input.member_details === false || input.sensitive_fields === false || input.reopen_counts === false)) {
    throw new BadRequest('The Administrator role always has everything. Only its name and description can change.');
  }
  if (input.name && !hasText(input.name)) throw new BadRequest('Give the role a name.');
  const access = input.access ? fullAccess({ ...cur.access, ...input.access }) : cur.access;
  checkAccess(access);
  // the external guest role is for people outside the church: it reads, never changes, never sees members' details
  if (key === GUEST_ROLE && (Object.values(access).includes('edit') || input.member_details || input.sensitive_fields || input.reopen_counts)) {
    throw new BadRequest('The external guest role is read-only: it can read some parts of Canon, but not change anything or see members’ details.');
  }
  run(
    'UPDATE access_roles SET name = ?, description = ?, access = ?, member_details = ?, sensitive_fields = ?, reopen_counts = ? WHERE key = ?',
    JSON.stringify(input.name ?? cur.name), JSON.stringify(input.description ?? cur.description), JSON.stringify(access),
    (input.member_details ?? cur.member_details) ? 1 : 0, (input.sensitive_fields ?? cur.sensitive_fields) ? 1 : 0, (input.reopen_counts ?? cur.reopen_counts) ? 1 : 0, key,
  );
  clearRoleCache();
  const r = listRoles().find((x) => x.key === key)!;
  logChange({ entity: 'access_roles', entity_id: null, action: 'update', before: asRow(cur), after: asRow(r), summary: `Role ${r.name.en ?? key} changed` });
  return r;
}

export function deleteRole(key: string) {
  const cur = listRoles().find((r) => r.key === key);
  if (!cur) throw new NotFound('That role does not exist.');
  if (cur.builtin) throw new BadRequest('Canon’s ready-made roles can be changed but not deleted.');
  const n = get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE role = ?', key)?.n ?? 0;
  if (n) throw new Conflict(`${n} account${n === 1 ? ' has' : 's have'} this role. Give ${n === 1 ? 'it' : 'them'} another role first.`);
  tx(() => run('DELETE FROM access_roles WHERE key = ?', key));
  clearRoleCache();
  logChange({ entity: 'access_roles', entity_id: null, action: 'delete', before: asRow(cur), summary: `Role ${cur.name.en ?? key} deleted` });
  return { deleted: true };
}

/** How many accounts have each role (for the roles list). */
export const roleUse = () => Object.fromEntries((listRoles().map((r) => [r.key, get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE role = ?', r.key)?.n ?? 0])));
