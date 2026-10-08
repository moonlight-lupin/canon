// Encryption (0.19.0): a Canon whose keys this computer can't unlock (another Windows account, a new computer)
// starts locked — one page asking for the recovery key, on this computer only — and with the right key starts as usual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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

test('keys this computer can’t unlock: Canon starts locked, and the recovery key opens it', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-locked-'));
  const db = path.join(tmp, 'canon.db');
  const env = { ...process.env, CANON_DB: db, CANON_ENCRYPT: '1', CANON_KEY_PROTECT: 'file', CANON_LOG: 'off', CANON_HOST: '127.0.0.1', NODE_TEST_CONTEXT: '' };
  let child: ChildProcess | null = null;
  try {
    // an encrypted Canon with a recovery key (made as the first start and onboarding would)
    const recovery = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
      "await import('./server/db.ts'); const K = await import('./server/lib/keys.ts'); console.log(K.makeRecoveryKey().key)"], { cwd: root, env, encoding: 'utf8' }).trim().split('\n').pop()!;
    assert.match(recovery, /^([0-9A-Z]{5}-){7}[0-9A-Z]{5}$/);
    // as if on another computer: the keys' lock to this one no longer opens
    const kf = path.join(tmp, 'keys.json');
    const k = JSON.parse(fs.readFileSync(kf, 'utf8'));
    k.machine.db = Buffer.from('locked to someone else').toString('base64');
    fs.writeFileSync(kf, JSON.stringify(k));

    const port = await freePort();
    child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.ts'], { cwd: root, env: { ...env, CANON_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (d) => { out += d; });
    child.stderr!.on('data', (d) => { out += d; });
    const wait = async (what: RegExp) => {
      const end = Date.now() + 60_000;
      while (!what.test(out)) {
        if (child!.exitCode !== null || Date.now() > end) throw new Error(`waited for ${what}:\n${out}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    };
    await wait(/Canon is locked/);
    const base = `http://127.0.0.1:${port}`;
    let about = await (await fetch(`${base}/api/about`)).json();
    assert.equal(about.locked, true, 'the tray icon can say so');
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 423);
    assert.match(await page.text(), /recovery key/);
    const unlock = (key: string) => fetch(`${base}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ key }) });
    const wrong = await unlock('AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA-AAAAA');
    assert.equal(wrong.status, 400);
    assert.match(await wrong.text(), /not the recovery key/);
    assert.equal((await unlock(recovery.toLowerCase())).status, 200);
    await wait(/Canon running/);
    about = await (await fetch(`${base}/api/about`)).json();
    assert.equal(about.locked, undefined);
    assert.equal(about.name, 'Canon');
    // locked to this computer again: the next start needs no one
    assert.notEqual(JSON.parse(fs.readFileSync(kf, 'utf8')).machine.db, k.machine.db);
  } finally {
    child?.kill();
    await new Promise((r) => setTimeout(r, 300));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
