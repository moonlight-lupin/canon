// Service templates: archive / restore (editors), delete only archived ones (administrators), never Canon's built-in
// ones; the church default cannot be archived. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-templates-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const svc = await import('../server/repo/services.ts');
const { updateSettings } = await import('../server/repo/settings.ts');
const { db } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<'admin' | 'editor', Session> = {} as never;

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  for (const role of ['admin', 'editor'] as const) createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-7', role });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  as.admin = await login('admin');
  as.editor = await login('editor');
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('service templates: archive, restore, delete archived (administrators), built-ins and the default protected', async () => {
  const own = svc.templates.insert({ name: { en: 'Test evening service' }, description: {}, items: [] });
  const builtin = svc.templates.find(Number(db.prepare("SELECT id FROM templates WHERE key = 'lords-day-morning'").get()?.id ?? 0))
    ?? svc.templates.insert({ key: 'lords-day-morning', name: { en: 'Test built-in' }, description: {}, items: [] });

  const list = await call(as.editor, 'GET', '/templates');
  assert.equal(list.body.find((x: Json) => x.id === builtin.id).builtin, true);
  assert.equal(list.body.find((x: Json) => x.id === own.id).builtin, false);

  // not archived: nobody deletes it
  assert.equal((await call(as.admin, 'DELETE', `/templates/${own.id}`)).status, 400);
  // editors archive and restore
  assert.equal((await call(as.editor, 'PUT', `/templates/${own.id}/hidden`, { hidden: true })).status, 200);
  assert.equal((await call(as.editor, 'GET', `/templates/${own.id}`)).body.hidden, true);
  // only administrators delete, and only archived, non-built-in templates
  assert.equal((await call(as.editor, 'DELETE', `/templates/${own.id}`)).status, 403);
  assert.equal((await call(as.editor, 'PUT', `/templates/${builtin.id}/hidden`, { hidden: true })).status, 200);
  assert.equal((await call(as.admin, 'DELETE', `/templates/${builtin.id}`)).status, 400, 'built-in');
  assert.equal((await call(as.editor, 'PUT', `/templates/${builtin.id}/hidden`, { hidden: false })).status, 200, 'restored');
  assert.equal((await call(as.admin, 'DELETE', `/templates/${own.id}`)).status, 200);
  assert.equal((await call(as.admin, 'GET', `/templates/${own.id}`)).status, 404);

  // the church default can't be archived; making an archived template the default restores it
  updateSettings({ default_service_template_id: builtin.id });
  assert.equal((await call(as.editor, 'PUT', `/templates/${builtin.id}/hidden`, { hidden: true })).status, 400);
  const other = svc.templates.insert({ name: { en: 'Test archived' }, description: {}, items: [], hidden: true });
  assert.equal((await call(as.admin, 'PUT', '/templates-default', { template_id: other.id })).status, 200);
  assert.equal(svc.templates.get(other.id).hidden, false);
});
