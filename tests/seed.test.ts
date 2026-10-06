// Canon's bundled library: optional (the first administrator chooses it), the public-domain hymns are in it, and each
// item is offered once — an item the church deletes is not brought back, unless it asks for it (restore).
// Also: a service template keeps a catechism question range (the evening template uses the full Shorter Catechism).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-seed-'));
process.env.CANON_DB = path.join(tmp, 'test.db');

const { seed, installLibrary, libraryStatus } = await import('../server/seed/index.ts');
const { SEED_SONGS } = await import('../server/seed/songs.ts');
const { SEED_HYMNS } = await import('../server/seed/hymns.ts');
const { songs, texts } = await import('../server/repo/library.ts');
const { getMeta, setMeta } = await import('../server/repo/settings.ts');
const svc = await import('../server/repo/services.ts');
const { get, run } = await import('../server/db.ts');

const idOf = (table: string, key: string) => get<{ id: number }>(`SELECT id FROM ${table} WHERE key = ?`, key)?.id;
const count = (table: string) => get<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)!.n;

test('a new Canon starts without the bundled library: teams and slide / bulletin designs only', async () => {
  assert.deepEqual(await seed(), { songs: 0, texts: 0, templates: 0 });
  assert.equal(count('songs'), 0);
  assert.equal(count('texts'), 0);
  assert.equal(count('templates'), 0);
  assert.ok(count('teams') > 0, 'default volunteer teams');
  assert.equal((await libraryStatus()).songs.chosen, false);
});

test('the public-domain hymns are part of the library: English words, published by 1930, music notes where needed', () => {
  assert.ok(SEED_HYMNS.length > 300, `${SEED_HYMNS.length} hymns`);
  const keys = SEED_SONGS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'song keys are unique');
  for (const h of SEED_HYMNS) {
    assert.ok(h.title.en && h.stanzas.length, `${h.key} has a title and words`);
    assert.ok(h.year && h.year <= 1930, `${h.key} published by 1930`);
    for (const st of h.stanzas) {
      assert.deepEqual(Object.keys(st.text), ['en'], `${h.key} has English words only`);
      assert.doesNotMatch(st.text.en!, /[一-鿿]/, `${h.key}: no Chinese in the English words`);
    }
    if (!h.public_domain) assert.match(h.copyright ?? '', /^Words public domain\./, `${h.key} explains which music is in copyright`);
  }
});

test('the administrator adds parts; later starts add only what an update brings to those parts', async () => {
  const added = await installLibrary(['songs', 'texts']);
  assert.equal(added.songs, SEED_SONGS.length);
  assert.ok(added.texts > 20);
  assert.equal(added.templates, 0, 'templates were not chosen');
  assert.ok(idOf('songs', 'blessed-assurance'));
  assert.deepEqual(await seed(), { songs: 0, texts: 0, templates: 0 }, 'nothing twice');
  assert.equal(count('templates'), 0, 'a part not chosen stays out');
  const st = await libraryStatus();
  assert.equal(st.songs.in_library, st.songs.bundled);
  assert.equal(st.templates.chosen, false);
});

test('a bundled item the church deletes stays deleted; restore brings it back; an update adds new items once', async () => {
  songs.remove(idOf('songs', 'blessed-assurance')!);
  texts.remove(idOf('texts', 'general-confession')!);
  assert.deepEqual(await seed(), { songs: 0, texts: 0, templates: 0 }, 'nothing comes back on the next start');
  assert.equal(idOf('songs', 'blessed-assurance'), undefined);
  assert.equal((await installLibrary(['songs'])).songs, 0, 'adding again does not bring deleted ones back');
  assert.deepEqual(await installLibrary(['songs', 'texts'], { restore: true }), { songs: 1, texts: 1, templates: 0 });

  // an update ships a hymn this library has never been offered
  songs.remove(idOf('songs', 'blessed-assurance')!);
  const offered = JSON.parse(getMeta('seed_offered')!) as { songs: string[] };
  setMeta('seed_offered', JSON.stringify({ ...offered, songs: offered.songs.filter((k) => k !== 'blessed-assurance') }));
  assert.equal((await seed()).songs, 1, 'a hymn new to this library is added once');
});

test('a Canon from before 0.14.2 (seeded on every start) keeps its whole library', async () => {
  run(`DELETE FROM settings WHERE key = '_library'`);
  assert.ok(getMeta('seeded_at'));
  await seed();
  assert.deepEqual(JSON.parse(getMeta('library')!), { songs: true, texts: true, templates: true });
});

test('a template keeps a catechism question range: the evening template uses Shorter Catechism Q. 1–4', async () => {
  await installLibrary(['templates']);
  const evening = svc.templates.get(idOf('templates', 'evening-worship')!);
  const item = evening.items.find((i) => i.text_key === 'wsc')!;
  assert.deepEqual(item.stanzas, ['1', '2', '3', '4']);
  // with the full catechism in the library, a service from the template starts at those questions
  const parts = Array.from({ length: 107 }, (_, i) => ({ label: String(i + 1), title: {}, body: { en: `L: Q. ${i + 1}?\nC: A.` } }));
  const wsc = texts.insert({ key: 'wsc', category: 'catechism', title: { en: 'Westminster Shorter Catechism' }, body: {}, source: 'test', tags: [], public_domain: true, parts });
  const { items } = svc.materialise(evening.items);
  assert.deepEqual(items.find((i) => i.ref_id === wsc.id)?.stanzas, ['1', '2', '3', '4']);
});

