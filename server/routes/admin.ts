// REST routes for administration: AI agents (MCP), the change log and archives. Mounted inside /api after authentication.
import express, { type Request } from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import { config } from '../config.ts';
import { normalisePublicUrl, publicUrl } from '../lib/public-url.ts';
import { ENTITY_LABEL, changeLogUsers, listAudit, listChanges } from '../repo/changelog.ts';
import * as arc from '../repo/archive.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { listGrants, revokeGrant, externalBase } from '../oauth.ts';
import { toolCatalog } from '../mcp.ts';
import { h, id, sendCsv, str } from './helpers.ts';
import * as ar from '../repo/access-roles.ts';
import { listRoles } from '../lib/permissions.ts';
import { PERM_MODULES } from '../../shared/permissions.ts';
import { OPTIONAL_MODULES } from '../../shared/modules.ts';

export const adminRoutes = express.Router();

// ---------------------------------------------------------------- MCP administration

adminRoutes.get('/mcp/config', requireAdmin, h(() => getSettings().mcp));
adminRoutes.put('/mcp/config', requireAdmin, h((req) => updateSettings({ mcp: S.McpConfigSchema.parse(req.body) }).mcp));
/** AI activity log, newest first, with filters and paging. */
const auditQuery = (q: Record<string, string | undefined>) => ({
  user_id: Number(q.user) || undefined, client: q.client || undefined, tool: q.tool || undefined, module: q.module || undefined,
  ok: q.result === 'ok' ? true : q.result === 'error' ? false : undefined, from: q.from, to: q.to, q: q.q,
  page: Number(q.page) || 1, size: Number(q.size) || 50,
});
adminRoutes.get('/mcp/audit', requireAdmin, h((req) => listAudit(auditQuery(req.query as Record<string, string | undefined>))));
/** The AI activity log as CSV: every row matching the filters (up to 20,000). */
adminRoutes.get('/mcp/audit.csv', requireAdmin, h((req, res) => {
  const r = listAudit({ ...auditQuery(req.query as Record<string, string | undefined>), all: true });
  const rows = r.rows as { at: string; user_name: string | null; client_name: string | null; client_id: string | null; tool: string; module: string | null; access: string | null; ok: number; error: string | null; args: string | null }[];
  sendCsv(res, `canon-ai-activity-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'User', 'Client', 'Tool', 'Module', 'Access', 'Result', 'Error', 'Arguments'],
    ...rows.map((a) => [a.at, a.user_name, a.client_name ?? a.client_id, a.tool, a.module, a.access, a.ok ? 'OK' : 'Error', a.error, a.args]),
  ]);
}));

/** The change log (administrators): who changed what and when; a record's history with entity + entity_id. */
const changeQuery = (q: Record<string, string | undefined>) => ({
  entity: q.entity || undefined, entity_id: Number(q.entity_id) || undefined, user_id: Number(q.user) || undefined,
  via: (['web', 'mcp', 'import', 'system'].includes(q.via ?? '') ? q.via : undefined) as 'web' | undefined,
  action: q.action || undefined, from: q.from, to: q.to, q: q.q, page: Number(q.page) || 1, size: Number(q.size) || 50,
});
adminRoutes.get('/change-log', requireAdmin, h((req) => {
  const r = listChanges(changeQuery(req.query as Record<string, string | undefined>));
  return { ...r, users: changeLogUsers(), entities: ENTITY_LABEL };
}));
/** The change log as CSV: every row matching the filters (up to 20,000), one row per change with its fields. */
adminRoutes.get('/change-log.csv', requireAdmin, h((req, res) => {
  const r = listChanges({ ...changeQuery(req.query as Record<string, string | undefined>), all: true });
  const val = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  const VIA: Record<string, string> = { web: 'In Canon', mcp: 'AI agent', import: 'CSV import', system: 'Canon' };
  const ACTION: Record<string, string> = { create: 'Added', update: 'Changed', delete: 'Deleted' };
  sendCsv(res, `canon-change-log-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'Who', 'How', 'Client', 'What', 'Record', 'Action', 'Summary', 'Changes'],
    ...r.rows.map((c) => [
      c.at, c.user_name, VIA[c.via] ?? c.via, c.client, ENTITY_LABEL[c.entity]?.en ?? c.entity, c.name, ACTION[c.action] ?? c.action, c.summary,
      Object.entries(c.changes ?? {}).map(([k, [a, b]]) => `${k}: ${val(a)} → ${val(b)}`).join('; '),
    ]),
  ]);
}));
adminRoutes.put('/log-retention', requireAdmin, h((req) => {
  const b = z.object({
    change_log_months: z.number().int().min(0).max(120).optional(), mcp_audit_months: z.number().int().min(0).max(120).optional(),
    visitor_contact_months: z.number().int().min(0).max(120).optional(), archive_years: z.number().int().min(0).max(30).optional(),
    log_archive_years: z.number().int().min(0).max(30).nullable().optional(),
  }).parse(req.body);
  return updateSettings({ retention: { ...getSettings().retention, ...b } }).retention;
}));
// archives (administrators): preview / run, list, open read-only, download
adminRoutes.post('/archives/run', requireAdmin, h((req) => arc.runArchive(!!z.object({ dry_run: z.boolean().optional() }).parse(req.body ?? {}).dry_run)));
adminRoutes.get('/archives', requireAdmin, h(() => arc.listArchives()));
const yearOf = (req: Request) => {
  const y = Number(req.params.year);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw Object.assign(new Error('Bad year'), { status: 400 });
  return y;
};
adminRoutes.get('/archives/:year/records', requireAdmin, h((req) => arc.archivedRecords(yearOf(req))));
adminRoutes.get('/archives/:year/changes', requireAdmin, h((req) => arc.archivedChanges(yearOf(req), { page: Number(req.query.page) || 1, q: str(req.query.q) })));
adminRoutes.post('/archives/:year/records/:service/restore', requireAdmin, h((req) => arc.restoreArchivedRecord(yearOf(req), id(req, 'service'))));
adminRoutes.get('/archives/:year/download', requireAdmin, (req, res, next) => {
  try {
    res.download(arc.archivePath(yearOf(req)));
  } catch (e) {
    next(e);
  }
});
adminRoutes.get('/mcp/tools', requireAdmin, h(() => toolCatalog()));
adminRoutes.get('/mcp/endpoint', requireAdmin, h((req) => ({
  url: `${externalBase(req)}/mcp`,
  public_url_set: !!publicUrl(),
  public_url: getSettings().public_url,
  trust_proxy: getSettings().trust_proxy,
  /** set by an IT administrator in the environment; overrides the Settings value */
  env_override: !!config.publicUrl,
})));
adminRoutes.put('/mcp/public-url', requireAdmin, h((req) => {
  const b = z.object({ public_url: z.string().max(300), trust_proxy: z.boolean().optional() }).parse(req.body);
  const n = normalisePublicUrl(b.public_url);
  if ('error' in n) throw Object.assign(new Error(n.error), { status: 400 });
  const s = updateSettings({ public_url: n.url, ...(b.trust_proxy !== undefined ? { trust_proxy: b.trust_proxy } : {}) });
  return { public_url: s.public_url, trust_proxy: s.trust_proxy };
}));
/** Check that the public address really reaches this Canon (fetches its OAuth metadata over the internet). */
adminRoutes.post('/mcp/check-public-url', requireAdmin, h(async (req) => {
  const n = normalisePublicUrl(z.string().max(300).parse(req.body.public_url ?? publicUrl()));
  if ('error' in n) return { ok: false, message: n.error };
  if (!n.url) return { ok: false, message: 'No public address entered.' };
  try {
    const r = await fetch(`${n.url}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    if (!r.ok) return { ok: false, message: `The address answered with HTTP ${r.status}. Is the tunnel pointing at this Canon (port ${config.port})?` };
    const meta = (await r.json().catch(() => null)) as { resource?: string } | null;
    if (!meta?.resource?.endsWith('/mcp')) return { ok: false, message: 'Something answered at that address, but it is not Canon.' };
    if (meta.resource.replace(/\/+$/, '') !== `${n.url}/mcp`) {
      return { ok: false, message: `Canon answered, but it reports ${meta.resource}. Save the public address first, then check again.` };
    }
    return { ok: true, message: 'Canon is reachable at this address. You can add the connector in claude.ai.' };
  } catch (e) {
    return { ok: false, message: `Could not reach ${n.url} (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}). Check the tunnel is running.` };
  }
}));
adminRoutes.get('/mcp/grants', requireAdmin, h(() => listGrants()));
adminRoutes.delete('/mcp/grants/:grant', requireAdmin, h((req) => revokeGrant(String(req.params.grant))));

// ---------------------------------------------------------------- optional parts of Canon

adminRoutes.put('/modules', requireAdmin, h((req) => {
  const b = z.partialRecord(z.enum(OPTIONAL_MODULES), z.boolean()).parse(req.body);
  const before = getSettings().modules;
  const after = updateSettings({ modules: { ...before, ...b } }).modules;
  return after;
}));

// ---------------------------------------------------------------- roles for accounts (not rota roles)

const RoleInput = z.object({
  name: S.L10nSchema,
  description: S.L10nSchema.optional(),
  access: z.partialRecord(z.enum(PERM_MODULES), z.enum(['none', 'read', 'edit'])),
  member_details: z.boolean().optional(),
  sensitive_fields: z.boolean().optional(),
  reopen_counts: z.boolean().optional(),
});
adminRoutes.get('/access-roles', requireAdmin, h(() => ({ roles: listRoles(), use: ar.roleUse() })));
adminRoutes.post('/access-roles', requireAdmin, h((req) => ar.createRole(RoleInput.parse(req.body))));
adminRoutes.patch('/access-roles/:key', requireAdmin, h((req) => ar.updateRole(String(req.params.key), RoleInput.partial().parse(req.body))));
adminRoutes.delete('/access-roles/:key', requireAdmin, h((req) => ar.deleteRole(String(req.params.key))));
