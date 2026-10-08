// Restoring by hand with Canon stopped (0.19.1 review, C): `npm run restore-backup` opens the backup, gives it this
// Canon's own key, sets the old database aside and brings back archived years — so an encrypted Canon starts again,
// on the same computer or a new one (with the recovery key). And an explicitly configured key file is that or
// nothing: missing or too short, Canon stops rather than keep readable keys (0.19.1 review, B).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-offline-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const envFor = (dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  ...process.env, CANON_DB: path.join(dir, 'data', 'canon.db'), CANON_ENCRYPT: '1', CANON_KEY_PROTECT: 'file', CANON_LOG: 'off', NODE_TEST_CONTEXT: '', ...extra,
});
const node = (env: NodeJS.ProcessEnv, code: string) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', code], { cwd: root, env, encoding: 'utf8' });
const restore = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/restore-backup.ts', ...args], { cwd: root, env, encoding: 'utf8' });
const lastJson = (out: string) => JSON.parse(out.trim().split('\n').pop()!);

/** What a restored Canon holds: the member as backed up, encrypted, and the archived year readable. */
const CHECK = `
const D = await import('./server/db.ts');
const A = await import('./server/repo/archive.ts');
const ruth = D.get("SELECT last_name FROM people WHERE first_name = 'Ruth'");
console.log(JSON.stringify({ last_name: ruth?.last_name, encrypted: D.dbEncrypted(), archived: A.archivedRecords(2015)[0]?.attendance ?? null }));
D.closeDb();`;

// an encrypted Canon with a member, an archived year, a recovery key and a backup; then changed and stopped
const dirA = path.join(tmp, 'office');
const backups = path.join(dirA, 'backups');
const made = node(envFor(dirA), `
const { seed } = await import('./server/seed/index.ts');
await seed();
const S = await import('./server/repo/settings.ts');
S.updateSettings({ backup: { ...S.getSettings().backup, dir: ${JSON.stringify(backups)}, auto: 'off' } });
const D = await import('./server/db.ts');
D.run("INSERT INTO people (first_name, last_name) VALUES ('Ruth', 'Fictional-Restore')");
const svc = await import('./server/repo/services.ts');
const R = await import('./server/repo/records.ts');
const { asActor } = await import('./server/lib/actor.ts');
const s = svc.createService({ date: '2015-06-07' }).service;
asActor({ user_id: null, user_name: 'Test', via: 'web' }, () => R.saveRecord(s.id, { attendance: 27 }, { name: 'Test', admin: true, money: true }));
(await import('./server/repo/archive.ts')).runArchive(false, 5);
const recovery = (await import('./server/lib/keys.ts')).makeRecoveryKey().key;
const b = (await import('./server/repo/backups.ts')).createBackup();
D.run("UPDATE people SET last_name = 'Changed after the backup' WHERE first_name = 'Ruth'");
D.closeDb();
console.log(JSON.stringify({ backup: b.path, recovery }));`);
const setup = made.status === 0 ? lastJson(made.stdout) as { backup: string; recovery: string } : null;

test('the same computer: an encrypted Canon restored by hand starts again, with the backup’s data and its archived year', () => {
  assert.ok(setup, made.stderr);
  assert.equal(JSON.parse(node(envFor(dirA), CHECK).stdout.trim()).last_name, 'Changed after the backup', 'before');
  const r = restore(envFor(dirA), setup!.backup);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Restored/);
  assert.ok(fs.readdirSync(path.join(dirA, 'data', 'pre-restore')).some((n) => n.startsWith('canon-before-restore-')), 'the database there was is set aside');
  const c = node(envFor(dirA), CHECK);
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(JSON.parse(c.stdout.trim()), { last_name: 'Fictional-Restore', encrypted: true, archived: 27 });
});

test('a new computer, the old data folder lost: the backup folder and the recovery key bring the database and the archived years back', () => {
  assert.ok(setup, made.stderr);
  const dirB = path.join(tmp, 'new-computer');
  fs.cpSync(backups, path.join(dirB, 'usb'), { recursive: true });
  const file = path.join(dirB, 'usb', path.basename(setup!.backup));
  // without the recovery key: this computer's new keys don't open the backup
  const without = restore(envFor(dirB), file);
  assert.notEqual(without.status, 0);
  assert.match(without.stderr, /recovery key/);
  fs.rmSync(path.join(dirB, 'data'), { recursive: true, force: true });
  const r = restore(envFor(dirB), file, setup!.recovery);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /Archived years brought back: canon-archive-2015\.db/);
  assert.match(r.stdout, /RECOVERY KEY[\s\S]*([0-9A-Z]{5}-){7}[0-9A-Z]{5}/, 'a new recovery key for the new keys, shown once');
  const c = node(envFor(dirB), CHECK);
  assert.equal(c.status, 0, c.stderr);
  assert.deepEqual(JSON.parse(c.stdout.trim()), { last_name: 'Fictional-Restore', encrypted: true, archived: 27 });
});

test('an explicitly configured key file that is missing or too short stops Canon; nothing is made in plain', () => {
  for (const [name, setupKey] of [['missing', () => path.join(tmp, 'no-such-key')], ['too short', () => { const f = path.join(tmp, 'short.key'); fs.writeFileSync(f, 'short'); return f; }]] as const) {
    const dir = path.join(tmp, `secret-${name.replace(' ', '-')}`);
    const env = envFor(dir, { CANON_KEY_FILE: setupKey() });
    delete env.CANON_KEY_PROTECT;
    const r = node(env, "await import('./server/db.ts');");
    assert.notEqual(r.status, 0, `${name}: Canon stops`);
    assert.match(r.stderr, /CANON_KEY_FILE/, name);
    assert.ok(!fs.existsSync(path.join(dir, 'data', 'keys.json')), `${name}: no keys written`);
    assert.ok(!fs.existsSync(path.join(dir, 'data', 'canon.db')), `${name}: no database made unencrypted`);
  }
  // a proper key file: the keys are locked with it
  const dir = path.join(tmp, 'secret-ok');
  const keyFile = path.join(tmp, 'good.key');
  fs.writeFileSync(keyFile, Buffer.alloc(32, 7));
  const env = envFor(dir, { CANON_KEY_FILE: keyFile });
  delete env.CANON_KEY_PROTECT;
  const ok = node(env, "const D = await import('./server/db.ts'); console.log(D.dbEncrypted()); D.closeDb();");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'keys.json'), 'utf8')).protection, 'secret');
  // recovery on a computer where that file is gone: refused, not quietly kept in readable form
  const rec = node(env, "const K = await import('./server/lib/keys.ts'); console.log(K.makeRecoveryKey().key);");
  const recovery = rec.stdout.trim().split('\n').pop()!;
  fs.rmSync(keyFile);
  const unlock = node(env, `const K = await import('./server/lib/keys.ts'); try { K.unlockWithRecovery(${JSON.stringify(recovery)}); console.log('unlocked'); } catch (e) { console.log('refused: ' + e.message); }`);
  assert.match(unlock.stdout, /refused: .*can't be used/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'keys.json'), 'utf8')).protection, 'secret', 'the keys stay locked as they were');
});
