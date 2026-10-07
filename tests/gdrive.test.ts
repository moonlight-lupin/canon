// 0.16.1: backups to the church's own Google Drive — the church's Google client, Google's device sign-in, only
// encrypted backups sent, the newest N kept there, and the connection surviving a restore. Google is played by a
// stand-in here (no internet); fictional data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-gdrive-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const g = await import('../server/lib/gdrive.ts');
const { createBackup, restoreBackup } = await import('../server/repo/backups.ts');
const { db } = await import('../server/db.ts');

after(() => {
  g.setDriveFetch(null);
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---- a pretend Google: the device code, the token, Drive's files
type Call = { method: string; url: string; body?: string };
const calls: Call[] = [];
let approved = false;
let refreshOk = true;
const files: { id: string; name: string; size: string; createdTime: string; parents: string[] }[] = [];
let nextId = 1;
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
g.setDriveFetch((async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = typeof init?.body === 'string' ? init.body : undefined;
  calls.push({ method, url, body });
  if (url.endsWith('/device/code')) return json({ device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
  if (url.endsWith('/token')) {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') === 'refresh_token') return refreshOk ? json({ access_token: 'acc-2', expires_in: 3600 }) : json({ error: 'invalid_grant' }, 400);
    return approved ? json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600 }) : json({ error: 'authorization_pending' }, 428);
  }
  if (url.endsWith('/revoke')) return json({});
  if (url.includes('/about?')) return json({ user: { emailAddress: 'office@example.org' } });
  if (url.includes('/upload/drive/v3/files?uploadType=resumable')) return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-1' } });
  if (url === 'https://upload.example/session-1' && method === 'PUT') {
    const meta = JSON.parse(calls.filter((c) => c.url.includes('uploadType=resumable')).at(-1)!.body!);
    const f = { id: `f${nextId++}`, name: meta.name, size: '1234', createdTime: new Date(Date.now() + nextId * 1000).toISOString(), parents: meta.parents };
    files.push(f);
    return json(f);
  }
  if (url.includes('/drive/v3/files?fields=id') && method === 'POST') return json({ id: 'folder-1' });
  if (url.includes('/drive/v3/files?q=')) return json({ files: [...files].sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1)) });
  const one = url.match(/\/drive\/v3\/files\/([\w-]+)(\?.*)?$/);
  if (one) {
    if (one[1] === 'folder-1') return json({ id: 'folder-1', trashed: false });
    const f = files.find((x) => x.id === one[1]);
    if (method === 'DELETE') {
      files.splice(files.indexOf(f!), 1);
      return new Response(null, { status: 204 });
    }
    if (one[2]?.includes('alt=media')) return new Response(Buffer.from('CANONENC1 pretend backup bytes'));
    return json({ name: f?.name, parents: f?.parents });
  }
  return json({ error: { message: `unexpected ${method} ${url}` } }, 500);
}) as typeof fetch);

test('the church’s Google client, then sign-in with a code at google.com/device', async () => {
  assert.throws(() => g.setDriveClient('not-a-client', 'GOCSPX-abcdefghijk'), /\.apps\.googleusercontent\.com/);
  g.setDriveClient('1234-abc.apps.googleusercontent.com', 'GOCSPX-abcdefghijk');
  assert.deepEqual({ ...g.driveStatus(), last: undefined }, { configured: true, client_id: '1234-abc.apps.googleusercontent.com', connected: false, email: null, connected_at: null, keep: 8, last: undefined });
  const code = await g.startDriveConnect();
  assert.equal(code.user_code, 'ABCD-EFGH');
  assert.match(calls.at(-1)!.body!, /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fdrive\.file/, 'only drive.file');
  assert.equal((await g.pollDriveConnect()).state, 'pending');
  approved = true;
  const r = await g.pollDriveConnect();
  assert.equal(r.state, 'connected');
  assert.equal(r.email, 'office@example.org');
  const st = g.driveStatus();
  assert.equal(st.connected, true);
  assert.ok(!('refresh_token' in st) && !JSON.stringify(st).includes('ref-1') && !JSON.stringify(st).includes('GOCSPX'), 'no secrets in the status');
});

test('only encrypted backups go; the newest N are kept in Drive; one is not sent twice', async () => {
  const dir = path.join(tmp, 'b');
  fs.mkdirSync(dir);
  const plain = path.join(dir, 'canon-2031-01-01-0900.db');
  fs.writeFileSync(plain, 'x');
  await assert.rejects(g.uploadToDrive(plain), /only sends encrypted backups/);
  g.setDriveKeep(2);
  for (const n of ['0901', '0902', '0903']) {
    const f = path.join(dir, `canon-2031-01-01-${n}.db.enc`);
    fs.writeFileSync(f, 'CANONENC1…');
    await g.syncToDrive({ name: path.basename(f), path: f }, () => undefined);
  }
  assert.deepEqual(files.map((f) => f.name).sort(), ['canon-2031-01-01-0902.db.enc', 'canon-2031-01-01-0903.db.enc'], 'the oldest was deleted');
  assert.ok(files.every((f) => f.parents[0] === 'folder-1'), 'in Canon’s folder');
  const uploads = calls.filter((c) => c.method === 'PUT').length;
  await g.syncToDrive({ name: 'canon-2031-01-01-0903.db.enc', path: path.join(dir, 'canon-2031-01-01-0903.db.enc') }, () => undefined);
  assert.equal(calls.filter((c) => c.method === 'PUT').length, uploads, 'already sent: not again');
  assert.equal(g.driveStatus().last?.ok, true);
  // listing and copying back
  const list = await g.listDriveBackups();
  assert.equal(list[0].name, 'canon-2031-01-01-0903.db.enc');
  const got = await g.downloadFromDrive(list[0].id);
  assert.equal(got.data.subarray(0, 9).toString(), 'CANONENC1');
});

test('restoring a backup keeps this computer’s Drive connection; a withdrawn sign-in is reported, not thrown', async () => {
  const before = createBackup(path.join(tmp, 'r'));
  await restoreBackup(before.path);
  assert.equal(g.driveStatus().connected, true, 'still connected after the restore');
  // Google withdrew the sign-in
  refreshOk = false;
  g.setDriveFetch(null); // forget the cached access …
  g.setDriveFetch(((...a: Parameters<typeof fetch>) => (a[0] as string).endsWith('/token') ? Promise.resolve(json({ error: 'invalid_grant' }, 400)) : Promise.resolve(json({}))) as typeof fetch);
  const f = path.join(tmp, 'b', 'canon-2031-01-01-0904.db.enc');
  fs.writeFileSync(f, 'CANONENC1…');
  await g.syncToDrive({ name: path.basename(f), path: f }, () => undefined);
  const st = g.driveStatus();
  assert.equal(st.connected, false);
  assert.equal(st.last?.ok, false);
  assert.match(st.last?.error ?? '', /Connect Google Drive again/);
});
