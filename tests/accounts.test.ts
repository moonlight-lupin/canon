// Accounts (0.15): every account belongs to a church member, except an external guest's (read-only, e.g. an
// auditor) and — reminded until they link it — the first administrator's; a church can require two-step sign-in
// for every account. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-accounts-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { seed } = await import('../server/seed/index.ts');
const T = await import('../server/lib/totp.ts');
const { securityChecklist } = await import('../server/repo/security.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';

async function call(who: Session | null, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: who.cookie, 'X-CSRF-Token': who.csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json, cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}
async function login(username: string, password: string): Promise<Session> {
  const r = await call(null, 'POST', '/login', { username, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { cookie: r.cookie, csrf: r.body.csrf };
}

let boss: Session;
let memberA = 0;
let memberB = 0;

before(async () => {
  await seed();
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const setup = await call(null, 'POST', '/setup', { username: 'founder', display_name: 'Founder Tan', password: 'correct-horse-7', church_name: { en: 'Hope Chapel (test)' } });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  boss = { cookie: setup.cookie, csrf: setup.body.csrf };
  memberA = (await call(boss, 'POST', '/people', { first_name: 'Ruth', last_name: 'Lim', status: 'member' })).body.id;
  memberB = (await call(boss, 'POST', '/people', { first_name: 'Boaz', last_name: 'Ong', status: 'member' })).body.id;
});
after(() => server.close());

test('the first administrator may stay unlinked, with a reminder; the checklist says so', async () => {
  const me = (await call(boss, 'GET', '/me')).body.user;
  assert.equal(me.first_admin, true);
  assert.equal(me.person_id, null);
  const row = (await call(boss, 'GET', '/users')).body.find((u: Json) => u.username === 'founder');
  assert.equal(row.first_admin, true);
  assert.equal(row.needs_member, false);
  assert.equal(securityChecklist().find((c) => c.key === 'member_links')?.status, 'todo');
});

test('every other account belongs to a church member — once', async () => {
  const none = await call(boss, 'POST', '/users', { username: 'ruth', display_name: 'Ruth', password: 'correct-horse-8', role: 'viewer' });
  assert.equal(none.status, 400);
  assert.match(none.body.error, /member/);
  const ok = await call(boss, 'POST', '/users', { username: 'ruth', display_name: 'Ruth', password: 'correct-horse-8', role: 'viewer', person_id: memberA });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.person_id, memberA);
  const twice = await call(boss, 'POST', '/users', { username: 'ruth2', display_name: 'Ruth again', password: 'correct-horse-8', role: 'editor', person_id: memberA });
  assert.equal(twice.status, 400);
  assert.match(twice.body.error, /already has an account/);
  // unlinking a member's account is refused; the first administrator may unlink (or link) their own
  assert.equal((await call(boss, 'PATCH', `/users/${ok.body.id}`, { person_id: null })).status, 400);
  const founder = (await call(boss, 'GET', '/me')).body.user;
  assert.equal((await call(boss, 'PATCH', `/users/${founder.id}`, { person_id: memberB })).status, 200);
  assert.equal(securityChecklist().find((c) => c.key === 'member_links')?.status, 'ok');
  assert.equal((await call(boss, 'PATCH', `/users/${founder.id}`, { person_id: null })).status, 200);
});

test('an external guest: no member, read-only, never members’ details; the role stays read-only', async () => {
  const g = await call(boss, 'POST', '/users', { username: 'auditor', display_name: 'Auditor (test)', password: 'correct-horse-9', role: 'guest' });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  assert.equal(g.body.person_id, null);
  // a guest account becoming a member's role needs the member
  assert.equal((await call(boss, 'PATCH', `/users/${g.body.id}`, { role: 'viewer' })).status, 400);
  const guest = await login('auditor', 'correct-horse-9');
  assert.equal((await call(guest, 'GET', '/services')).status, 200, 'reads services');
  assert.equal((await call(guest, 'GET', '/people')).status, 403, 'no members');
  assert.equal((await call(guest, 'POST', '/services', { date: '2026-11-01' })).status, 403, 'changes nothing');
  const edit = await call(boss, 'PATCH', '/access-roles/guest', { access: { services: 'edit' } });
  assert.equal(edit.status, 400);
  assert.match(edit.body.error, /read-only/);
  assert.equal((await call(boss, 'PATCH', '/access-roles/guest', { access: { members: 'read' } })).status, 200, 'reading more is the church’s choice');
});

test('two-step sign-in for every account: one without it can only set it up', async () => {
  // the administrator turns it on for themselves first
  const s = (await call(boss, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(boss, 'POST', '/me/two-step/enable', { code: T.totp(s.secret) })).status, 200);
  assert.equal((await call(boss, 'PUT', '/security', { require_all_2fa: true })).status, 200);

  const ruth = await login('ruth', 'correct-horse-8');
  const blocked = await call(ruth, 'GET', '/services');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'two_step_required');
  assert.equal((await call(ruth, 'GET', '/settings')).status, 200, 'the settings, to show why');
  const mine = (await call(ruth, 'POST', '/me/two-step/setup', {})).body;
  assert.equal((await call(ruth, 'POST', '/me/two-step/enable', { code: T.totp(mine.secret) })).status, 200);
  assert.equal((await call(ruth, 'GET', '/services')).status, 200, 'set up: Canon opens');
  assert.equal((await call(ruth, 'POST', '/me/two-step/disable', { password: 'correct-horse-8' })).status, 400, 'can’t turn it off while required');
  assert.equal((await call(boss, 'PUT', '/security', { require_all_2fa: false, require_admin_2fa: false })).status, 200);
});
