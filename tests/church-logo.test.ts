// The church logo (Daedalus Workshop study of 0.19.10): an SVG can carry script, and a pattern check is no parser, so
// new logos are PNG, JPEG or WebP only. An SVG logo uploaded before keeps showing, served so that it can never run as
// a page of its own. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-logo-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { forgetLogo } = await import('../server/routes/design.ts');
const { db, run } = await import('../server/db.ts');

let server: Server;
let base = '';
let admin = { cookie: '', csrf: '' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123"/></svg>');

before(async () => {
  await createUser({ username: 'admin', display_name: 'Admin Example', password: 'correct-horse-1', role: 'admin' });
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'correct-horse-1' }) });
  admin = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as { csrf: string }).csrf };
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const put = (type: string, body: Buffer) => fetch(`${base}/api/assets/logo`, { method: 'PUT', headers: { 'Content-Type': type, Cookie: admin.cookie, 'X-CSRF-Token': admin.csrf }, body: body as unknown as BodyInit });

test('4. a new logo is PNG, JPEG or WebP: an SVG is refused, even a harmless one', async () => {
  const svg = await put('image/svg+xml', SVG);
  assert.equal(svg.status, 415);
  assert.match(((await svg.json()) as { error: string }).error, /PNG, JPEG or WebP/);
  assert.equal((await put('image/png', PNG)).status, 200);
});

test('4. an SVG logo uploaded before keeps showing, but can’t be opened as a page that runs anything', async () => {
  run("INSERT INTO assets (key, mime, data, updated_at) VALUES ('logo', 'image/svg+xml', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data", SVG);
  forgetLogo();
  const r = await fetch(`${base}/api/assets/logo`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/svg+xml');
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="logo\.svg"$/);
  const info = (await (await fetch(`${base}/api/assets/logo/info`)).json()) as { mime: string };
  assert.equal(info.mime, 'image/svg+xml', 'Settings can tell it is an SVG (and suggest a PNG)');
});
