// Upload sheet music in bulk (0.15.5): the hymn and page from a file name. Fictional numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScoreName, parseScoreName } from '../shared/score-names.ts';

test('file names: hymnal, number and page', () => {
  const p = (f: string) => { const n = parseScoreName(f); return n && [n.abbr, n.number, n.page]; };
  assert.deepEqual(p('HP 178.jpg'), ['HP', '178', 1]);
  assert.deepEqual(p('HP178-2.png'), ['HP', '178', 2]);
  assert.deepEqual(p('hp_178 p2.pdf'), ['HP', '178', 2]);
  assert.deepEqual(p('HP 178 page 3.jpeg'), ['HP', '178', 3]);
  assert.deepEqual(p('178 (2).jpg'), [null, '178', 2]);
  assert.deepEqual(p('HP 178 The Church One Foundation.jpg'), ['HP', '178', 1]);
  assert.deepEqual(p('TH-045.webp'), ['TH', '45', 1]);
  assert.equal(parseScoreName('organ prelude.pdf'), null);
});

test('matching: by hymnal when named, else the first hymnal with the number', () => {
  const numbered = [{ song_id: 1, abbr: 'HP', number: '178' }, { song_id: 2, abbr: 'TH', number: '178' }, { song_id: 3, abbr: 'TH', number: '45' }];
  assert.equal(matchScoreName(parseScoreName('TH 178.jpg'), numbered), 2);
  assert.equal(matchScoreName(parseScoreName('178.jpg'), numbered), 1);
  assert.equal(matchScoreName(parseScoreName('TH-045.jpg'), numbered), 3);
  assert.equal(matchScoreName(parseScoreName('IMG_2041.jpg'), numbered), null, 'a camera file name matches nothing');
  assert.equal(matchScoreName(parseScoreName('HP 999.jpg'), numbered), null);
});
