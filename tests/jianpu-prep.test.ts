// 0.21.0, from an adversarial test of the melody editor: Chinese-keyboard punctuation in the notes no longer turns into
// wrong notes, a melody that asks for too much is refused before jpFun (or saving) sees it and the server checks it in a
// thread of its own, a melody with no @br() gets a new line every 4 bars, and words left over are reported. Fictional
// melodies.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-jianpu-prep-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const jp = await import('jpfun');
const prep = await import('../shared/jianpu-prep.ts');
const { checkJianpu } = await import('../server/lib/jianpu-check.ts');
const mel = await import('../server/repo/melodies.ts');
const lib = await import('../server/repo/library.ts');
const { db } = await import('../server/db.ts');

before(() => {});
after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const B = '@1(G4)\n@meter(4, 4)\n';
const run = (s: string) => prep.runJianpu(jp as never, s, { draw: false });
const codes = (s: string) => run(s).problems.map((p) => p.code);

test('Chinese-keyboard punctuation in the notes is read as notation — not in the words or quoted text', () => {
  const src = `${B}N： { 1 2 3 7， | ５ ６ 1’ 2 | 3 － — – ｜ @text("渐强，") 5 - - - | }\nL：赞美，真神 一 二 三 四 五 六 七 八 九`;
  const { text, changed } = prep.normalizeJianpu(src);
  assert.equal(text, `${B}N: { 1 2 3 7, | 5 6 1' 2 | 3 - - - | @text("渐强，") 5 - - - | }\nL:赞美，真神 一 二 三 四 五 六 七 八 九`);
  assert.deepEqual(changed.sort(), ['，', '’', '－', '—', '–', '｜', '：', '５', '６'].sort());
  // one character for one: positions in what was typed stay right
  assert.equal(text.length, src.length);
  // drawn as the notes meant: the octave dot and the held beats are there, so the bars are full
  assert.deepEqual(codes(src).filter((c) => c === 'W_METER_MISMATCH'), []);
});

test('a melody that asks for too much is refused at once, with the reason (it froze pages and ran Node out of memory)', () => {
  const cases: [string, string][] = [
    [`${B}N: { 1 2 3 4 | @br(1000000000) 5 | }`, 'C_BR_TOO_MANY'],
    [`${B}N: { @dot(1, n=100000) | }`, 'C_NUMBER_TOO_LARGE'],
    [`${B}N: { ${'1 2 3 4 | '.repeat(500)}}`, 'C_TOO_MANY_BARS'],
    [`${B}N: { 1 ${'- '.repeat(5000)}}`, 'C_TOO_MANY_HELD'],
    [`${B}N: ${'{'.repeat(60)}1${'}'.repeat(60)}`, 'C_TOO_DEEP'],
  ];
  for (const [src, code] of cases) {
    const t0 = performance.now();
    const r = run(src);
    assert.ok(performance.now() - t0 < 500, `${code} is quick`);
    assert.equal(r.problems[0]?.code, code, src.slice(0, 60));
    assert.equal(r.problems.length, 1, 'one problem for one mistake');
    assert.ok(r.problems[0].error);
  }
  // ordinary values are fine
  assert.deepEqual(codes(`${B}@tempo(96)\nN: { 1 2 3 4 | @br(2) 5 - - - | }`), []);
});

test('no @br(): a new line every 4 bars, never where a held note carries on, and positions still point at what was typed', () => {
  const twelve = `${B}N: { ${'1 2 3 4 | '.repeat(12)}}`;
  const r = run(twelve);
  assert.equal(r.autoBreaks, 2);
  assert.equal(r.lineCount, 3);
  assert.equal(r.problems[0].code, 'C_AUTO_BREAKS');
  // a held note over the bar line: the break waits for the next bar
  const held = prep.autoBreak(`${B}N: { 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | 5 - - - | - - 1 2 | 1 2 3 4 | 1 2 3 4 | 1 2 3 4 | }`);
  assert.equal(held.at.length, 1);
  assert.match(held.text, /- - 1 2 \| @br\(\)/);
  // short melodies, melodies with @br() and several parts are left alone
  assert.equal(prep.autoBreak(`${B}N: { 1 2 3 4 | 5 - - - | }`).at.length, 0);
  assert.equal(prep.autoBreak(`${B}N: { ${'1 2 3 4 | '.repeat(4)}@br() ${'1 2 3 4 | '.repeat(8)}}`).at.length, 0);
  // a mistake after the added @br(): reported where it was typed
  const late = `${B}N: { ${'1 2 3 4 | '.repeat(8)}@metre(3) }`;
  const p = run(late).problems.find((x) => x.code === 'W_UNKNOWN_FUNCTION')!;
  assert.equal(late.split('\n')[p.line - 1].slice(p.column - 1, p.column + 5), '@metre');
});

test('words left over are reported at their L: line; a held syllable ({}) and a tie are not', () => {
  const src = `${B}N: { 1 2 3 4 | 5 - - - | }\nL: one two three four five six seven\nL: 一二三四五`;
  const left = run(src).problems.filter((p) => p.code === 'C_WORDS_LEFT_OVER');
  assert.equal(left.length, 1);
  assert.equal(left[0].line, 4);
  assert.deepEqual(left[0].vars, { count: '2', first: 'six' });
  assert.deepEqual(codes(`${B}N: { 1 2 3 4 | }\nL: a {} b c`), []);
  assert.deepEqual(codes(`${B}N: { 1 2 3 5@a | 5@b 4 3 2 | } @tie(a, b)\nL: a b c d e f g`), []);
});

test('the server checks in a thread of its own: a melody that takes too long ends the thread, not Canon', async () => {
  const quick = await checkJianpu(`${B}N: { 1 2 3 7， | 5 - - - | }`);
  assert.equal(quick.ok, true);
  assert.deepEqual(quick.read_as_notation, ['，']);
  const refused = await checkJianpu(`${B}N: { 1 2 3 4 | @br(1000000) 5 | }`);
  assert.equal(refused.ok, false);
  assert.match(refused.problems[0].message, /asks for too many lines/);
  // the time limit: a thread that doesn't answer in time is ended, and the check says so
  const slow = await checkJianpu(`${B}N: { 1 2 3 4 | }`, { timeLimitMs: 1 });
  assert.equal(slow.ok, false);
  assert.equal(slow.problems[0].code, 'C_TOO_SLOW');
  // and Canon answers the next one normally
  assert.equal((await checkJianpu(`${B}N: { 1 2 3 4 | }`)).ok, true);
});

test('saving keeps Chinese-keyboard punctuation as notation and refuses what would freeze the pages that draw it', () => {
  const song = lib.songs.insert({ title: { en: 'A Typed Tune' }, stanzas: [], category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);
  assert.equal(mel.setMelody(song.id, `${B}N: { 1 2 3 7， | 5 － － － | }\nL: 一，二 三 四 五`), `${B}N: { 1 2 3 7, | 5 - - - | }\nL: 一，二 三 四 五`);
  assert.throws(() => mel.setMelody(song.id, `${B}N: { 1 2 3 4 | @br(100000) 5 | }`), /asks for too many lines/);
  assert.match(mel.melodyFor(song.id)!, /7, \|/, 'the melody saved before is kept');
});
