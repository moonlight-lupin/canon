// End-to-end tests for the OAuth 2.1 authorization server and the MCP endpoint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-test-'));
process.env.CANON_DB = path.join(tmp, 'test.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const PUBLIC = 'http://127.0.0.1';
const RESOURCE = `${PUBLIC}/mcp`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { listGrants, revokeGrant } = await import('../server/oauth.ts');
const reg = await import('../server/repo/registers.ts');
const vol = await import('../server/repo/volunteers.ts');
const lib = await import('../server/repo/library.ts');
const { all, db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let server: Server;
let base = '';

const ALL_ON = { members: 'read', coworkers: 'read', volunteers: 'write', services: 'write', library: 'write', templates: 'write' } as const;
function setMcp(patch: Partial<{ enabled: boolean; modules: Partial<Record<keyof typeof ALL_ON, 'off' | 'read' | 'write'>>; expose_member_pii: boolean }>) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, ...patch, modules: { ...cur.modules, ...(patch.modules ?? {}) } } });
}

before(async () => {
  createUser({ username: 'admin', display_name: 'Pastor Admin', password: 'correct-horse-1', role: 'admin' });
  createUser({ username: 'viewer', display_name: 'Viewer Vic', password: 'correct-horse-2', role: 'viewer' });
  setMcp({ enabled: true, modules: { ...ALL_ON }, expose_member_pii: false });
  server = createApp().listen(0, '127.0.0.1');
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

// ---------------------------------------------------------------- helpers

function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function register(body: Json = {}) {
  const r = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], ...body }),
  });
  return { status: r.status, body: (await r.json()) as Json };
}

async function login(username: string, password: string) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(r.status, 200);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await r.json()) as Json;
  return { cookie, csrf: csrf as string };
}

const authzParams = (clientId: string, challenge: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 'st-123',
    code_challenge: challenge, code_challenge_method: 'S256', scope: 'canon:read canon:write', resource: RESOURCE, ...extra,
  });

async function getCode(session: { cookie: string; csrf: string }, clientId: string, challenge: string, decision = 'allow', extra: Record<string, string> = {}) {
  const form = authzParams(clientId, challenge, extra);
  form.set('csrf', session.csrf);
  form.set('decision', decision);
  const r = await fetch(`${base}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: session.cookie },
    body: form,
  });
  assert.equal(r.status, 303);
  return new URL(r.headers.get('location')!);
}

async function token(params: Record<string, string>) {
  const r = await fetch(`${base}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  return { status: r.status, headers: r.headers, body: (await r.json()) as Json };
}

async function fullFlow(clientId: string, session: { cookie: string; csrf: string }, extra: Record<string, string> = {}) {
  const { verifier, challenge } = pkce();
  const loc = await getCode(session, clientId, challenge, 'allow', extra);
  const code = loc.searchParams.get('code')!;
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return t.body;
}

let rpcId = 1;
async function mcp(accessToken: string | null, method: string, params: Json = {}, pathname = '/mcp') {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': '2025-06-18',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const r = await fetch(`${base}${pathname}`, { method: 'POST', redirect: 'manual', headers, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  const text = await r.text();
  let body: Json = {};
  try {
    body = JSON.parse(text);
  } catch { /* non-JSON */ }
  return { status: r.status, headers: r.headers, body };
}

const toolNames = async (at: string) => {
  const r = await mcp(at, 'tools/list');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body.result.tools as Json[]).map((t) => t.name as string);
};

async function call(at: string, name: string, args: Json = {}) {
  const r = await mcp(at, 'tools/call', { name, arguments: args });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const res = r.body.result as Json;
  const text = res.content[0].text as string;
  let parsed: Json | null = null;
  try {
    parsed = JSON.parse(text);
  } catch { /* SDK plain-text error */ }
  return { isError: !!res.isError, text, json: parsed };
}

// ---------------------------------------------------------------- shared state across ordered tests

let client: Json;
let admin: { cookie: string; csrf: string };
let tokens: Json;

// ---------------------------------------------------------------- tests

test('discovery metadata + CORS', async () => {
  for (const p of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const j = (await r.json()) as Json;
    assert.equal(j.resource, RESOURCE);
    assert.deepEqual(j.authorization_servers, [PUBLIC]);
    assert.deepEqual(j.scopes_supported, ['canon:read', 'canon:write']);
    assert.deepEqual(j.bearer_methods_supported, ['header']);
  }
  for (const p of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    const j = (await (await fetch(base + p)).json()) as Json;
    assert.equal(j.issuer, PUBLIC);
    assert.equal(j.authorization_endpoint, `${PUBLIC}/oauth/authorize`);
    assert.equal(j.token_endpoint, `${PUBLIC}/oauth/token`);
    assert.equal(j.registration_endpoint, `${PUBLIC}/oauth/register`);
    assert.equal(j.revocation_endpoint, `${PUBLIC}/oauth/revoke`);
    assert.deepEqual(j.code_challenge_methods_supported, ['S256']);
    assert.equal(j.authorization_response_iss_parameter_supported, true);
  }
  const pre = await fetch(`${base}/oauth/token`, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
  const az = await fetch(`${base}/oauth/authorize?client_id=x`, { redirect: 'manual' });
  assert.equal(az.headers.get('access-control-allow-origin'), null, 'no CORS on /oauth/authorize');
});

test('dynamic client registration validates redirect URIs', async () => {
  for (const bad of ['http://evil.example/cb', 'https://x.example/cb#frag', 'https://user:pw@x.example/cb', 'javascript:alert(1)']) {
    const r = await register({ redirect_uris: [bad] });
    assert.equal(r.status, 400, bad);
    assert.equal(r.body.error, 'invalid_redirect_uri');
  }
  const loop = await register({ redirect_uris: ['http://127.0.0.1:33418/callback'] });
  assert.equal(loop.status, 201);
  const conf = await register({ token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(conf.status, 201);
  assert.ok(conf.body.client_secret, 'confidential client gets a secret');
  const r = await register();
  assert.equal(r.status, 201);
  assert.match(r.body.client_id, /^canon-/);
  assert.equal(r.body.client_secret, undefined);
  assert.equal(r.body.token_endpoint_auth_method, 'none');
  assert.deepEqual(r.body.redirect_uris, [REDIRECT]);
  assert.equal(typeof r.body.client_id_issued_at, 'number');
  client = r.body;
  const stored = all<Json>('SELECT client_secret_hash FROM oauth_clients WHERE client_id = ?', conf.body.client_id)[0];
  assert.notEqual(stored.client_secret_hash, conf.body.client_secret, 'only the hash is stored');
});

test('authorize: open-redirect protection, PKCE required, login redirect', async () => {
  const { challenge } = pkce();
  // unknown client -> error page, no redirect
  let r = await fetch(`${base}/oauth/authorize?${authzParams('canon-nope', challenge)}`, { redirect: 'manual' });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('location'), null);
  // unregistered redirect -> error page, no redirect
  r = await fetch(`${base}/oauth/authorize?${authzParams(client.client_id, challenge, { redirect_uri: 'https://evil.example/cb' })}`, { redirect: 'manual' });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('location'), null);
  // missing PKCE -> redirect back with error + state + iss
  const p = authzParams(client.client_id, challenge);
  p.delete('code_challenge');
  r = await fetch(`${base}/oauth/authorize?${p}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  let loc = new URL(r.headers.get('location')!);
  assert.equal(loc.origin + loc.pathname, REDIRECT);
  assert.equal(loc.searchParams.get('error'), 'invalid_request');
  assert.equal(loc.searchParams.get('state'), 'st-123');
  assert.equal(loc.searchParams.get('iss'), PUBLIC);
  // plain method rejected
  r = await fetch(`${base}/oauth/authorize?${authzParams(client.client_id, challenge, { code_challenge_method: 'plain' })}`, { redirect: 'manual' });
  assert.equal(new URL(r.headers.get('location')!).searchParams.get('error'), 'invalid_request');
  // wrong resource
  r = await fetch(`${base}/oauth/authorize?${authzParams(client.client_id, challenge, { resource: 'https://other.example/mcp' })}`, { redirect: 'manual' });
  assert.equal(new URL(r.headers.get('location')!).searchParams.get('error'), 'invalid_target');
  // no session -> login
  const q = authzParams(client.client_id, challenge);
  r = await fetch(`${base}/oauth/authorize?${q}`, { redirect: 'manual' });
  assert.equal(r.status, 302);
  loc = new URL(r.headers.get('location')!, base);
  assert.equal(loc.pathname, '/login');
  assert.equal(loc.searchParams.get('next'), `/oauth/authorize?${q}`);
});

test('consent page, CSRF, deny and allow', async () => {
  admin = await login('admin', 'correct-horse-1');
  const { challenge } = pkce();
  const r = await fetch(`${base}/oauth/authorize?${authzParams(client.client_id, challenge)}`, { redirect: 'manual', headers: { Cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  const html = await r.text();
  assert.match(html, /Claude/);
  assert.match(html, /claude\.ai/);
  assert.match(html, /not been verified/);
  assert.match(html, /Members register/);
  assert.match(html, /会友名册/);
  assert.match(html, /Pastor Admin/);
  assert.match(html, /Settings → AI \/ MCP/);
  assert.ok(html.includes(admin.csrf), 'csrf embedded');

  // bad CSRF
  const form = authzParams(client.client_id, challenge);
  form.set('csrf', 'wrong');
  form.set('decision', 'allow');
  const bad = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { Cookie: admin.cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('location'), null);

  const denied = await getCode(admin, client.client_id, challenge, 'deny');
  assert.equal(denied.searchParams.get('error'), 'access_denied');
  assert.equal(denied.searchParams.get('state'), 'st-123');
  assert.equal(denied.searchParams.get('iss'), PUBLIC);

  const ok = await getCode(admin, client.client_id, challenge);
  assert.equal(ok.origin + ok.pathname, REDIRECT);
  assert.ok(ok.searchParams.get('code'));
  assert.equal(ok.searchParams.get('state'), 'st-123');
  assert.equal(ok.searchParams.get('iss'), PUBLIC);
});

test('token: bad PKCE verifier rejected', async () => {
  const { challenge } = pkce();
  const loc = await getCode(admin, client.client_id, challenge);
  const t = await token({ grant_type: 'authorization_code', code: loc.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: pkce().verifier });
  assert.equal(t.status, 400);
  assert.equal(t.body.error, 'invalid_grant');
  const u = await token({ grant_type: 'password', username: 'a', password: 'b', client_id: client.client_id });
  assert.equal(u.body.error, 'unsupported_grant_type');
});

test('token: code exchange, then replay is rejected and kills the tokens', async () => {
  const { verifier, challenge } = pkce();
  const loc = await getCode(admin, client.client_id, challenge);
  const code = loc.searchParams.get('code')!;
  const params = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: client.client_id, code_verifier: verifier, resource: RESOURCE };
  const t = await token(params);
  assert.equal(t.status, 200);
  assert.equal(t.headers.get('cache-control'), 'no-store');
  assert.equal(t.headers.get('pragma'), 'no-cache');
  assert.equal(t.body.token_type, 'Bearer');
  assert.equal(t.body.expires_in, 3600);
  assert.equal(t.body.scope, 'canon:read canon:write');
  assert.ok(t.body.refresh_token);
  assert.equal((await mcp(t.body.access_token, 'tools/list')).status, 200);
  const stored = all<Json>('SELECT token_hash FROM oauth_tokens');
  assert.ok(!stored.some((s) => s.token_hash === t.body.access_token), 'tokens are stored hashed');

  const replay = await token(params);
  assert.equal(replay.status, 400);
  assert.equal(replay.body.error, 'invalid_grant');
  assert.equal((await mcp(t.body.access_token, 'tools/list')).status, 401, 'replay revoked the family');
  const rf = await token({ grant_type: 'refresh_token', refresh_token: t.body.refresh_token, client_id: client.client_id });
  assert.equal(rf.body.error, 'invalid_grant');
});

test('MCP: initialize, tools/list, tools/call over Streamable HTTP', async () => {
  tokens = await fullFlow(client.client_id, admin);
  const init = await mcp(tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.status, 200, JSON.stringify(init.body));
  assert.equal(init.body.result.serverInfo.name, 'canon');
  assert.match(init.body.result.instructions, /L10n/);
  assert.match(init.body.result.instructions, /members: read only/);

  const names = await toolNames(tokens.access_token);
  for (const n of ['canon_find_services', 'canon_create_service', 'canon_edit_order', 'canon_search_library', 'canon_get_rota', 'canon_find_people', 'canon_list_coworkers', 'canon_find_groups']) {
    assert.ok(names.includes(n), n);
  }
  const listed = (await mcp(tokens.access_token, 'tools/list')).body.result.tools as Json[];
  assert.ok(listed.length <= 26, `${listed.length} tools`);
  const rm = listed.find((t) => t.name === 'canon_edit_order')!;
  assert.equal(rm.annotations.destructiveHint, true);
  assert.equal(listed.find((t) => t.name === 'canon_find_services')!.annotations.readOnlyHint, true);
  const schemas = JSON.stringify(listed.map((t) => t.inputSchema));
  assert.ok(!schemas.includes('9007199254740991') && !schemas.includes('$schema'), 'compact schemas');

  const created = await call(tokens.access_token, 'canon_create_service', { date: '2026-10-11', title: { en: 'Morning Worship', zh: '主日崇拜' } });
  assert.equal(created.isError, false, created.text);
  const sid = created.json!.data.service.id;
  const add = await call(tokens.access_token, 'canon_edit_order', { service_id: sid, ops: [{ op: 'add', item: { kind: 'scripture', scripture_ref: 'Psalm 23' } }] });
  assert.equal(add.isError, false, add.text);
  const readingId = add.json!.data.results[0].item_id;
  await call(tokens.access_token, 'canon_edit_order', { service_id: sid, ops: [{ op: 'add', item: { kind: 'prayer' }, position: 0 }] });
  const moved = await call(tokens.access_token, 'canon_edit_order', { service_id: sid, ops: [{ op: 'move', item_id: readingId, position: 0 }] });
  assert.equal(moved.json!.data.items[0].id, readingId);

  const list = await call(tokens.access_token, 'canon_find_services', {});
  assert.equal(list.json!.ok, true);
  assert.equal(list.json!.data.length, 1);
  assert.equal(list.json!.data[0].item_count, 2);
  assert.equal((await call(tokens.access_token, 'canon_find_services', { q: 'morning' })).json!.data.length, 1);
  assert.equal((await call(tokens.access_token, 'canon_find_services', { q: 'evensong' })).json!.data.length, 0);
  const detail = await call(tokens.access_token, 'canon_get_service', { id: sid });
  assert.equal(detail.json!.data.items.length, 2);
  assert.ok(Array.isArray(detail.json!.data.warnings));
  const text = await call(tokens.access_token, 'canon_get_service', { id: sid, format: 'text' });
  assert.match(text.json!.data.text, /Morning Worship/);

  const missing = await call(tokens.access_token, 'canon_get_service', { id: 9999 });
  assert.equal(missing.isError, true);
  assert.equal(missing.json!.ok, false);

  // trailing slash variant works without a redirect; GET is 405
  assert.equal((await mcp(tokens.access_token, 'tools/list', {}, '/mcp/')).status, 200);
  assert.equal((await fetch(`${base}/mcp`, { headers: { Authorization: `Bearer ${tokens.access_token}` } })).status, 405);
});

test('canon_edit_order: add + move + remove in one call; a bad op applies nothing', async () => {
  const at = tokens.access_token;
  const c = await call(at, 'canon_create_service', { date: '2026-10-18' });
  const sid = c.json!.data.service.id;
  const seed = await call(at, 'canon_edit_order', {
    service_id: sid,
    ops: [{ op: 'add', item: { kind: 'prayer' } }, { op: 'add', item: { kind: 'sermon' } }, { op: 'add', item: { kind: 'offering' } }],
  });
  assert.equal(seed.isError, false, seed.text);
  const [prayer, sermon, offering] = seed.json!.data.results.map((r: Json) => r.item_id);

  const r = await call(at, 'canon_edit_order', {
    service_id: sid,
    ops: [
      { op: 'add', item: { kind: 'scripture', scripture_ref: 'John 1:1-5' }, position: 0 },
      { op: 'move', item_id: offering, position: 1 },
      { op: 'remove', item_id: prayer },
      { op: 'update', item_id: sermon, item: { duration_min: 30 } },
    ],
  });
  assert.equal(r.isError, false, r.text);
  const order = r.json!.data.items as Json[];
  assert.deepEqual(order.map((i) => i.kind), ['scripture', 'offering', 'sermon']);
  assert.deepEqual(order.map((i) => i.position), [0, 1, 2]);
  assert.equal(order[2].duration_min, 30);
  assert.deepEqual(r.json!.data.results.map((x: Json) => x.op), ['add', 'move', 'remove', 'update']);

  // atomicity: the valid add and move are rolled back because two other ops fail
  const bad = await call(at, 'canon_edit_order', {
    service_id: sid,
    ops: [
      { op: 'add', item: { kind: 'music' } },
      { op: 'move', item_id: sermon, position: 0 },
      { op: 'remove', item_id: prayer },
      { op: 'update', item_id: 999999, item: { notes: 'x' } },
    ],
  });
  assert.equal(bad.isError, true);
  assert.match(bad.json!.error, /2 of 4 operations failed/);
  assert.deepEqual(bad.json!.errors.map((e: Json) => [e.index, e.op]), [[2, 'remove'], [3, 'update']]);
  const after = await call(at, 'canon_get_service', { id: sid });
  assert.deepEqual(after.json!.data.items.map((i: Json) => i.kind), ['scripture', 'offering', 'sermon'], 'nothing applied');

  // an item of another service is rejected; add without kind is a per-op error
  const firstSvcItem = all<Json>('SELECT id FROM service_items WHERE service_id != ? LIMIT 1', sid)[0].id;
  const other = await call(at, 'canon_edit_order', { service_id: sid, ops: [{ op: 'remove', item_id: firstSvcItem }, { op: 'add', item: { title: { en: 'x' } } }] });
  assert.equal(other.isError, true);
  assert.match(other.json!.errors[0].error, /not in service/);
  assert.match(other.json!.errors[1].error, /kind is required/);

  // each batch is audited once, with its op types
  const rows = all<Json>(`SELECT * FROM mcp_audit WHERE tool = 'canon_edit_order' AND args LIKE '%999999%'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ok, 0);
  assert.match(rows[0].args, /"op":"move"/);
});

test('canon_create_service copy_from duplicates a service', async () => {
  const at = tokens.access_token;
  const src = (await call(at, 'canon_find_services', { from: '2026-10-18', to: '2026-10-18' })).json!.data[0];
  const cp = await call(at, 'canon_create_service', { date: '2026-10-25', copy_from: src.id, preacher: 'Rev. Lee' });
  assert.equal(cp.isError, false, cp.text);
  assert.equal(cp.json!.data.service.preacher, 'Rev. Lee');
  assert.equal(cp.json!.data.service.status, 'draft');
  assert.equal(cp.json!.data.items.length, 3);
  const both = await call(at, 'canon_create_service', { date: '2026-11-01', copy_from: src.id, template_id: 1 });
  assert.equal(both.isError, true);
});

test('canon_update_rota: batch assign / set_status / unassign / autofill, all or nothing', async () => {
  const at = tokens.access_token;
  const sid = (await call(at, 'canon_find_services', { from: '2026-10-18', to: '2026-10-18' })).json!.data[0].id;
  const team = vol.teams.insert({ name: { en: 'Ushers', zh: '招待' } });
  const role = vol.roles.insert({ team_id: team.id, name: { en: 'Usher', zh: '招待员' }, needed: 2 });
  const a = reg.people.insert({ first_name: 'Anna', last_name: 'Ong', status: 'member' });
  const b = reg.people.insert({ first_name: 'Ben', last_name: 'Goh', status: 'member' });
  const c = reg.people.insert({ first_name: 'Cara', last_name: 'Teo', status: 'member' });
  vol.setRoleMembers(role.id, [a.id, b.id, c.id]);

  const r1 = await call(at, 'canon_update_rota', {
    ops: [
      { op: 'assign', service_id: sid, role_id: role.id, person_id: a.id },
      { op: 'set_status', service_id: sid, role_id: role.id, person_id: a.id, status: 'confirmed' },
    ],
  });
  assert.equal(r1.isError, false, r1.text);
  const asgId = r1.json!.data.results[0].assignment_id;
  assert.equal(r1.json!.data.results[1].status, 'confirmed');
  assert.ok(r1.json!.data.warnings.some((w: Json) => w.type === 'unfilled' && w.service_id === sid));

  // atomicity: a valid assign followed by bad ops changes nothing
  const bad = await call(at, 'canon_update_rota', {
    ops: [{ op: 'assign', service_id: sid, role_id: role.id, person_id: b.id }, { op: 'unassign', assignment_id: 999999 }, { op: 'set_status', assignment_id: asgId }],
  });
  assert.equal(bad.isError, true);
  assert.deepEqual(bad.json!.errors.map((e: Json) => e.index), [1, 2]);
  assert.match(bad.json!.errors[1].error, /status is required/);
  assert.equal(all('SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ?', sid, b.id).length, 0, 'assign rolled back');

  const r2 = await call(at, 'canon_update_rota', { ops: [{ op: 'unassign', assignment_id: asgId }, { op: 'autofill', service_ids: [sid] }] });
  assert.equal(r2.isError, false, r2.text);
  assert.equal(r2.json!.data.results[1].created.length, 2, 'both empty slots filled');
  const left = all<Json>('SELECT person_id FROM assignments WHERE service_id = ? AND role_id = ?', sid, role.id);
  assert.equal(left.length, 2);

  const rota = await call(at, 'canon_get_rota', { from: '2026-10-01', to: '2026-10-31' });
  const ushers = rota.json!.data.teams.find((t: Json) => t.id === team.id);
  assert.equal(ushers.roles[0].qualified.length, 3);
  assert.equal(ushers.members.length, 3);
  assert.equal(rota.json!.data.services.find((s: Json) => s.id === sid).assignments.length, 2);
  const mine = await call(at, 'canon_get_rota', { person_id: left[0].person_id, from: '2026-10-01' });
  assert.equal(mine.json!.data.schedule.length, 1);
  assert.equal(mine.json!.data.teams[0].team_id, team.id);

  const un = await call(at, 'canon_set_unavailability', { person_id: a.id, start_date: '2026-10-20', end_date: '2026-10-27', reason: 'trip' });
  assert.equal(un.isError, false, un.text);
  const backwards = await call(at, 'canon_set_unavailability', { person_id: a.id, start_date: '2026-10-27', end_date: '2026-10-20' });
  assert.equal(backwards.isError, true);
  const gone = await call(at, 'canon_set_unavailability', { action: 'remove', id: un.json!.data.id });
  assert.equal(gone.json!.data.removed, un.json!.data.id);

  const auditRow = all<Json>(`SELECT args FROM mcp_audit WHERE tool = 'canon_update_rota' AND ok = 1 AND args LIKE '%autofill%'`);
  assert.equal(auditRow.length, 1, 'one audit row per batch');
});

test('library: search, get with parts, save song with hymnal numbers', async () => {
  const at = tokens.access_token;
  const s = await call(at, 'canon_save_song', {
    fields: { title: { en: 'Old Hundredth Zqxv' }, category: 'doxology', stanzas: [{ label: '1', text: { en: 'Praise God' } }] },
  });
  assert.equal(s.isError, false, s.text);
  assert.equal(s.json!.data.created, true);
  const noTitle = await call(at, 'canon_save_song', { fields: { author: 'x' } });
  assert.equal(noTitle.isError, true);
  const t = await call(at, 'canon_save_text', {
    fields: { category: 'catechism', title: { en: 'Mini Catechism Zqxv' }, body: {}, parts: [1, 2, 3, 4].map((n) => ({ label: String(n), body: { en: `L: Q${n}?\nC: A${n}.` } })) },
  });
  assert.equal(t.isError, false, t.text);
  const found = await call(at, 'canon_search_library', { q: 'Zqxv' });
  assert.equal(found.json!.data.songs[0].id, s.json!.data.id);
  const texts = await call(at, 'canon_search_library', { q: 'Mini Catechism Zqxv', type: 'texts' });
  assert.equal(texts.json!.data.songs, undefined);
  assert.equal(texts.json!.data.texts[0].part_count, 4);
  const idx = await call(at, 'canon_get_library_item', { type: 'text', id: t.json!.data.id, parts: 'index' });
  assert.equal(idx.json!.data.parts.length, 4);
  assert.equal(idx.json!.data.parts[1].first_line, 'Q2?');
  const sel = await call(at, 'canon_get_library_item', { type: 'text', id: t.json!.data.id, parts: '2-3' });
  assert.deepEqual(sel.json!.data.stanzas, ['2', '3']);
  const song = await call(at, 'canon_get_library_item', { type: 'song', id: s.json!.data.id });
  assert.equal(song.json!.data.stanzas.length, 1);

  const hymnal = lib.hymnals.insert({ name: { en: 'Zqxv Hymnal' }, abbr: 'ZQ' });
  const upd = await call(at, 'canon_save_song', { id: s.json!.data.id, hymnal_numbers: [{ hymnal_id: hymnal.id, number: '77' }] });
  assert.equal(upd.isError, false, upd.text);
  assert.deepEqual(upd.json!.data.hymnals, [{ hymnal_id: hymnal.id, abbr: 'ZQ', number: '77' }]);
  assert.equal((await call(at, 'canon_search_library', { q: 'ZQ 77', type: 'songs' })).json!.data.songs[0].id, s.json!.data.id);
  assert.equal((await call(at, 'canon_search_library', { q: 'zqxv', type: 'hymnals' })).json!.data.hymnals[0].song_count, 1);
  const book = await call(at, 'canon_get_library_item', { type: 'hymnal', id: hymnal.id });
  assert.deepEqual(book.json!.data.songs.map((x: Json) => [x.number, x.song_id]), [['77', s.json!.data.id]]);
  const dupe = await call(at, 'canon_save_song', { id: s.json!.data.id, fields: { author: 'Ken' }, hymnal_numbers: [{ hymnal_id: hymnal.id, number: '1' }, { hymnal_id: hymnal.id, number: '2' }] });
  assert.equal(dupe.isError, true);
  assert.equal(lib.songs.get(s.json!.data.id).author ?? null, null, 'song update rolled back with the bad numbers');
});

test('401 carries WWW-Authenticate with resource_metadata', async () => {
  const none = await mcp(null, 'tools/list');
  assert.equal(none.status, 401);
  const h = none.headers.get('www-authenticate')!;
  assert.match(h, /^Bearer /);
  assert.ok(h.includes(`resource_metadata="${PUBLIC}/.well-known/oauth-protected-resource/mcp"`));
  assert.ok(!h.includes('invalid_token'));
  const bad = await mcp('not-a-real-token', 'tools/list');
  assert.equal(bad.status, 401);
  assert.match(bad.headers.get('www-authenticate')!, /error="invalid_token"/);
});

test('refresh rotation; reuse of an old refresh token kills the family', async () => {
  const t = await fullFlow(client.client_id, admin);
  const r1 = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.body.refresh_token, t.refresh_token);
  assert.equal((await mcp(r1.body.access_token, 'tools/list')).status, 200);
  const r2 = await token({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: client.client_id });
  assert.equal(r2.status, 200);
  // reuse r1's (rotated) refresh token
  const reuse = await token({ grant_type: 'refresh_token', refresh_token: r1.body.refresh_token, client_id: client.client_id });
  assert.equal(reuse.body.error, 'invalid_grant');
  assert.equal((await mcp(r2.body.access_token, 'tools/list')).status, 401);
  const r3 = await token({ grant_type: 'refresh_token', refresh_token: r2.body.refresh_token, client_id: client.client_id });
  assert.equal(r3.body.error, 'invalid_grant');
});

test('module "off" hides tools; "read" hides write tools', async () => {
  setMcp({ modules: { members: 'off' } });
  let names = await toolNames(tokens.access_token);
  assert.ok(!names.some((n) => ['canon_find_people', 'canon_get_person', 'canon_save_person', 'canon_save_household'].includes(n)));
  const hidden = await call(tokens.access_token, 'canon_find_people', {});
  assert.equal(hidden.isError, true, 'hidden tools behave as unknown');

  setMcp({ modules: { members: 'read', services: 'read' } });
  names = await toolNames(tokens.access_token);
  assert.ok(names.includes('canon_find_people'));
  assert.ok(!names.includes('canon_save_person'));
  assert.ok(names.includes('canon_find_services'));
  for (const w of ['canon_create_service', 'canon_edit_order', 'canon_update_service']) assert.ok(!names.includes(w), w);
  const blocked = await call(tokens.access_token, 'canon_create_service', { date: '2026-12-25' });
  assert.equal(blocked.isError, true);
  setMcp({ modules: { services: 'write' } });
  assert.ok((await toolNames(tokens.access_token)).includes('canon_create_service'));
});

test('viewer role is capped to read-only', async () => {
  const viewer = await login('viewer', 'correct-horse-2');
  const t = await fullFlow(client.client_id, viewer);
  assert.equal(t.scope, 'canon:read');
  const names = await toolNames(t.access_token);
  assert.ok(names.includes('canon_find_services'));
  assert.ok(!names.includes('canon_create_service'));
  assert.ok(!names.includes('canon_edit_order'));
});

test('member PII redaction and audit log without member values', async () => {
  const soon = new Date(Date.now() + 3 * 86400_000);
  const bday = `1980-${String(soon.getUTCMonth() + 1).padStart(2, '0')}-${String(soon.getUTCDate()).padStart(2, '0')}`;
  const p = reg.people.insert({
    first_name: 'Ming Hua', last_name: 'Lim', native_name: '林明华', phone: '+65 9123 4567', email: 'minghua@example.org',
    address: '1 Secret Lane', birth_date: bday, notes: 'pastoral note', status: 'member',
  });
  setMcp({ modules: { members: 'read' }, expose_member_pii: false });
  const noBday = await call(tokens.access_token, 'canon_find_people', { view: 'birthdays' });
  assert.equal(noBday.isError, true, 'birthdays need PII');

  const s = await call(tokens.access_token, 'canon_find_people', { q: 'Lim' });
  assert.equal(s.json!.data.people.length, 1);
  assert.ok(!s.text.includes('9123') && !s.text.includes('minghua@'), s.text);
  const g = await call(tokens.access_token, 'canon_get_person', { id: p.id });
  assert.equal(g.json!.data.native_name, '林明华');
  for (const leak of ['9123', 'minghua@', 'Secret Lane', bday, 'pastoral note']) assert.ok(!g.text.includes(leak), leak);
  // searching by phone must not reveal the owner
  const byPhone = await call(tokens.access_token, 'canon_find_people', { q: '9123' });
  assert.equal(byPhone.json!.data.people.length, 0);

  setMcp({ expose_member_pii: true });
  const g2 = await call(tokens.access_token, 'canon_get_person', { id: p.id });
  assert.equal(g2.json!.data.phone, '+65 9123 4567');
  const bd = await call(tokens.access_token, 'canon_find_people', { view: 'birthdays', days: 7 });
  assert.equal(bd.json!.data.length, 1);
  setMcp({ expose_member_pii: false });

  const rows = all<Json>('SELECT * FROM mcp_audit');
  assert.ok(rows.length > 5);
  const blob = JSON.stringify(rows);
  for (const leak of ['9123', 'minghua', 'Lim"']) assert.ok(!blob.includes(leak), `audit leaked ${leak}`);
  const getRow = rows.find((r) => r.tool === 'canon_get_person')!;
  assert.equal(getRow.args, '["id"]');
  assert.equal(getRow.module, 'members');
  assert.equal(getRow.ok, 1);
  const svcRow = rows.find((r) => r.tool === 'canon_create_service' && r.ok === 1)!;
  assert.match(svcRow.args, /2026-10-11/, 'non-member modules store argument values');
  assert.ok(rows.some((r) => r.ok === 0 && r.tool === 'canon_find_people'), 'failed (hidden) call audited');
  assert.ok(rows.every((r) => r.user_id && r.client_id === client.client_id));
});

test('grants list / revoke, and RFC 7009 revocation', async () => {
  const t = await fullFlow(client.client_id, admin);
  const gs = listGrants();
  assert.ok(gs.length >= 1);
  assert.equal(gs[0].client_name, 'Claude');
  assert.ok(gs.some((g) => g.user_name === 'Pastor Admin'));
  const grant = all<Json>('SELECT grant_id FROM oauth_tokens WHERE token_hash = ?', crypto.createHash('sha256').update(t.access_token).digest('hex'))[0].grant_id;
  revokeGrant(grant);
  assert.equal((await mcp(t.access_token, 'tools/list')).status, 401);

  const t2 = await fullFlow(client.client_id, admin);
  const rv = await fetch(`${base}/oauth/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t2.refresh_token, client_id: client.client_id }) });
  assert.equal(rv.status, 200);
  assert.deepEqual(await rv.json(), {});
  assert.equal((await mcp(t2.access_token, 'tools/list')).status, 401);
});

test('MCP disabled -> 503 on /mcp and a notice instead of consent', async () => {
  setMcp({ enabled: false });
  const r = await mcp(tokens.access_token, 'tools/list');
  assert.equal(r.status, 503);
  const { challenge } = pkce();
  const page = await fetch(`${base}/oauth/authorize?${authzParams(client.client_id, challenge)}`, { redirect: 'manual', headers: { Cookie: admin.cookie } });
  assert.equal(page.status, 503);
  assert.match(await page.text(), /turned off/);
  setMcp({ enabled: true });
  assert.equal((await mcp(tokens.access_token, 'tools/list')).status, 200);
});
