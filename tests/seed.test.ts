// The bundled library: the public-domain hymns are in the seed, and each seed item is offered once — an item the
// church deletes is not brought back on the next start, while items new in an update are still added.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-seed-'));
process.env.CANON_DB = path.join(tmp, 'test.db');

const { seed } = await import('../server/seed/index.ts');
const { SEED_SONGS } = await import('../server/seed/songs.ts');
const { SEED_HYMNS } = await import('../server/seed/hymns.ts');
const { songs, texts } = await import('../server/repo/library.ts');
const { getMeta, setMeta } = await import('../server/repo/settings.ts');
const { get } = await import('../server/db.ts');

const idOf = (table: string, key: string) => get<{ id: number }>(`SELECT id FROM ${table} WHERE key = ?`, key)?.id;

before(async () => {
  await seed();
});

test('the public-domain hymns are part of the seed: English words, published by 1930, music notes where needed', () => {
  assert.ok(SEED_HYMNS.length > 300, `${SEED_HYMNS.length} hymns`);
  const keys = SEED_SONGS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, 'seed song keys are unique');
  for (const h of SEED_HYMNS) {
    assert.ok(h.title.en && h.stanzas.length, `${h.key} has a title and words`);
    assert.ok(h.year && h.year <= 1930, `${h.key} published by 1930`);
    for (const st of h.stanzas) {
      assert.deepEqual(Object.keys(st.text), ['en'], `${h.key} has English words only`);
      assert.doesNotMatch(st.text.en!, /[一-鿿]/, `${h.key}: no Chinese in the English words`);
    }
    if (!h.public_domain) assert.match(h.copyright ?? '', /^Words public domain\./, `${h.key} explains which music is in copyright`);
  }
  assert.ok(idOf('songs', 'blessed-assurance'), 'a seed hymn is in the library');
});

test('a seed item the church deletes stays deleted; an item new in an update is still added', async () => {
  const song = idOf('songs', 'blessed-assurance')!;
  const text = idOf('texts', 'general-confession')!;
  songs.remove(song);
  texts.remove(text);
  assert.deepEqual(await seed(), { songs: 0, texts: 0, templates: 0 }, 'nothing comes back on the next start');
  assert.equal(idOf('songs', 'blessed-assurance'), undefined);

  // an update ships a hymn this library has never been offered
  const offered = JSON.parse(getMeta('seed_offered')!) as { songs: string[] };
  setMeta('seed_offered', JSON.stringify({ ...offered, songs: offered.songs.filter((k) => k !== 'blessed-assurance') }));
  assert.equal((await seed()).songs, 1, 'a hymn new to this library is added once');
  assert.ok(idOf('songs', 'blessed-assurance'));
});
