// Settings → Security and Storage: who viewed member records (member page, AI, CSV export; repeat views within ten
// minutes count once), last sign-in, the checklist, and the storage report. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-security-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const reg = await import('../server/repo/registers.ts');
const { db, get } = await import('../server/db.ts');
const { TOOLS } = await import('../server/mcp.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor', Session> = {} as never;
let pid = 0;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-6' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text);
  } catch { /* csv */ }
  return { status: r.status, json, text };
}

before(async () => {
  for (const role of ['admin', 'editor'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-6', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const role of ['admin', 'editor'] as const) as[role] = await login(role);
  pid = reg.people.insert({ first_name: 'Viewed', last_name: 'Person', status: 'member' }).id;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('signing in records when; a member page, an AI read and a CSV export are logged (repeats within 10 minutes once)', async () => {
  assert.ok(get<{ t: string | null }>("SELECT last_login_at AS t FROM users WHERE username = 'editor'")?.t, 'last sign-in recorded');
  await call(as.editor, 'GET', `/people/${pid}`);
  await call(as.editor, 'GET', `/people/${pid}`);
  await call(as.editor, 'GET', '/csv/members/export.csv');
  const tool = TOOLS.find((t) => t.name === 'canon_get_person')!;
  await tool.handler({ id: pid }, { auth: { user: { id: 99, display_name: 'Agent User', role: 'editor' }, scopes: new Set(['canon:read']) }, pii: false } as never);

  assert.equal((await call(as.editor, 'GET', '/member-views')).status, 403);
  const r = await call(as.admin, 'GET', '/member-views');
  assert.equal(r.status, 200);
  const rows = r.json!.rows as Json[];
  assert.deepEqual(rows.map((x) => [x.via, x.user_name, x.person_name ?? x.detail]).sort(), [
    ['export', 'Test editor', 'members CSV'], ['mcp', 'Agent User', 'Viewed Person'], ['web', 'Test editor', 'Viewed Person'],
  ].sort());
  const only = await call(as.admin, 'GET', '/member-views?via=web');
  assert.equal(only.json!.rows.length, 1);
  const csv = await call(as.admin, 'GET', '/member-views.csv');
  assert.ok(csv.text.replace(/^﻿/, '').startsWith('Time (UTC),Who,How,Member,Detail'));
  assert.ok(csv.text.includes('Member page') && csv.text.includes('Viewed Person'));
});

test('the checklist: plain items with a status; confirming disk encryption turns it to ok', async () => {
  let r = await call(as.admin, 'GET', '/security');
  const keys = (r.json!.checklist as Json[]).map((c) => c.key);
  for (const k of ['disk', 'backups', 'backup_place', 'backup_encryption', 'public', 'admins', 'stale', 'ai', 'retention']) assert.ok(keys.includes(k), k);
  assert.equal((r.json!.checklist as Json[]).find((c) => c.key === 'disk')!.status, 'todo');
  assert.equal((r.json!.checklist as Json[]).find((c) => c.key === 'admins')!.status, 'warn', 'one administrator only');
  assert.equal((await call(as.editor, 'PUT', '/security', { disk_encryption: true })).status, 403);
  await call(as.admin, 'PUT', '/security', { disk_encryption: true });
  r = await call(as.admin, 'GET', '/security');
  assert.equal((r.json!.checklist as Json[]).find((c) => c.key === 'disk')!.status, 'ok');
});

test('storage: database size, what uses it, backups and free space', async () => {
  const r = await call(as.admin, 'GET', '/storage');
  assert.equal(r.status, 200);
  assert.ok(r.json!.database.bytes > 0);
  assert.ok(Array.isArray(r.json!.tables) && r.json!.tables.length > 0);
  assert.equal(typeof r.json!.backups.count, 'number');
  assert.equal((await call(as.editor, 'GET', '/storage')).status, 403);
});
