// MCP prompts (agent playbooks) and resources (agent handbook, user guide): exposure control and content.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-prompts-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const PUBLIC = 'http://127.0.0.1';
const RESOURCE = `${PUBLIC}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { TOOLS } = await import('../server/mcp.ts');
const { PROMPTS } = await import('../server/mcp-prompts.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Level = 'off' | 'read' | 'write';

let server: Server;
let base = '';

const ALL_WRITE = { members: 'write', coworkers: 'write', groups: 'write', volunteers: 'write', services: 'write', library: 'write', templates: 'write', records: 'write', contributions: 'write' } as const;
function setMcp(modules: Partial<Record<keyof typeof ALL_WRITE, Level>>, pii: boolean) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, enabled: true, modules: { ...cur.modules, ...modules }, expose_member_pii: pii } });
}

before(async () => {
  await createUser({ username: 'admin', display_name: 'Pastor Admin', password: 'correct-horse-1', role: 'admin' });
  await createUser({ username: 'viewer', display_name: 'Viewer Vic', password: 'correct-horse-2', role: 'viewer' });
  setMcp({ ...ALL_WRITE }, true);
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- OAuth helpers (as in oauth-mcp.test.ts)

async function login(username: string, password: string) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await r.json()) as Json;
  return { cookie, csrf: csrf as string };
}

async function accessToken(username: string, password: string): Promise<string> {
  const reg = await fetch(`${base}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT] }),
  });
  const client = (await reg.json()) as Json;
  const session = await login(username, password);
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: REDIRECT, state: 'st',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'canon:read canon:write', resource: RESOURCE,
    csrf: session.csrf, decision: 'allow',
  });
  const a = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: session.cookie }, body: form,
  });
  assert.equal(a.status, 303);
  const code = new URL(a.headers.get('location')!).searchParams.get('code')!;
  const t = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE }),
  });
  const body = (await t.json()) as Json;
  assert.equal(t.status, 200, JSON.stringify(body));
  return body.access_token as string;
}

let rpcId = 1;
async function mcp(at: string, method: string, params: Json = {}) {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-06-18', Authorization: `Bearer ${at}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const body = (await r.json()) as Json;
  assert.equal(r.status, 200, JSON.stringify(body));
  return body;
}

const promptNames = async (at: string) => {
  const r = await mcp(at, 'prompts/list');
  assert.ok(r.result, JSON.stringify(r));
  return (r.result.prompts as Json[]).map((p) => p.name as string).sort();
};

let adminToken = '';
let viewerToken = '';

// ---------------------------------------------------------------- tests

test('initialize advertises prompts and resources; instructions mention them', async () => {
  adminToken = await accessToken('admin', 'correct-horse-1');
  viewerToken = await accessToken('viewer', 'correct-horse-2');
  const init = await mcp(adminToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok(init.result.capabilities.prompts, 'prompts capability');
  assert.ok(init.result.capabilities.resources, 'resources capability');
  assert.match(init.result.instructions, /canon:\/\/guide\/agents/);
  assert.match(init.result.instructions, /plan_service/);
});

test('prompts/list: everything when all modules are writable and PII is exposed', async () => {
  setMcp({ ...ALL_WRITE }, true);
  assert.deepEqual(await promptNames(adminToken), PROMPTS.map((p) => p.name).sort());
});

test('prompts/list hides member_care when members is off or PII is hidden', async () => {
  setMcp({ ...ALL_WRITE, members: 'off' }, true);
  assert.ok(!(await promptNames(adminToken)).includes('member_care'));
  setMcp({ ...ALL_WRITE, members: 'read' }, false);
  assert.ok(!(await promptNames(adminToken)).includes('member_care'));
  setMcp({ ...ALL_WRITE, members: 'read' }, true);
  assert.ok((await promptNames(adminToken)).includes('member_care'));
  // a hidden prompt cannot be fetched either
  setMcp({ ...ALL_WRITE }, false);
  const r = await mcp(adminToken, 'prompts/get', { name: 'member_care', arguments: {} });
  assert.ok(r.error, JSON.stringify(r));
});

test('prompts follow module access: off hides, write-only playbooks need write and a non-viewer', async () => {
  setMcp({ ...ALL_WRITE, library: 'off', groups: 'off' }, false);
  let names = await promptNames(adminToken);
  for (const n of ['suggest_hymns', 'plan_service', 'catechism_series', 'translate_library', 'group_overview']) assert.ok(!names.includes(n), n);
  assert.ok(names.includes('roster_check') && names.includes('proofread_service'));

  setMcp({ ...ALL_WRITE, library: 'read' }, false);
  names = await promptNames(adminToken);
  assert.ok(names.includes('suggest_hymns') && !names.includes('translate_library'));

  setMcp({ ...ALL_WRITE }, false);
  names = await promptNames(viewerToken); // a viewer only ever gets read access
  assert.ok(names.includes('plan_service') && !names.includes('translate_library'));
});

test('prompts/get returns a playbook that only names existing tools', async () => {
  setMcp({ ...ALL_WRITE }, true);
  const toolNames = new Set(TOOLS.map((t) => t.name));
  const args: Record<string, Json> = {
    plan_service: { date: '2026-10-11', sermon_ref: 'Romans 8:28-39', preacher: 'Rev. Tan' },
    suggest_hymns: { theme_or_ref: 'Psalm 23', count: '3' },
    roster_check: { weeks: '6' },
    proofread_service: { date: '2026-10-11' },
    catechism_series: { standard: 'wsc', start_q: '4', weeks: '6' },
    translate_library: { type: 'texts', lang: 'zh' },
    convert_existing: { source: 'both', date: '2026-10-11', as_template: 'yes' },
    check_library: { focus: 'songs' },
    member_care: { days: '30' },
    group_overview: { kind: 'committee' },
  };
  for (const p of PROMPTS) {
    const r = await mcp(adminToken, 'prompts/get', { name: p.name, arguments: args[p.name] ?? {} });
    assert.ok(r.result, `${p.name}: ${JSON.stringify(r)}`);
    const msg = r.result.messages[0];
    assert.equal(msg.role, 'user');
    const text = msg.content.text as string;
    assert.ok(text.length > 400, p.name);
    const mentioned = [...text.matchAll(/canon_\w+/g)].map((m) => m[0]);
    assert.ok(mentioned.length > 0, `${p.name} names no tools`);
    for (const t of mentioned) assert.ok(toolNames.has(t), `${p.name} mentions unknown tool ${t}`);
  }
  // arguments are woven into the text; read-only access turns write steps into proposals
  setMcp({ ...ALL_WRITE, services: 'read' }, false);
  const r = await mcp(adminToken, 'prompts/get', { name: 'plan_service', arguments: { date: '2026-12-06', sermon_ref: 'Isaiah 9:1-7' } });
  const text = r.result.messages[0].content.text as string;
  assert.match(text, /2026-12-06/);
  assert.match(text, /Advent/);
  assert.match(text, /Isaiah 9:1-7/);
  assert.match(text, /READ-ONLY/);
  assert.ok(!text.includes('canon_create_service'));
});

test('every canon_* name in the agent handbook and the skill exists', () => {
  const toolNames = new Set(TOOLS.map((t) => t.name));
  const root = path.resolve(import.meta.dirname, '..');
  const files = ['docs/AGENT-PLAYBOOKS.md', 'skills/canon/SKILL.md', ...fs.readdirSync(path.join(root, 'skills/canon/references')).map((f) => `skills/canon/references/${f}`)];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/canon_\w+/g)) assert.ok(toolNames.has(m[0]), `${f} mentions unknown tool ${m[0]}`);
  }
});

test('resources/list and resources/read serve the handbook and the user guide', async () => {
  const list = await mcp(adminToken, 'resources/list');
  const uris = (list.result.resources as Json[]).map((r) => r.uri).sort();
  assert.deepEqual(uris, ['canon://guide/agents', 'canon://guide/user']);
  for (const r of list.result.resources as Json[]) assert.equal(r.mimeType, 'text/markdown');

  const agents = await mcp(adminToken, 'resources/read', { uri: 'canon://guide/agents' });
  const a = agents.result.contents[0];
  assert.equal(a.uri, 'canon://guide/agents');
  assert.match(a.text, /^# /);
  assert.match(a.text, /canon_edit_order/);

  const user = await mcp(adminToken, 'resources/read', { uri: 'canon://guide/user' });
  assert.match(user.result.contents[0].text, /^# /);

  const missing = await mcp(adminToken, 'resources/read', { uri: 'canon://guide/nope' });
  assert.ok(missing.error);
});

// ---------------------------------------------------------------- argument names (Daedalus Workshop study of 0.19.10)

type Zod = { _zod?: { def?: Record<string, unknown> }; shape?: Record<string, Zod> };
/** A field whose value is a record (its keys are the church's own, e.g. bulletin sections): any key inside it is fine. */
function isRecord(s: Zod | undefined): boolean {
  for (let z = s; z?._zod?.def; z = (z._zod.def.innerType ?? z._zod.def.in) as Zod | undefined) if (z._zod.def.type === 'record') return true;
  return false;
}
/** Every argument name a tool takes, at any depth, and the names of its record-valued fields. */
function argNames(s: unknown, out = { keys: new Set<string>(), records: new Set<string>() }, seen = new Set<unknown>()) {
  if (!s || typeof s !== 'object' || seen.has(s)) return out;
  seen.add(s);
  const z = s as Zod;
  if (z.shape && typeof z.shape === 'object') {
    for (const [k, v] of Object.entries(z.shape)) {
      out.keys.add(k);
      if (isRecord(v)) out.records.add(k);
      argNames(v, out, seen);
    }
  }
  for (const v of Object.values(z._zod?.def ?? {})) {
    if (Array.isArray(v)) v.forEach((x) => argNames(x, out, seen));
    else if (v && typeof v === 'object' && '_zod' in v) argNames(v, out, seen);
  }
  return out;
}
/** The {…} starting at text[i] (braces balanced), or null. */
function objectAt(text: string, i: number): string | null {
  if (text[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return text.slice(i, j + 1);
  }
  return null;
}
const LANG_KEY = /^(en|zh|zh-Hant|[a-z]{2})$/;
/**
 * Argument names in a text that the tool they're given to doesn't take: a JSON object right after a tool's name
 * (canon_x {"a":…}), and the Example objects in a tool's own description. Keys inside a record-valued field (bulletin
 * sections) and language codes are the church's own.
 */
function wrongArgs(where: string, text: string, own?: string): string[] {
  const bad: string[] = [];
  const check = (tool: string, obj: string) => {
    const t = TOOLS.find((x) => x.name === tool);
    if (!t) return;
    const { keys, records } = argNames({ shape: t.input });
    let open = obj;
    for (const r of records) {
      const at = open.indexOf(`"${r}":`);
      const inner = at >= 0 ? objectAt(open, open.indexOf('{', at)) : null;
      if (inner) open = open.replace(inner, '{}');
    }
    for (const k of open.matchAll(/"([A-Za-z_][\w-]*)"\s*:/g)) if (!keys.has(k[1]) && !LANG_KEY.test(k[1])) bad.push(`${where}: ${tool} has no argument "${k[1]}" (in ${obj.slice(0, 100)})`);
  };
  for (const m of text.matchAll(/(canon_\w+)`?\s*`?(?=\{)/g)) {
    const obj = objectAt(text, m.index! + m[0].length);
    if (obj) check(m[1], obj);
  }
  if (own) {
    for (const m of text.matchAll(/Examples?:\s*/g)) {
      let i = m.index! + m[0].length;
      for (let obj = objectAt(text, i); obj; obj = objectAt(text, i)) {
        check(own, obj);
        i += obj.length;
        while (/[;\s]/.test(text[i] ?? '')) i++;
      }
    }
  }
  return bad;
}

test('every argument named for a tool in the playbooks, handbook, skill, tool examples and instructions is one it takes', async () => {
  // the check itself finds a wrong name (0.19.10's playbook gave canon_create_service a "preacher" it silently dropped)
  assert.equal(wrongArgs('sample', 'canon_create_service {"date":"2026-10-11","preacher":"Rev. Example"}').length, 1);
  assert.equal(wrongArgs('sample', 'canon_update_service {"id":1,"patch":{"bulletin_content":{"announcements":{"en":"…"}}}}').length, 0);
  const root = path.resolve(import.meta.dirname, '..');
  const texts: [string, string, string?][] = [];
  for (const f of ['docs/AGENT-PLAYBOOKS.md', 'skills/canon/SKILL.md', ...fs.readdirSync(path.join(root, 'skills/canon/references')).map((x) => `skills/canon/references/${x}`)]) texts.push([f, fs.readFileSync(path.join(root, f), 'utf8')]);
  for (const t of TOOLS) texts.push([`${t.name} description`, t.description, t.name]);
  // every playbook as read only and as read & write, with and without personal data (the steps differ)
  const { MODULES } = await import('../shared/types.ts');
  const args = { date: '2026-10-11', sermon_ref: 'Romans 8:28-39', preacher: 'Rev. Example', theme_or_ref: 'Psalm 23', weeks: '4', type: 'texts', lang: 'zh', source: 'both', as_template: 'yes', focus: 'songs', days: '30', kind: 'committee', standard: 'wsc', start_q: '4', month: '2026-09' };
  for (const p of PROMPTS) for (const level of ['read', 'write']) for (const pii of [false, true]) {
    const levels = Object.fromEntries(MODULES.map((m) => [m, level]));
    texts.push([`playbook ${p.name} (${level}${pii ? ', personal data' : ''})`, p.build(args, { levels, pii, languages: ['en', 'zh'], today: '2026-10-09' } as never)]);
  }
  setMcp({ ...ALL_WRITE }, true);
  const init = await mcp(adminToken, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  texts.push(['server instructions', init.result.instructions as string]);
  const bad = texts.flatMap(([where, text, own]) => wrongArgs(where, text, own));
  assert.deepEqual(bad, []);
});
