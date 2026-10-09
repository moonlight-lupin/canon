// Setting up a new Canon: the first administrator (with a church name) is taken to Getting started, which offers
// Canon's library; nothing from it is added until they choose. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-setup-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { seed } = await import('../server/seed/index.ts');
const { get } = await import('../server/db.ts');
const { setupCode } = await import('../server/lib/setup-code.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let server: Server;
let base = '';
let cookie = '';
let csrf = '';

async function call(method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie, 'X-CSRF-Token': csrf } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  if (setCookie) cookie = setCookie;
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}

before(async () => {
  await seed(); // what every start does
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('the first administrator goes through Getting started, even with a church name', async () => {
  // the setup code Canon printed when it started (0.19.9)
  const r = await call('POST', '/setup', { setup_code: setupCode(), username: 'pastor', display_name: 'Pastor Lim', password: 'correct-horse-9', church_name: { en: 'Grace Fellowship (test)' }, languages: ['en', 'zh'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  csrf = r.body.csrf;
  assert.equal((await call('GET', '/settings')).body.onboarded, false);
});

test("Canon's library is offered, not added: the administrator chooses the parts", async () => {
  const st = (await call('GET', '/library/bundled')).body;
  assert.equal(st.songs.chosen, false);
  assert.equal(st.songs.in_library, 0);
  assert.ok(st.songs.bundled > 300);
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM songs')!.n, 0);

  const add = await call('POST', '/library/bundled', { parts: ['songs', 'texts'] });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.equal(add.body.added.songs, st.songs.bundled);
  assert.equal(add.body.added.templates, 0);
  assert.equal(add.body.standards, null, 'the Westminster Standards only when asked for');
  const after = (await call('GET', '/library/bundled')).body;
  assert.equal(after.songs.in_library, after.songs.bundled);
  assert.equal(after.templates.chosen, false);
});
