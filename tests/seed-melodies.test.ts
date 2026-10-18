// 0.21.2: Canon's bundled library brings melodies in numbered notation for four songs of service music. Each draws
// without problems; a new library gets them with the songs; a church that has the song already gets the melody once,
// only where the song has none; a melody it cleared stays cleared unless it asks for the library back; and a melody
// it typed is never touched. The songs are public domain (no church data).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-seed-melodies-'));
process.env.CANON_DB = path.join(tmp, 'test.db');

const jp = await import('jpfun');
const { runJianpu } = await import('../shared/jianpu-prep.ts');
const { SEED_MELODIES } = await import('../server/seed/melodies.ts');
const { SEED_SONGS } = await import('../server/seed/songs.ts');
const { seed, installLibrary } = await import('../server/seed/index.ts');
const mel = await import('../server/repo/melodies.ts');
const { get } = await import('../server/db.ts');
const { deleteMeta } = await import('../server/repo/settings.ts');

const idOf = (key: string) => get<{ id: number }>('SELECT id FROM songs WHERE key = ?', key)!.id;

test('each bundled melody belongs to a bundled song and draws without problems', () => {
  assert.deepEqual(Object.keys(SEED_MELODIES).sort(), ['doxology', 'gloria-patri', 'the-lord-is-in-his-holy-temple', 'threefold-amen']);
  for (const [key, source] of Object.entries(SEED_MELODIES)) {
    const song = SEED_SONGS.find((s) => s.key === key);
    assert.ok(song, `${key} is a bundled song`);
    assert.equal(song.public_domain, true);
    const r = runJianpu(jp as never, source, { draw: true });
    assert.equal(r.svgs.length, 1, `${key} is drawn`);
    // the one warning allowed: QUAM DILECTA starts with an upbeat, so its last bar is short
    const problems = r.problems.filter((p) => !(key === 'the-lord-is-in-his-holy-temple' && p.code === 'W_METER_MISMATCH'));
    assert.deepEqual(problems.map((p) => `${p.code} ${p.line}:${p.column}`), [], key);
    assert.deepEqual(r.changed, [], `${key} is written in the notation's own characters`);
    assert.equal(r.autoBreaks, 0, `${key} places its own line breaks`);
  }
});

test('a new library gets the melodies with the songs', async () => {
  const added = await installLibrary(['songs']);
  assert.equal(added.melodies, 4);
  for (const key of Object.keys(SEED_MELODIES)) assert.equal(mel.melodyFor(idOf(key)), SEED_MELODIES[key], key);
  // offered once: the next start adds nothing
  assert.equal((await seed()).melodies, undefined);
});

test('a melody the church cleared stays cleared; restore brings it back; one it typed is never touched', async () => {
  const dox = idOf('doxology');
  const amen = idOf('threefold-amen');
  mel.setMelody(dox, '');
  const ours = '@1(G4)\n@meter(4, 4)\nN: { 1 2 3 4 | 5 - - - || }';
  mel.setMelody(amen, ours);
  await seed();
  assert.equal(mel.melodyFor(dox), null, 'cleared stays cleared');
  const back = await installLibrary(['songs'], { restore: true });
  assert.equal(back.melodies, 1);
  assert.equal(mel.melodyFor(dox), SEED_MELODIES.doxology);
  assert.equal(mel.melodyFor(amen), ours, 'the church’s own melody is kept, even on restore');
});

test('a church that already had the song (from before 0.21.2) gets the melody once, on its next start', async () => {
  const gp = idOf('gloria-patri');
  // as if this Canon had the song but had never been offered the melodies
  mel.setMelody(gp, '');
  deleteMeta('seed_melodies_offered');
  const counts = await seed();
  assert.equal(counts.melodies, 1);
  assert.equal(mel.melodyFor(gp), SEED_MELODIES['gloria-patri']);
});
