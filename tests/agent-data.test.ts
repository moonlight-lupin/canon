// What AI agents see and what is kept about them, from the Daedalus Workshop's code study of 0.19.10: access checks
// fail closed, the activity log keeps no personal data, personal fields are marked where they are defined, a module
// switched off hides its tools and playbooks alike, and the tools' hints and outputs say what they do. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-agent-data-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
process.env.CANON_PUBLIC_URL = 'http://127.0.0.1';
delete process.env.CANON_TRUST_PROXY;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { TOOLS } = await import('../server/mcp.ts');
const { canRead } = await import('../server/mcp-tools/common.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';

const ALL = { members: 'write', coworkers: 'write', volunteers: 'write', services: 'write', templates: 'write', library: 'write', groups: 'write', records: 'write', contributions: 'read', lending: 'write', equipment: 'write', bookkeeping: 'write', admin: 'read' } as const;
function setMcp(patch: Json) {
  const cur = getSettings().mcp;
  updateSettings({ mcp: { ...cur, ...patch, modules: { ...cur.modules, ...(patch.modules ?? {}) } } });
}

before(async () => {
  await createUser({ username: 'admin', display_name: 'Admin Example', password: 'correct-horse-1', role: 'admin' });
  setMcp({ enabled: true, modules: { ...ALL }, expose_member_pii: false, visitors: 'contact' });
  server = createApp().listen(0, '127.0.0.1');
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

// ---------------------------------------------------------------- a connection, as claude.ai makes one

let accessToken = '';
async function connect(username = 'admin', password = 'correct-horse-1') {
  const reg = (await (await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Assistant (test)', redirect_uris: [REDIRECT] }) })).json()) as Json;
  const l = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const cookie = l.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = (await l.json()) as Json;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', scope: 'canon:read canon:write', csrf, decision: 'allow' });
  const a = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: form });
  const code = new URL(a.headers.get('location')!).searchParams.get('code')!;
  const t = (await (await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier }) })).json()) as Json;
  assert.ok(t.access_token, JSON.stringify(t));
  return t.access_token as string;
}
let rpcId = 1;
async function rpc(method: string, params: Json = {}, token = accessToken) {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }) });
  assert.equal(r.status, 200);
  return (await r.json()) as Json;
}
async function call(name: string, args: Json = {}, token = accessToken) {
  const res = (await rpc('tools/call', { name, arguments: args }, token)).result as Json;
  const text = (res.content as Json[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* plain-text error from the SDK */ }
  return { isError: !!res.isError, text, json };
}

// ---------------------------------------------------------------- 5. fail closed

test('5. a tool handler run without a connection’s access (no auth, no levels) shows nothing it would have to check', async () => {
  const report = TOOLS.find((t) => t.name === 'canon_attendance_report')!;
  assert.throws(() => report.handler({ kind: 'meeting' }, {} as never), /not available/, 'meetings are refused without a connection to check');
  assert.equal(canRead({} as never, 'contributions'), false, 'no levels: no module is readable');
  const record = TOOLS.find((t) => t.name === 'canon_list_service_records')!;
  const out = (await record.handler({}, {} as never)) as Json;
  assert.ok(out.services.every((s: Json) => !('offering_total' in s)), 'no offerings without a connection to check');
});

// ---------------------------------------------------------------- 8. the AI activity log

test('8. the AI activity log keeps which fields a call used, and values only of fields marked safe (ids, dates, kinds)', async () => {
  accessToken = await connect();
  const svc = await call('canon_create_service', { date: '2031-05-04' });
  assert.equal(svc.isError, false, svc.text);
  const sid = svc.json!.data.service.id as number;
  const saved = await call('canon_save_service_record', {
    service_id: sid, attendance: 120, notes: 'Pray for the Example family (hospital)',
    add_visitors: [{ name: 'Vera Visitor', source: 'walked in', contact: 'vera@example.org +65 8000 0001' }],
  });
  assert.equal(saved.isError, false, saved.text);
  const { all } = await import('../server/db.ts');
  const row = all<Json>("SELECT args FROM mcp_audit WHERE tool = 'canon_save_service_record'")[0];
  for (const leak of ['Vera', 'vera@', '8000', 'hospital', 'walked in']) assert.ok(!row.args.includes(leak), `audit kept ${leak}: ${row.args}`);
  const args = JSON.parse(row.args);
  assert.equal(args.service_id, sid, 'ids are kept: which record the agent touched');
  assert.equal(args.attendance, 120, 'a count is kept');
  assert.ok('notes' in args && args.notes !== 'Pray for the Example family (hospital)', 'the field is named, its text withheld');
  assert.deepEqual(Object.keys(args.add_visitors[0]).sort(), ['contact', 'name', 'source']);
  const create = all<Json>("SELECT args FROM mcp_audit WHERE tool = 'canon_create_service'")[0];
  assert.equal(JSON.parse(create.args).date, '2031-05-04', 'a date is kept');
});

// ---------------------------------------------------------------- 22. rejected calls stay in the log

test('22. calls the MCP library rejects before any tool runs are still logged (fails if an SDK upgrade stops it)', async () => {
  accessToken ||= await connect();
  const { all } = await import('../server/db.ts');
  const unknown = await call('canon_no_such_tool', { id: 1 });
  assert.equal(unknown.isError, true);
  const invalid = await call('canon_get_service_record', { service_id: 'not a number' });
  assert.equal(invalid.isError, true);
  const rows = all<Json>("SELECT tool, ok, args, error FROM mcp_audit WHERE tool IN ('canon_no_such_tool', 'canon_get_service_record') AND ok = 0");
  assert.ok(rows.some((r) => r.tool === 'canon_no_such_tool'), 'an unknown tool is logged (the SDK answers it; no handler of ours runs)');
  assert.ok(rows.some((r) => r.tool === 'canon_get_service_record' && /service_id/.test(r.error ?? '')), 'arguments the SDK refuses are logged with why');
});
