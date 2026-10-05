// MCP server (Streamable HTTP, stateless) exposing Canon to AI agents such as claude.ai.
//
// Exposure control: every tool belongs to a module and needs 'read' or 'write'. For each request the effective level
// per module is min(admin setting in Settings → AI / MCP, token scope, user's current role). Only tools allowed for
// this request are registered, so hidden tools never show up in tools/list and calls to them fail as unknown tools.
// Every tools/call is written to mcp_audit once (argument keys only for the members / co-workers / groups registers;
// batch tools also record their op types).
//
// The tools themselves live in ./mcp-tools/*.ts. They are deliberately few and capable (find / get / save / batch
// edit) to keep tools/list small: a read tool and a write tool never merge, and every tool that can remove
// something is annotated destructive.
import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { MODULES, MODULE_PARENT, READ_ONLY_MODULES, configuredAccess } from '../shared/types.ts';
import type { McpConfig, ModuleAccess, ModuleKey, Role } from '../shared/types.ts';
import { LANG_CODE_RE, langInfo } from '../shared/languages.ts';
import { bearerAuth, externalBase, type McpAuth } from './oauth.ts';
import { asActor } from './lib/actor.ts';
import { listCongregations } from './repo/congregations.ts';
import { get as dbGet } from './db.ts';

/** The name an MCP client registered with ("Claude", "Hermes Agent"…), for the change log. */
const clientName = (clientId: string) => dbGet<{ client_name: string | null }>('SELECT client_name FROM oauth_clients WHERE client_id = ?', clientId)?.client_name ?? clientId;
import { run } from './db.ts';
import { getSettings } from './repo/settings.ts';
import { BatchError, errorMessage, type Args, type Ctx, type ToolDef } from './mcp-tools/common.ts';
import { SERVICE_TOOLS } from './mcp-tools/services.ts';
import { LIBRARY_TOOLS } from './mcp-tools/library.ts';
import { VOLUNTEER_TOOLS } from './mcp-tools/volunteers.ts';
import { PEOPLE_TOOLS } from './mcp-tools/people.ts';
import { GROUP_TOOLS } from './mcp-tools/groups.ts';
import { RECORD_TOOLS } from './mcp-tools/records.ts';
import { allowedPrompts, registerPrompts, registerResources } from './mcp-prompts.ts';
import { editsAnything, roleDef, seesMemberDetails } from './lib/permissions.ts';
import type { PermModule } from '../shared/permissions.ts';
import { wallOf } from './auth.ts';
import { leadsMeeting } from './lib/leaders.ts';
export type { ToolDef } from './mcp-tools/common.ts';

const VERSION = '0.1.0';

/** The full tool table: core tools plus feature modules. */
const MODULE_TEXT: Record<ModuleKey, string> = {
  services: 'services, the order of service and downloads', templates: 'service templates', library: 'songs, liturgy, hymnals and Bibles',
  volunteers: 'teams, roles, rota and away dates', members: 'the member register', coworkers: 'co-workers', groups: 'groups, committees and serving teams',
  records: 'service records: attendance, new visitors (names and follow-up) and notes for the team, and their reports',
  contributions: 'offerings and cash counts on service records, and the offerings report (read only; part of records)',
};

/** Why a module is at this level on this connection (admin setting ∩ connection scope ∩ the person's role). */
function accessReason(module: ModuleKey, cfg: McpConfig, scopes: Set<string>, role: Role): string {
  const setting = configuredAccess(module, cfg.modules);
  const parent = MODULE_PARENT[module];
  if (parent && configuredAccess(parent, cfg.modules) === 'off') return `it is part of ${parent}, which is not shared with AI agents`;
  if (setting === 'off') return 'the administrator has not shared this module with AI agents';
  if (roleAccess(module, role) === 'none') return `your role (${roleDef(role).name.en}) does not include this module`;
  if (READ_ONLY_MODULES.includes(module)) return 'read only: AI agents never change offerings or cash counts';
  const lvl = effectiveAccess(module, cfg, scopes, role);
  if (lvl === 'write') return 'the administrator allows read & write, this connection may write, and your role may write';
  if (setting === 'read') return 'the administrator shares it read-only';
  if (roleAccess(module, role) !== 'edit') return 'the administrator allows read & write, but your role only reads this module';
  if (!scopes.has('canon:write')) return 'the administrator allows read & write, but this connection was approved for reading only';
  return 'read only';
}

/** canon_whoami: always offered; built here because it needs the connection's settings. */
const WHOAMI: ToolDef = {
  name: 'canon_whoami', module: 'services', access: 'read', always: true, title: 'Who am I connected as', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  description: 'Who this connection acts for and what it may do: the person and their role, access to each module (off / read / write) with the reason, whether member contact details are shown, the church, its languages and congregations, the tools and playbooks available, what agents may never do, and the working instructions. Call it first when unsure what you can do, or when a tool you expected is missing.',
  input: {},
  handler: (_a, ctx) => {
    const settings = getSettings();
    const cfg = settings.mcp;
    const { auth } = ctx;
    const levels = ctx.levels ?? (Object.fromEntries(MODULES.map((m) => [m, effectiveAccess(m, cfg, auth.scopes, auth.user.role)])) as Record<ModuleKey, ModuleAccess>);
    return {
      user: { name: auth.user.display_name, role: auth.user.role, role_name: roleDef(auth.user.role).name.en, meaning: roleDef(auth.user.role).description.en },
      connection: { scopes: [...auth.scopes], write_allowed: auth.scopes.has('canon:write') && editsAnything(auth.user) },
      church: { name: settings.church_name, languages: settings.languages.map((l) => ({ code: l, name: langInfo(l).name })) },
      congregations: listCongregations().filter((c) => c.active).map((c) => ({ id: c.id, code: c.code, name: c.name, languages: c.languages })),
      modules: Object.fromEntries(MODULES.map((m) => [m, { access: levels[m], covers: MODULE_TEXT[m], why: accessReason(m, cfg, auth.scopes, auth.user.role) }])),
      member_contact_details: piiFor(cfg, auth.user.role) ? 'shown where relevant — handle with care (PDPA)' : !seesMemberDetails(auth.user) && cfg.expose_member_pii ? 'withheld: your role does not see members’ contact details (PDPA)' : 'withheld by the administrator (PDPA) — do not try to obtain or infer them',
      tools: allowedTools(cfg, auth.scopes, auth.user.role).map((t) => t.name),
      playbooks: allowedPrompts(levels, piiFor(cfg, auth.user.role)).map((p) => p.name),
      never: [
        'send e-mail or messages', 'delete people', 'see user accounts, passwords, settings or connection data',
        ...(levels.records === 'off' ? ['see service records (attendance, visitors, notes)'] : []),
        ...(levels.contributions === 'off' ? ['see offerings or cash counts'] : []),
        'change offerings, cash counts or signatures, or verify a count', 'type hymn words that are under copyright unless the church holds a licence',
        'remove or overwrite anything without asking the user first',
      ],
      instructions: instructions(levels, piiFor(cfg, auth.user.role), settings.languages),
      handbook: 'canon://guide/agents',
    };
  },
};

export const TOOLS: ToolDef[] = [WHOAMI, ...SERVICE_TOOLS, ...LIBRARY_TOOLS, ...VOLUNTEER_TOOLS, ...PEOPLE_TOOLS, ...GROUP_TOOLS, ...RECORD_TOOLS];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** The whole MCP surface for the settings UI: which tools each module exposes and at what level. */
export function toolCatalog() {
  return TOOLS.map((t) => ({
    name: t.name,
    module: t.module,
    access: t.access,
    title: t.title,
    description: t.description,
    requires_pii: !!t.requiresPii,
  }));
}

// ---------------------------------------------------------------- exposure control

/** Effective access to a module for this request = min(admin setting, token scope, user role). */
/** Members' personal data on this connection: the administrator shares it, and the person's role sees members' details. */
export const piiFor = (cfg: McpConfig, role: Role) => cfg.expose_member_pii && roleDef(role).member_details;
/** The church's member fields marked sensitive: personal data is shared, and the role sees sensitive fields too. */
export const sensitiveFor = (cfg: McpConfig, role: Role) => piiFor(cfg, role) && roleDef(role).sensitive_fields;

/**
 * Meetings through the generic service and record tools: the same rules as the web app. Meetings switched off
 * (Settings → Modules) don't exist for agents; otherwise the role's Meetings access decides (a leader may change
 * the meetings they lead, as in the web app).
 */
export function meetingGate(user: { role: Role; person_id?: number | null }) {
  return (entity: string, row: { id?: number; kind?: string | null }, mode: 'read' | 'write') => {
    if (entity !== 'services' || row.kind !== 'meeting') return;
    const hidden = () => Object.assign(new Error(`service ${row.id ?? ''} not found`.replace(/ $/, '')), { status: 404 });
    if (getSettings().modules.meetings === false) throw hidden();
    const access = roleAccess('meetings' as ModuleKey, user.role);
    const leads = row.id != null && leadsMeeting(user.person_id, row.id);
    if (access === 'none' && !leads) throw hidden();
    if (mode === 'write' && access !== 'edit' && !leads) throw Object.assign(new Error('Your role can only read meetings.'), { status: 403 });
  };
}
/** What the person's role allows in a module (administrators: everything). */
const roleAccess = (module: ModuleKey, role: Role) => (roleDef(role).admin ? 'edit' : roleDef(role).access[module as PermModule] ?? 'none');

export function effectiveAccess(module: ModuleKey, cfg: McpConfig, scopes: Set<string>, role: Role): ModuleAccess {
  const setting = configuredAccess(module, cfg.modules);
  if (!cfg.enabled || setting === 'off') return 'off';
  // as in the web app: the role decides (e.g. read-only accounts never see offerings)
  const ra = roleAccess(module, role);
  if (ra === 'none') return 'off';
  if (!scopes.has('canon:read') && !scopes.has('canon:write')) return 'off';
  if (setting === 'write' && scopes.has('canon:write') && ra === 'edit') return 'write';
  return 'read';
}

export function allowedTools(cfg: McpConfig, scopes: Set<string>, role: Role): ToolDef[] {
  const on = getSettings().modules;
  return TOOLS.filter((t) => {
    if (t.always) return cfg.enabled;
    // switched-off parts of Canon (Settings → Modules) have no tools
    if (on.volunteers === false && (t.module === 'volunteers' || t.name === 'canon_serving_report')) return false;
    if (on.meetings === false && t.name === 'canon_get_calendar') return false;
    const lvl = effectiveAccess(t.module, cfg, scopes, role);
    if (lvl === 'off' || (t.access === 'write' && lvl !== 'write')) return false;
    return !t.requiresPii || piiFor(cfg, role);
  });
}

const LEVEL_TEXT: Record<ModuleAccess, string> = { off: 'not available', read: 'read only', write: 'read & write' };

function instructions(levels: Record<ModuleKey, ModuleAccess>, pii: boolean, languages: string[]) {
  const prompts = allowedPrompts(levels, pii).map((p) => p.name);
  const langs = languages.map((l) => `${l} = ${langInfo(l).name}`).join(', ');
  return [
    'Canon is a local-first church management system for a Reformed / Presbyterian congregation.',
    `Localised fields are L10n objects {"<lang>": "..."}; the church's languages are ${langs} (primary first) — fill each of them when you can.`,
    'Tools: find_* / get_* / search_* read (find and search return summaries, get returns detail); save_* create (no id) or update (id + fields); edit_order, update_rota, update_team_members and update_group_members apply a batch of ops all-or-nothing and return per-op errors if any op fails.',
    levels.services !== 'off' && 'PRECEDENT FIRST: before proposing or writing any plan, ALWAYS look at similar past services (canon_find_services {similar_to: <service id>} or {like: {date, sermon_ref}}, or canon_get_service {include_similar: true}) and at hymn history (canon_search_library returns last_used / times_12m per song). Treat them as the church\'s practice: its order, typical hymns, durations and who serves. Avoid a hymn sung in the last ~4 weeks unless the church clearly repeats it; continue a catechism series from the last question used (canon_get_library_item gives next_suggested_label). Say which past services you based a proposal on.',
    'Typical service workflow: canon_find_services (or canon_get_templates → canon_create_service with template_id or copy_from) → canon_get_service → canon_search_library for songs / liturgy / hymnal numbers → canon_edit_order with add / update / move / remove ops → canon_update_service {status: "final"} → canon_update_rota to staff it (canon_get_rota shows teams, roles and who is free).',
    'Item kinds: section, song, scripture, text, sermon, prayer, sacrament, offering, announcements, music, other. A song item has ref_id = song id and optional stanzas ("1","3","R"); a text item has ref_id = liturgical text id (catechism / confession parts go in stanzas, e.g. ["1","2","3"]); a scripture item has scripture_ref such as "Romans 8:28-39" and the Bible text is filled in automatically.',
    'A typical Reformed order: Call to Worship, Invocation, Hymn, Reading of the Law / Confession of Sin, Assurance of Pardon, Creed, Pastoral Prayer, Scripture Reading, Sermon, Hymn, Offering, Doxology, Benediction.',
    'Dates are YYYY-MM-DD, times HH:MM (24h). Results are JSON {"ok":true,"data":...} or {"ok":false,"error":"...","errors":[per-op]}.',
    `Modules on this connection (set by the church administrator): ${MODULES.map((m) => `${m}: ${LEVEL_TEXT[levels[m]]}`).join('; ')}.`,
    pii
      ? 'Member contact details are included where relevant — handle them with care (PDPA); do not copy them anywhere the user did not ask for.'
      : 'Member contact details, addresses, birth dates and notes are withheld by the administrator (PDPA); do not try to obtain or infer them.',
    'Ask the user before removing or overwriting anything.',
    `Read the agent handbook resource canon://guide/agents before larger tasks (canon://guide/user is the staff user guide).${prompts.length ? ` Step-by-step playbooks are available as prompts: ${prompts.join(', ')}.` : ''}`,
  ].filter((x): x is string => typeof x === 'string').join('\n');
}

// ---------------------------------------------------------------- results, errors, audit

/** Compact JSON: drop null / undefined object properties. */
const dropNulls = (_k: string, v: unknown) => (v === null ? undefined : v);
const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, data }, dropNulls) }] });
const fail = (error: string, errors?: unknown): CallToolResult =>
  ({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error, errors }) }], isError: true });

/**
 * Argument key paths only (no values), e.g. ["id", "fields.phone"]. Arrays of batch operations are summarised
 * as their op types plus the keys the operations use, e.g. ["group_id", "ops[add,remove]", "ops[].person_id"].
 */
function argKeys(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) {
    const objs = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));
    const ops = objs.map((x) => x.op).filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 20));
    if (!ops.length) return prefix ? [prefix] : [];
    const keys = [...new Set(objs.flatMap((x) => Object.keys(x)).filter((k) => k !== 'op'))];
    return [`${prefix}[${ops.join(',')}]`, ...keys.map((k) => `${prefix}[].${k}`)];
  }
  if (!v || typeof v !== 'object') return prefix ? [prefix] : [];
  const out: string[] = [];
  for (const [k, x] of Object.entries(v)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (x && typeof x === 'object' && (Array.isArray(x) || prefix.split('.').length < 3)) out.push(...argKeys(x, p));
    else out.push(p);
  }
  return out;
}

const MAX_AUDIT_ARGS = 2000;

const SENSITIVE_MODULES = new Set<ModuleKey>(['members', 'coworkers', 'groups']);

function audit(auth: McpAuth, name: unknown, args: unknown, okFlag: boolean, error: string | null, level: ModuleAccess | null) {
  try {
    const tool = typeof name === 'string' ? name.slice(0, 100) : '(invalid)';
    const def = TOOL_BY_NAME.get(tool);
    // Unknown tools are treated as sensitive too: we can't tell what the arguments contain.
    const sensitive = !def || SENSITIVE_MODULES.has(def.module);
    let argText = sensitive ? JSON.stringify(argKeys(args)) : JSON.stringify(args ?? {});
    // Too long to keep whole (big batches): keep the key / op-type summary rather than a cut-off fragment.
    if (argText.length > MAX_AUDIT_ARGS) argText = JSON.stringify(argKeys(args)).slice(0, MAX_AUDIT_ARGS);
    run(
      'INSERT INTO mcp_audit (user_id, client_id, tool, module, access, ok, args, error) VALUES (?,?,?,?,?,?,?,?)',
      auth.user.id, auth.clientId, tool, def?.module ?? null, def ? def.access : level, okFlag ? 1 : 0, argText,
      error ? error.slice(0, 1000) : null,
    );
  } catch (e) {
    console.error('[mcp] audit failed', e);
  }
}

function resultError(r: CallToolResult | undefined): string | null {
  if (!r?.isError) return null;
  const c = r.content?.[0];
  const text = c && c.type === 'text' ? c.text : 'error';
  try {
    const j = JSON.parse(text) as { error?: string };
    if (j && typeof j.error === 'string') return j.error;
  } catch {
    /* plain text from the SDK (unknown tool, validation error) */
  }
  return text;
}

type RawHandler = (request: { params?: { name?: unknown; arguments?: unknown } }, extra: unknown) => Promise<CallToolResult>;

/**
 * Audit every tools/call, including calls the SDK rejects before reaching a tool (unknown/hidden tool,
 * input validation errors), by wrapping the server's tools/call request handler.
 */
function wrapToolsCall(server: McpServer, auth: McpAuth): boolean {
  const map = (server.server as unknown as { _requestHandlers?: Map<string, RawHandler> })._requestHandlers;
  const orig = map?.get('tools/call');
  if (!map || !orig) return false;
  map.set('tools/call', async (request, extra) => {
    const name = request?.params?.name;
    const args = request?.params?.arguments;
    try {
      const r = await orig(request, extra);
      const err = resultError(r);
      audit(auth, name, args, !err, err, null);
      return r;
    } catch (e) {
      audit(auth, name, args, false, (e as Error)?.message ?? String(e), null);
      throw e;
    }
  });
  return true;
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/.source;
const LANG_PATTERN = LANG_CODE_RE.source;

/**
 * Shrink the JSON Schemas the SDK generates from zod for tools/list. Arguments are still validated against the full
 * zod schemas on every call; this only drops noise the model doesn't need: `$schema`, the ±2^53 bounds zod adds to
 * every integer, `exclusiveMinimum: 0` on ids, maxLength limits and the language-code pattern; dates become
 * `format: date` and `anyOf [X, null]` becomes `type: [X, "null"]`.
 */
export function compactSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(compactSchema);
  if (!node || typeof node !== 'object') return node;
  let out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === '$schema' || k === 'propertyNames' || k === 'maxLength') continue;
    if ((k === 'minimum' || k === 'maximum') && typeof v === 'number' && Math.abs(v) >= MAX_SAFE) continue;
    if (k === 'exclusiveMinimum' && v === 0) continue;
    if (k === 'pattern' && v === LANG_PATTERN) continue;
    if (k === 'pattern' && v === DATE_PATTERN) {
      out.format = 'date';
      continue;
    }
    out[k] = compactSchema(v);
  }
  // anyOf [{type: X, ...}, {type: "null"}]  ->  {type: [X, "null"], ...}
  const any = out.anyOf as Record<string, unknown>[] | undefined;
  if (Array.isArray(any) && any.length === 2 && any[1]?.type === 'null' && Object.keys(any[1]).length === 1 && typeof any[0]?.type === 'string') {
    const { anyOf: _a, ...rest } = out;
    const x = any[0];
    out = { ...rest, ...x, type: [x.type, 'null'], ...(Array.isArray(x.enum) ? { enum: [...x.enum, null] } : {}) };
  }
  return out;
}

type ListHandler = (request: unknown, extra: unknown) => Promise<{ tools?: { inputSchema?: unknown; outputSchema?: unknown }[] }>;

function compactToolsList(server: McpServer) {
  const map = (server.server as unknown as { _requestHandlers?: Map<string, ListHandler> })._requestHandlers;
  const orig = map?.get('tools/list');
  if (!map || !orig) return;
  map.set('tools/list', async (request, extra) => {
    const r = await orig(request, extra);
    for (const t of r.tools ?? []) t.inputSchema = compactSchema(t.inputSchema);
    return r;
  });
}

// ---------------------------------------------------------------- per-request server

export function buildServer(auth: McpAuth, base = '') {
  const settings = getSettings();
  const cfg = settings.mcp;
  const levels = Object.fromEntries(MODULES.map((m) => [m, effectiveAccess(m, cfg, auth.scopes, auth.user.role)])) as Record<ModuleKey, ModuleAccess>;
  const pii = piiFor(cfg, auth.user.role);
  const ctx: Ctx = { auth, pii, sensitive: sensitiveFor(cfg, auth.user.role), levels, base };
  const server = new McpServer({ name: 'canon', title: 'Canon', version: VERSION }, { instructions: instructions(levels, pii, settings.languages) });
  const tools = allowedTools(cfg, auth.scopes, auth.user.role);
  let auditInHandlers = false;
  const register = (t: ToolDef) =>
    server.registerTool(
      t.name,
      { title: t.title, description: t.description, inputSchema: t.input, annotations: t.annotations },
      async (args: Args) => {
        let r: CallToolResult;
        try {
          r = ok(await asActor({
            user_id: auth.user.id, user_name: auth.user.display_name, via: 'mcp', client: clientName(auth.clientId),
            congregation_id: wallOf(auth.user), gate: meetingGate(auth.user), sensitive: sensitiveFor(cfg, auth.user.role),
          }, () => t.handler(args ?? {}, ctx)));
        } catch (e) {
          r = fail(errorMessage(e), e instanceof BatchError ? e.errors : undefined);
        }
        if (auditInHandlers) audit(auth, t.name, args, !r.isError, resultError(r), null);
        return r;
      },
    );
  for (const t of tools) register(t);
  if (!tools.length) {
    // Initialise the tools capability so tools/list answers with an empty list.
    server.registerTool('canon_placeholder', { description: 'placeholder', inputSchema: {} }, async () => ok(null)).remove();
  }
  // Playbooks (prompts) are filtered by the same effective access; the handbook and user guide are always readable.
  registerPrompts(server, { levels, pii, languages: settings.languages, today: new Date().toISOString().slice(0, 10) });
  registerResources(server);
  auditInHandlers = !wrapToolsCall(server, auth);
  compactToolsList(server);
  return server;
}

// ---------------------------------------------------------------- HTTP

export const mcpRouter = express.Router();

// Bearer-token API, no cookies: open CORS so browser-based MCP clients work.
mcpRouter.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// `/mcp` and `/mcp/` both land on '/' here (no redirect).
mcpRouter.post('/', bearerAuth, express.json({ limit: '4mb' }), async (req: Request, res: Response) => {
  const server = buildServer(req.mcpAuth!, externalBase(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[mcp] request failed', e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// Stateless server: no standalone SSE stream (GET) and no sessions to delete (DELETE).
mcpRouter.all('/', (_req, res) => {
  res.setHeader('Allow', 'POST, OPTIONS');
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this MCP server is stateless, use POST' }, id: null });
});

mcpRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = err as { status?: number; type?: string };
  if (res.headersSent) return;
  if (e.type === 'entity.parse.failed') return res.status(400).json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  if (e.status === 413) return res.status(413).json({ jsonrpc: '2.0', error: { code: -32600, message: 'Request too large' }, id: null });
  console.error('[mcp]', err);
  res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
});
