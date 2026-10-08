// 0.19.5 (roadmap 0.20.0, item 1): disaster recovery through Google Drive. The office's Canon sends its backup
// package to Drive; the office computer is then lost with everything on it. A new computer gets a new Canon, connects
// to the same Drive, copies the backup back and restores it with the recovery key — in the app, and by hand — and
// the members and the archived year read back. Google is a stand-in (tests/fixtures/fake-google.ts); each computer is
// a separate process with its own data folder. Fictional data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-drive-recovery-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const drive = path.join(tmp, 'google-drive');
const envFor = (dir: string): NodeJS.ProcessEnv => ({
  ...process.env, CANON_DB: path.join(dir, 'data', 'canon.db'), CANON_ENCRYPT: '1', CANON_KEY_PROTECT: 'file', CANON_LOG: 'off', NODE_TEST_CONTEXT: '',
});
const node = (env: NodeJS.ProcessEnv, code: string) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { cwd: root, env, encoding: 'utf8' });
const lastJson = (out: string) => JSON.parse(out.trim().split('\n').pop()!);
// a Canon on one computer, signed in to the church's Google Drive (the stand-in)
const CONNECT = `
const g = await import('./server/lib/gdrive.ts');
g.setDriveFetch((await import('./tests/fixtures/fake-google.ts')).fakeGoogle(${JSON.stringify(drive)}));
g.setDriveClient('1234-abc.apps.googleusercontent.com', 'GOCSPX-abcdefghijk');
await g.startDriveConnect();
if ((await g.pollDriveConnect()).state !== 'connected') throw new Error('not connected');`;
const READ = `
const D = await import('./server/db.ts');
const A = await import('./server/repo/archive.ts');
const ruth = D.get("SELECT last_name FROM people WHERE first_name = 'Ruth'");
const out = { last_name: ruth?.last_name ?? null, encrypted: D.dbEncrypted(), archived: A.archivedRecords(2015)[0]?.attendance ?? null, years: A.listArchives().map((a) => a.year) };
D.closeDb();
console.log(JSON.stringify(out));`;

// ---------------------------------------------------------------- the office: data, an archived year, a backup sent to Drive
const office = path.join(tmp, 'office');
const made = node(envFor(office), `
const { seed } = await import('./server/seed/index.ts');
await seed();
const S = await import('./server/repo/settings.ts');
S.updateSettings({ backup: { ...S.getSettings().backup, dir: ${JSON.stringify(path.join(office, 'backups'))}, auto: 'off' } });
const D = await import('./server/db.ts');
D.run("INSERT INTO people (first_name, last_name) VALUES ('Ruth', 'Fictional-Drive')");
const svc = await import('./server/repo/services.ts');
const R = await import('./server/repo/records.ts');
const { asActor } = await import('./server/lib/actor.ts');
const s = svc.createService({ date: '2015-06-07' }).service;
asActor({ user_id: null, user_name: 'Test', via: 'web' }, () => R.saveRecord(s.id, { attendance: 27 }, { name: 'Test', admin: true, money: true }));
(await import('./server/repo/archive.ts')).runArchive(false, 5);
const recovery = (await import('./server/lib/keys.ts')).makeRecoveryKey().key;
${CONNECT}
const B = await import('./server/repo/backups.ts');
const b = B.createBackup();
await g.syncToDrive({ name: b.name, path: b.path }, () => undefined);
const st = g.driveStatus();
D.closeDb();
console.log(JSON.stringify({ recovery, sent: st.last?.ok === true, name: b.name }));`);
const setup = made.status === 0 ? lastJson(made.stdout) as { recovery: string; sent: boolean; name: string } : null;

test('the office’s backup reaches Drive whole: one encrypted package with the database and the archived year', () => {
  assert.ok(setup, made.stderr + made.stdout);
  assert.equal(setup!.sent, true);
  const files = JSON.parse(fs.readFileSync(path.join(drive, 'files.json'), 'utf8')) as { id: string; name: string }[];
  assert.deepEqual(files.map((f) => f.name), [setup!.name]);
  const bytes = fs.readFileSync(path.join(drive, files[0].id));
  assert.equal(bytes.subarray(0, 9).toString(), 'CANONENC3', 'a backup package');
  assert.ok(!bytes.includes(Buffer.from('Fictional-Drive')), 'Google sees nothing readable');
  // the office computer is lost: nothing of it is used from here on
  fs.rmSync(office, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

test('a new computer: a new Canon connects to the same Drive, copies the backup back and restores it with the recovery key', () => {
  assert.ok(setup, made.stderr);
  const fresh = path.join(tmp, 'new-computer');
  const r = node(envFor(fresh), `
const { seed } = await import('./server/seed/index.ts');
await seed();
const S = await import('./server/repo/settings.ts');
S.updateSettings({ backup: { ...S.getSettings().backup, dir: ${JSON.stringify(path.join(fresh, 'backups'))}, auto: 'off' } });
${CONNECT}
const B = await import('./server/repo/backups.ts');
const list = await g.listDriveBackups();
const f = await g.downloadFromDrive(list[0].id);
const file = B.saveUpload(f.data); // Settings → Backups → Google Drive → Copy to this computer
let refused = '';
try { await B.restoreBackup(file); } catch (e) { refused = e.message; }
await B.restoreBackup(file, ${JSON.stringify(setup!.recovery)});
console.log(JSON.stringify({ copied: f.name, refused }));`);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = lastJson(r.stdout);
  assert.equal(out.copied, setup!.name);
  assert.match(out.refused, /recovery key/i, 'this computer’s own keys don’t open it: the recovery key does');
  const back = lastJson(node(envFor(fresh), READ).stdout);
  assert.deepEqual(back, { last_name: 'Fictional-Drive', encrypted: true, archived: 27, years: [2015] });
});

test('or by hand: the file copied from Drive, restored with Canon stopped (npm run restore-backup) on another new computer', () => {
  assert.ok(setup, made.stderr);
  const other = path.join(tmp, 'by-hand');
  const files = JSON.parse(fs.readFileSync(path.join(drive, 'files.json'), 'utf8')) as { id: string; name: string }[];
  fs.mkdirSync(path.join(other, 'downloads'), { recursive: true });
  const file = path.join(other, 'downloads', files[0].name);
  fs.copyFileSync(path.join(drive, files[0].id), file); // downloaded from drive.google.com in a browser
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/restore-backup.ts', file, setup!.recovery], { cwd: root, env: envFor(other), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /recovery key/i, 'new keys on this computer, and their recovery key shown once');
  const back = lastJson(node(envFor(other), READ).stdout);
  assert.deepEqual(back, { last_name: 'Fictional-Drive', encrypted: true, archived: 27, years: [2015] });
});
