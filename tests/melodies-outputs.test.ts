// 0.21.3: melodies belong on the bulletin and the slides (the congregation sings from them), not on Sheet music (the
// pianist plays from the scans). Each stanza gets its own lines of words, in the output's languages; a stanza spread
// over several slides shares out its lines of music; the slide and bulletin templates can turn them off; the Word and
// PowerPoint downloads draw them on the server. Fictional data; the tune is the public-domain Doxology.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-melody-outputs-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const prep = await import('../shared/jianpu-prep.ts');
const { buildSlides } = await import('../shared/slide-model.ts');
const { normaliseThemeVars, DEFAULT_THEME_VARS } = await import('../shared/slide-theme.ts');
const { normaliseBulletinOptions } = await import('../shared/presentation.ts');
const lib = await import('../server/repo/library.ts');
const svc = await import('../server/repo/services.ts');
const mel = await import('../server/repo/melodies.ts');
const { renderService } = await import('../server/repo/render.ts');
const { servicePptx } = await import('../server/export/pptx.ts');
const { serviceDocx } = await import('../server/export/docx.ts');
const { SEED_MELODIES } = await import('../server/seed/melodies.ts');
const { db, run } = await import('../server/db.ts');

after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const TWO_STANZAS = `@1(C4)
@meter(4, 4)
N: { 1 2 3 4 | @br() 5 - - - | }
L(1): first verse words now
L(2): sec- ond verse words
L(1): 第一节字
L: same for all here`;

test('a stanza gets its own lines of words, in the output’s languages; names can be taken off', () => {
  const one = prep.selectLyrics(TWO_STANZAS, { labels: ['1'], langs: ['en'] });
  assert.match(one, /L\(1\): first verse/);
  assert.doesNotMatch(one, /sec- ond|第一节/);
  assert.match(one, /L: same for all/, 'an unnamed line goes with every stanza');
  assert.match(prep.selectLyrics(TWO_STANZAS, { labels: ['1'], langs: ['zh'] }), /L\(1\): 第一节字/);
  assert.doesNotMatch(prep.selectLyrics(TWO_STANZAS, { labels: ['1'], langs: ['zh'] }), /first verse|same for all/);
  // on a slide the stanza number is already in the corner
  assert.match(prep.selectLyrics(TWO_STANZAS, { labels: ['2'], langs: ['en'], keepNames: false }), /^L: sec- ond verse words$/m);
  // a stanza with no lines of its own, in a language with none: the notes alone
  assert.doesNotMatch(prep.selectLyrics(TWO_STANZAS, { labels: ['3'], langs: ['ko'] }), /^\s*L/m);
  assert.equal(prep.selectLyrics(TWO_STANZAS), TWO_STANZAS, 'no selection: everything');
});

test('a long stanza over several slides shares out its lines of music, in order; the crop keeps whole lines', async () => {
  assert.deepEqual([0, 1, 2].map((p) => prep.partLines(5, p, 3)), [[0, 1], [1, 3], [3, 5]]);
  assert.deepEqual(prep.partLines(4, 0, 1), [0, 4]);
  assert.deepEqual([0, 1, 2, 3].map((p) => prep.partLines(2, p, 4)), [[0, 1], [0, 1], [1, 2], [1, 2]], 'more slides than lines: each slide still shows a line');
  const jp = await import('jpfun');
  const r = prep.runJianpu(jp as never, SEED_MELODIES.doxology, { draw: true });
  assert.equal(r.lines?.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(r.lines![i].top > r.lines![i - 1].bottom, 'lines do not overlap');
  const half = prep.cropSvg(r.svgs[0], r.lines!, 2, 4);
  const [, top, , h] = /viewBox="([^"]+)"/.exec(half)![1].split(' ').map(Number);
  assert.ok(top > r.lines![1].bottom && top < r.lines![2].top, 'the cut falls between lines 2 and 3');
  assert.ok(top + h >= r.lines![3].bottom, 'the last line is whole');
  assert.match(prep.recolorSvg(half, '#f5f0e6'), /fill="#f5f0e6"/);
  assert.doesNotMatch(prep.recolorSvg(half, '#f5f0e6'), /fill="#000"/);
});

const newSong = (en: string, stanzas: { label: string; text: Record<string, string> }[]) =>
  lib.songs.insert({ title: { en }, stanzas, category: 'hymn', public_domain: true, tags: [], refrain_after_each: false } as never);

test('slides: every slide of a stanza carries the melody; the template can turn it off', () => {
  const long = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n');
  const song = newSong('A Long Test Hymn', [{ label: '1', text: { en: long } }, { label: '2', text: { en: 'short' } }]);
  mel.setMelody(song.id, TWO_STANZAS);
  const s = svc.createService({ date: '2031-07-13' }).service;
  svc.addItem(s.id, { kind: 'song', ref_id: song.id });
  const r = renderService(s.id);
  const melodies = mel.serviceMelodies(s.id);
  const slides = buildSlides(r, ['en'], { ...DEFAULT_THEME_VARS, max_lines_single: 3 }, melodies).filter((x) => x.type === 'lyrics');
  assert.deepEqual(slides.map((x) => x.melody && [x.melody.label, x.melody.part, x.melody.parts]), [['1', 0, 3], ['1', 1, 3], ['1', 2, 3], ['2', 0, 1]]);
  assert.ok(buildSlides(r, ['en'], { ...DEFAULT_THEME_VARS, show_melody: false }, melodies).every((x) => !x.melody), 'switched off');
  assert.ok(buildSlides(r, ['en'], DEFAULT_THEME_VARS).every((x) => !x.melody), 'no melodies given: as before');
});

test('templates from before 0.21.3 show melodies', () => {
  const { show_melody: _a, ...oldVars } = DEFAULT_THEME_VARS;
  assert.equal(normaliseThemeVars(oldVars).show_melody, true);
  assert.equal(normaliseThemeVars({ ...oldVars, show_melody: false }).show_melody, false);
  assert.equal(normaliseBulletinOptions({}).show_melodies, true);
  assert.equal(normaliseBulletinOptions({ show_melodies: false }).show_melodies, false);
});

test('the server finds fonts for the notes: a picture without them has only the bar lines', async () => {
  // resvg's own font search finds nothing on Linux (Docker included): without the font folders named, a download's
  // melody came out as bar lines and dots
  const { Resvg } = await import('@resvg/resvg-js');
  const { FONT_OPTIONS } = await import('../server/lib/jianpu-image.ts');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="5" y="30" font-size="24" font-family="monospace">1 2 3</text></svg>';
  const px = new Resvg(svg, { font: FONT_OPTIONS, logLevel: 'off' }).render().pixels;
  let ink = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]) ink++;
  assert.ok(ink > 50, `the digits are drawn (${ink} pixels of ink)`);
});

/** The files in a .pptx / .docx (a zip), by name: just enough of a zip reader for a test. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let p = 0;
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    let size = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extra = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen);
    const start = p + 30 + nameLen + extra;
    if (buf.readUInt16LE(p + 6) & 8) {
      // sizes after the data: find the next header
      let q = start;
      while (q < buf.length - 4 && buf.readUInt32LE(q) !== 0x04034b50 && buf.readUInt32LE(q) !== 0x02014b50) q++;
      size = q - start - (buf.readUInt32LE(q - 16) === 0x08074b50 ? 16 : 12);
    }
    const data = buf.subarray(start, start + size);
    out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data));
    p = start + size;
    while (p < buf.length - 4 && buf.readUInt32LE(p) !== 0x04034b50 && buf.readUInt32LE(p) !== 0x02014b50) p++;
    if (buf.readUInt32LE(p) !== 0x04034b50) break;
  }
  return out;
}

test('downloads: PowerPoint and Word draw the melody on the server; a template can turn it off; a bad melody is skipped', async () => {
  const dox = newSong('A Test Doxology', [{ label: '1', text: { en: 'Praise God, from whom all blessings flow' } }]);
  const plain = newSong('A Hymn With No Melody', [{ label: '1', text: { en: 'Words only' } }]);
  const bad = newSong('A Hymn With A Bad Melody', [{ label: '1', text: { en: 'Never drawn' } }]);
  mel.setMelody(dox.id, SEED_MELODIES.doxology);
  // as if saved before the limits existed: never drawn, never a failure
  run('INSERT INTO song_melodies (song_id, source) VALUES (?, ?)', bad.id, '@1(G4)\n@meter(4, 4)\nN: { 1 2 3 4 | @br(1000000) 5 | }');
  const s = svc.createService({ date: '2031-07-20' }).service;
  for (const id of [dox.id, plain.id, bad.id]) svc.addItem(s.id, { kind: 'song', ref_id: id });
  const r = renderService(s.id);

  const pptx = unzip(await servicePptx(r));
  const media = [...pptx.keys()].filter((k) => k.startsWith('ppt/media/') && k.endsWith('.png'));
  assert.equal(media.length, 1, 'one picture: the Doxology’s stanza');
  assert.equal(pptx.get(media[0])!.subarray(1, 4).toString(), 'PNG');
  const slideXml = [...pptx.entries()].filter(([k]) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).map(([, v]) => v.toString());
  assert.equal(slideXml.filter((x) => x.includes('<p:pic>')).length, 1);
  assert.ok(slideXml.some((x) => x.includes('<p:pic>') && x.includes('Praise God')), 'on the Doxology’s slide');

  const docx = unzip(await serviceDocx(r));
  const svgs = [...docx.keys()].filter((k) => k.startsWith('word/media/') && k.endsWith('.svg'));
  const pngs = [...docx.keys()].filter((k) => k.startsWith('word/media/') && k.endsWith('.png'));
  assert.equal(svgs.length, 1);
  assert.equal(pngs.length, 1, 'with a PNG for older Word');
  assert.match(docx.get('word/document.xml')!.toString(), /svgBlip/);

  const off = unzip(await serviceDocx({ ...r, bulletin: { ...r.bulletin, options: { ...r.bulletin.options, show_melodies: false } } }));
  assert.equal([...off.keys()].filter((k) => k.startsWith('word/media/') && /\.(svg|png)$/.test(k)).length, 0, 'switched off: no melody');
});
