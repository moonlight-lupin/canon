// Stopping Canon properly (0.18.0): the tray icon's Exit asks Canon over HTTP, from this computer, with the token
// Canon writes at start-up; anything else is refused. Canon then closes the database and exits with 0, so the
// launcher and the Windows task don't take it for a crash. (`docker stop` / SIGTERM ends the same way on Linux.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const freePort = () => new Promise<number>((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as net.AddressInfo).port;
    s.close(() => resolve(p));
  });
});

/** A real Canon (server/index.ts) on its own database and port, started and waited for. */
async function startCanon() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-control-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, CANON_DB: path.join(tmp, 'canon.db'), CANON_PORT: String(port), CANON_HOST: '127.0.0.1', CANON_LOG: 'off', NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (d) => { out += d; });
  child.stderr!.on('data', (d) => { out += d; });
  const deadline = Date.now() + 60_000;
  while (!out.includes('Canon running')) {
    if (child.exitCode !== null || Date.now() > deadline) throw new Error(`Canon did not start:\n${out}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  const file = path.join(root, 'data', 'run', `control-${port}.json`);
  return { child, port, file, tmp, output: () => out };
}

const exited = (child: ChildProcess) => new Promise<number | null>((resolve) => {
  if (child.exitCode !== null) resolve(child.exitCode);
  else child.on('exit', (code) => resolve(code));
});

test('the tray stops Canon with its token, and nobody else can', async () => {
  const c = await startCanon();
  try {
    const { token, port, pid } = JSON.parse(fs.readFileSync(c.file, 'utf8'));
    assert.equal(port, c.port);
    assert.equal(pid, c.child.pid);
    const url = `http://127.0.0.1:${c.port}/control/stop`;
    // a wrong token, a GET, a request through a proxy: refused, and Canon keeps running
    assert.equal((await fetch(url, { method: 'POST', headers: { 'X-Canon-Control': 'x'.repeat(64) } })).status, 404);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    assert.equal((await fetch(url, { headers: { 'X-Canon-Control': token } })).status, 404);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'X-Canon-Control': token, 'X-Forwarded-For': '203.0.113.9' } })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${c.port}/api/about`)).status, 200);
    // the tray's Exit
    const r = await fetch(url, { method: 'POST', headers: { 'X-Canon-Control': token } });
    assert.equal(r.status, 202);
    assert.equal(await exited(c.child), 0, c.output());
    assert.match(c.output(), /Canon has stopped/);
    assert.ok(!fs.existsSync(c.file), 'the token is removed');
    // the database was checkpointed and closed: nothing left in the write-ahead log
    const wal = path.join(c.tmp, 'canon.db-wal');
    assert.ok(!fs.existsSync(wal) || fs.statSync(wal).size === 0);
  } finally {
    if (c.child.exitCode === null) c.child.kill();
    fs.rmSync(c.file, { force: true });
  }
});

// Windows has no SIGTERM to send another process (kill() ends it at once); `docker stop` runs on Linux
test('SIGTERM (docker stop) stops Canon properly', { skip: process.platform === 'win32' }, async () => {
  const c = await startCanon();
  try {
    c.child.kill('SIGTERM');
    assert.equal(await exited(c.child), 0, c.output());
    assert.match(c.output(), /Canon is stopping \(SIGTERM\)/);
  } finally {
    if (c.child.exitCode === null) c.child.kill('SIGKILL');
    fs.rmSync(c.file, { force: true });
  }
});
