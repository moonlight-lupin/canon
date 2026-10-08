// 0.19.4: checking for updates and installing them from inside Canon (server/lib/updates.ts, scripts/updater.mjs,
// scripts/launcher.mjs). Nothing here talks to GitHub: a stand-in answers, and updates are applied to scratch folders.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-updates-'));
process.env.CANON_DB = path.join(tmp, 'data', 'canon.db');

// a stand-in for GitHub's API: the latest release, and its archive
let release: Record<string, unknown> = {};
let archive = Buffer.alloc(0);
const gh = http.createServer((req, res) => {
  if (req.url === '/repos/moonlight-lupin/canon/releases/latest') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(release));
  if (req.url === '/archive.tar.gz') return void res.writeHead(200, { 'Content-Type': 'application/gzip' }).end(archive);
  res.writeHead(404).end();
});
await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));
const ghBase = `http://127.0.0.1:${(gh.address() as AddressInfo).port}`;
process.env.CANON_UPDATE_SOURCE = ghBase;

const U = await import('../scripts/updater.mjs');
const updates = await import('../server/lib/updates.ts');
const { seed } = await import('../server/seed/index.ts');
const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { db } = await import('../server/db.ts');

/** A .tar.gz as GitHub makes them: a top folder, a pax comment, long names in pax headers. */
function tarGz(files: { name: string; data: string | Buffer; type?: string; mode?: number }[], top = 'moonlight-lupin-canon-abc1234') {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string, mode = 0o644) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 99), 0, 'utf8');
    h.write(mode.toString(8).padStart(7, '0'), 100);
    h.write('0000000', 108);
    h.write('0000000', 116);
    h.write(size.toString(8).padStart(11, '0'), 124);
    h.write('00000000000', 136);
    h.write('        ', 148);
    h.write(type, 156);
    h.write('ustar\u000000', 257);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\u0000 ', 148);
    return h;
  };
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
  const comment = Buffer.from('52 comment=abc1234abc1234abc1234abc1234abc1234abc1\n');
  blocks.push(header('pax_global_header', comment.length, 'g'), pad(comment));
  blocks.push(header(`${top}/`, 0, '5', 0o755));
  for (const f of files) {
    const name = `${top}/${f.name}`;
    const data = Buffer.from(f.data);
    if (name.length > 99) {
      const rec = ` path=${name}\n`;
      let len = rec.length + 2;
      if (String(len).length + rec.length !== len) len = String(len + 1).length + rec.length;
      const pax = Buffer.from(`${len}${rec}`);
      blocks.push(header('PaxHeader', pax.length, 'x'), pad(pax));
    }
    blocks.push(header(name, data.length, f.type ?? '0', f.mode), pad(data));
  }
  blocks.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(blocks));
}
const pkg = (version: string) => JSON.stringify({ name: 'canon', version });
const write = (root: string, name: string, data: string) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), data);
};
const read = (root: string, name: string) => (fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8') : null);

let server: http.Server;
let base = '';
before(async () => {
  await seed();
  createUser({ username: 'admin', display_name: 'Test admin', password: 'correct-horse-7', role: 'admin' });
  createUser({ username: 'ed', display_name: 'Test editor', password: 'correct-horse-7', role: 'editor' });
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  gh.close();
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('versions compare as numbers', () => {
  assert.ok(U.compareVersions('0.19.10', '0.19.4') > 0);
  assert.ok(U.compareVersions('v0.20.0', '0.19.9') > 0);
  assert.equal(U.compareVersions('v0.19.4', '0.19.4'), 0);
  assert.ok(U.compareVersions('0.19.3', '0.19.4') < 0);
});

test('a release archive: files under the top folder, long names; links and names outside the folder are refused', () => {
  const long = `src/${'deep/'.repeat(25)}file.ts`;
  const files = U.readTarGz(tarGz([{ name: 'package.json', data: pkg('9.9.9') }, { name: long, data: 'x' }, { name: 'start-canon.command', data: '#!/bin/bash', mode: 0o755 }]));
  assert.deepEqual(files.map((f) => f.name), ['package.json', long, 'start-canon.command']);
  assert.equal(files[2].mode & 0o111, 0o111);
  assert.throws(() => U.readTarGz(tarGz([{ name: 'package.json', data: pkg('9.9.9') }, { name: '../evil.txt', data: 'x' }])), /outside Canon's folder/);
  assert.throws(() => U.readTarGz(tarGz([{ name: 'package.json', data: pkg('9.9.9') }, { name: 'link', data: '', type: '2' }])), /other than files/);
  assert.throws(() => U.readTarGz(tarGz([{ name: 'README.md', data: 'x' }])), /not a Canon release/);
});

test('a download: the release written over the folder, data and local settings untouched; rolled back exactly', () => {
  const root = path.join(tmp, 'install-download');
  write(root, 'package.json', pkg('1.0.0'));
  write(root, 'server/a.ts', 'old a');
  write(root, 'server/gone.ts', 'removed in 1.1.0');
  write(root, 'canon.local.bat', 'set CANON_PORT=5018');
  write(root, 'data/canon.db', 'the church data');
  write(root, 'start-canon.bat', '@echo off\r\nold\r\n');
  const v11 = U.readTarGz(tarGz([
    { name: 'package.json', data: pkg('1.1.0') }, { name: 'server/a.ts', data: 'new a' }, { name: 'server/new.ts', data: 'new file' },
    { name: 'server/gone.ts', data: 'removed in 1.1.0' }, { name: 'data/canon.db', data: 'NOT the church data' }, { name: 'canon.local.bat', data: 'set CANON_PORT=1' },
    { name: 'start-canon.bat', data: '@echo off\nnew\n' },
  ]));
  const r1 = U.applyFiles(root, v11);
  assert.equal(read(root, 'server/a.ts'), 'new a');
  assert.equal(read(root, 'server/new.ts'), 'new file');
  assert.equal(read(root, 'data/canon.db'), 'the church data', 'the data is never part of an update');
  assert.equal(read(root, 'canon.local.bat'), 'set CANON_PORT=5018', 'nor this computer’s settings');
  assert.equal(read(root, 'start-canon.bat'), '@echo off\r\nnew\r\n', 'batch files get CRLF');
  assert.deepEqual(r1.added, ['server/new.ts']);
  // the next update knows 1.1.0's files: one the release no longer has is removed (and kept aside)
  const v12 = U.readTarGz(tarGz([{ name: 'package.json', data: pkg('1.2.0') }, { name: 'server/a.ts', data: 'newer a' }, { name: 'server/new.ts', data: 'new file' }]));
  const r2 = U.applyFiles(root, v12);
  assert.equal(read(root, 'server/gone.ts'), null);
  assert.deepEqual(r2.removed.sort(), ['server/gone.ts', 'start-canon.bat']);
  // preparing 1.2.0 failed: back to 1.1.0 exactly
  assert.equal(U.rollback(root, { from: '1.1.0', to: '1.2.0', kind: 'download', at: '', status: 'installing', files: r2 }), true);
  assert.equal(read(root, 'server/a.ts'), 'new a');
  assert.equal(read(root, 'server/gone.ts'), 'removed in 1.1.0');
  assert.equal(read(root, 'start-canon.bat'), '@echo off\r\nnew\r\n');
  assert.equal(read(root, 'package.json'), pkg('1.1.0'));
  assert.equal(read(root, 'data/canon.db'), 'the church data');
});

const hasGit = spawnSync('git', ['--version']).status === 0;
test('a git copy: the release’s tag checked out (fast-forward), back on failure; a copy with its own changes is left alone', { skip: !hasGit && 'git is not installed' }, () => {
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(tmp, 'origin');
  fs.mkdirSync(origin, { recursive: true });
  g(origin, 'init', '-q', '-b', 'main');
  g(origin, 'config', 'user.email', 'test@example.org');
  g(origin, 'config', 'user.name', 'Test');
  write(origin, 'package.json', pkg('1.0.0'));
  g(origin, 'add', '.');
  g(origin, 'commit', '-q', '-m', 'one');
  g(origin, 'tag', 'v1.0.0');
  const copy = path.join(tmp, 'install-git');
  g(tmp, 'clone', '-q', origin, copy);
  write(origin, 'package.json', pkg('1.1.0'));
  g(origin, 'commit', '-q', '-am', 'two');
  g(origin, 'tag', 'v1.1.0');
  const before = g(copy, 'rev-parse', 'HEAD');
  assert.equal(U.installKind(copy), 'git');
  const rec = U.applyGit(copy, 'v1.1.0', origin);
  assert.equal(rec.previous, before);
  assert.equal(rec.branch, 'main');
  assert.equal(read(copy, 'package.json'), pkg('1.1.0'));
  U.rollback(copy, { from: '1.0.0', to: '1.1.0', kind: 'git', at: '', status: 'installing', git: rec });
  assert.equal(g(copy, 'rev-parse', 'HEAD'), before);
  assert.equal(read(copy, 'package.json'), pkg('1.0.0'));
  // changes of its own: refused, nothing changed
  write(copy, 'package.json', pkg('1.0.0-mine'));
  assert.match(U.gitProblem(copy)!, /changes of its own/);
  assert.throws(() => U.applyGit(copy, 'v1.1.0', origin), /changes of its own/);
  assert.equal(read(copy, 'package.json'), pkg('1.0.0-mine'));
});

test('the launcher: prepares, starts, installs an update when Canon asks (exit 75), stops for good on 0', () => {
  const root = path.join(tmp, 'launcher-ok');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const f of ['launcher.mjs', 'updater.mjs']) fs.copyFileSync(path.join(import.meta.dirname, '..', 'scripts', f), path.join(root, 'scripts', f));
  write(root, 'check.mjs', "import fs from 'node:fs'; fs.appendFileSync('checks.txt', 'check\\n');");
  // a stand-in for Canon: the first time it asks for an update to be installed, then stops on purpose
  write(root, 'canon.mjs', "import fs from 'node:fs'; fs.appendFileSync('runs.txt', process.env.CANON_LAUNCHER + '\\n'); process.exit(fs.readFileSync('runs.txt', 'utf8').split('\\n').length > 2 ? 0 : 75);");
  const r = spawnSync(process.execPath, ['scripts/launcher.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, CANON_LAUNCHER_SERVER: 'canon.mjs', CANON_LAUNCHER_CHECK: 'check.mjs', CANON_DB: path.join(root, 'data', 'canon.db'), CANON_BACKGROUND: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(read(root, 'checks.txt'), 'check\ncheck\n', 'prepared again for the update');
  assert.equal(read(root, 'runs.txt'), '1\n1\n', 'Canon knows it was started by the launcher');
  assert.match(r.stdout, /Installing the update/);
});

test('the launcher: an update that can’t be prepared is rolled back, and the previous version started', () => {
  const root = path.join(tmp, 'launcher-rollback');
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const f of ['launcher.mjs', 'updater.mjs']) fs.copyFileSync(path.join(import.meta.dirname, '..', 'scripts', f), path.join(root, 'scripts', f));
  write(root, 'package.json', pkg('1.0.0'));
  write(root, 'check.mjs', "import fs from 'node:fs'; process.exit(fs.existsSync('broken.txt') ? 1 : 0);");
  write(root, 'canon.mjs', "import fs from 'node:fs'; fs.writeFileSync('ran.txt', fs.readFileSync('package.json', 'utf8')); process.exit(0);");
  // "1.1.0" was put in place by Canon, and needs a file that makes preparing it fail
  const rec = U.applyFiles(root, U.readTarGz(tarGz([{ name: 'package.json', data: pkg('1.1.0') }, { name: 'broken.txt', data: 'x' }, { name: 'check.mjs', data: fs.readFileSync(path.join(root, 'check.mjs')) }, { name: 'canon.mjs', data: fs.readFileSync(path.join(root, 'canon.mjs')) }])));
  U.writePending(root, { from: '1.0.0', to: '1.1.0', kind: 'download', at: new Date().toISOString(), status: 'installing', files: rec });
  const r = spawnSync(process.execPath, ['scripts/launcher.mjs'], {
    cwd: root, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, CANON_LAUNCHER_SERVER: 'canon.mjs', CANON_LAUNCHER_CHECK: 'check.mjs', CANON_DB: path.join(root, 'data', 'canon.db'), CANON_BACKGROUND: '1' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /going back to Canon 1\.0\.0/);
  assert.equal(read(root, 'ran.txt'), pkg('1.0.0'), 'the previous version was started');
  assert.equal(read(root, 'broken.txt'), null);
  const p = U.readPending(root)!;
  assert.equal(p.status, 'rolled-back', 'Canon tells administrators when it starts');
  assert.ok(p.error);
});

test('About Canon for administrators: the latest release from GitHub, and why this Canon can’t install it itself', async () => {
  const login = async (username: string) => {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
    return { Cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), 'X-CSRF-Token': ((await r.json()) as { csrf: string }).csrf };
  };
  const admin = await login('admin');
  const ed = await login('ed');
  release = { tag_name: 'v99.0.0', name: 'v99.0.0 — Test', html_url: 'https://example.org/release', body: '- Something new (fictional)', published_at: '2030-01-01T00:00:00Z', tarball_url: `${ghBase}/archive.tar.gz` };
  const checked = await (await fetch(`${base}/api/updates/check`, { method: 'POST', headers: admin })).json();
  assert.equal(checked.latest.version, '99.0.0');
  assert.equal(checked.newer, true);
  assert.equal(checked.why_not, 'development', 'tests run outside production');
  assert.equal((await fetch(`${base}/api/updates`, { headers: ed })).status, 403, 'administrators only');
  // installing is refused here (not started by the launcher), and nothing changes
  const inst = await fetch(`${base}/api/updates/install`, { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(inst.status, 400);
  assert.equal(updates.currentVersion(), JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version);
  // offline: the last good answer is kept, with the error
  gh.close();
  const off = await updates.checkNow();
  assert.equal(off.latest?.version, '99.0.0');
  assert.ok(off.error);
  // switching the daily check off
  const auto = await (await fetch(`${base}/api/updates/auto`, { method: 'PUT', headers: { ...admin, 'Content-Type': 'application/json' }, body: JSON.stringify({ auto: false }) })).json();
  assert.equal(auto.auto, false);
});
