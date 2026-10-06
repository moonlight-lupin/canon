// Lines per slide: the sentence splitter, the chunking of hymns / scripture / liturgy (languages kept aligned), the
// FreeShow export using the same chunks, and the one-text-size-per-deck rule. Fictional and public-domain text only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RenderedItem, RenderedService } from '../shared/render-types.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-chunks-'));
process.env.CANON_DB = path.join(tmp, 'test.db');

const { splitSentences, balancedSizes, alignChunks, groupUnits, chunkParagraph, lineLimit } = await import('../shared/slide-chunks.ts');
const { buildSlides, mapSlideIndex } = await import('../src/outputs/slideModel.ts');
const { deckFit, largestFitting, scaledCap } = await import('../src/outputs/deckFit.ts');
const { normaliseThemeVars, DEFAULT_THEME_VARS } = await import('../shared/slide-theme.ts');

after(async () => {
  try {
    const { db } = await import('../server/db.ts');
    db.close();
  } catch { /* not opened */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const trim = (xs: string[]) => xs.map((x) => x.trim());

// ---------------------------------------------------------------- sentences

test('sentences: English with abbreviations, numbers and quotations', () => {
  assert.deepEqual(trim(splitSentences('St. Paul wrote to Mr. Lee in Corinth. Then he sailed on! Did the church hear it?', 'en')), [
    'St. Paul wrote to Mr. Lee in Corinth.',
    'Then he sailed on!',
    'Did the church hear it?',
  ]);
  // ; and : do not end a sentence (they only break an over-long one); "v." and "e.g." do not either
  assert.deepEqual(trim(splitSentences('The LORD is my shepherd; I shall not want.', 'en')), ['The LORD is my shepherd; I shall not want.']);
  assert.deepEqual(trim(splitSentences('Hear the word of the Lord: blessed are the meek. Amen to that, we say.', 'en')), ['Hear the word of the Lord: blessed are the meek.', 'Amen to that, we say.']);
  assert.deepEqual(trim(splitSentences('See v. 4 and e.g. the next chapter for more. It is long enough.', 'en')), ['See v. 4 and e.g. the next chapter for more.', 'It is long enough.']);
  // a full stop inside a quotation does not cut it
  assert.deepEqual(trim(splitSentences('He said, "Go now. Come back later." Then he left the city.', 'en')), ['He said, "Go now. Come back later."', 'Then he left the city.']);
  // a tiny piece ("Amen.") joins its neighbour; a numbered line keeps its number
  assert.deepEqual(trim(splitSentences('Hear our prayer for all who serve today. Amen.', 'en')), ['Hear our prayer for all who serve today. Amen.']);
  assert.deepEqual(trim(splitSentences('1. Prayer meeting after the service in the hall.', 'en')), ['1. Prayer meeting after the service in the hall.']);
  // joining the pieces gives the text back
  const t = 'Grace to you. Peace from God our Father; and from the Lord Jesus Christ.';
  assert.equal(splitSentences(t, 'en').join(''), t);
});

test('sentences: Chinese punctuation, colons before a quotation', () => {
  // 。！？ end a sentence; ；： do not
  assert.deepEqual(splitSentences('耶和华是我的牧者，我必不致缺乏。他使我躺卧在青草地上；领我在可安歇的水边。', 'zh'), [
    '耶和华是我的牧者，我必不致缺乏。',
    '他使我躺卧在青草地上；领我在可安歇的水边。',
  ]);
  assert.deepEqual(splitSentences('我信上帝，全能的父：创造天地的主。', 'zh'), ['我信上帝，全能的父：创造天地的主。']);
  assert.deepEqual(splitSentences('你们要彼此相爱！你们愿意吗？阿们。', 'zh'), ['你们要彼此相爱！', '你们愿意吗？阿们。']);
  // "他说：" stays with the quotation it introduces
  assert.deepEqual(splitSentences('陈以诺传道说：“我们一同来敬拜。”众人都欢喜。', 'zh'), ['陈以诺传道说：“我们一同来敬拜。”', '众人都欢喜。']);
});

test('sentences: a verse reference is not a break; long sentences split softly at ; or : first, else a comma', () => {
  assert.deepEqual(trim(splitSentences('Read John 3:16 with the children today. God so loved the world.', 'en')), ['Read John 3:16 with the children today.', 'God so loved the world.']);
  assert.deepEqual(splitSentences('今天我们读约翰福音3:16和3：17这两节经文。', 'zh'), ['今天我们读约翰福音3:16和3：17这两节经文。']);
  assert.deepEqual(trim(splitSentences('Visit example.org/notes for the notes and the slides today.', 'en')), ['Visit example.org/notes for the notes and the slides today.']);
  const long = 'And in those days the people gathered at the gate of the city, and they waited there until evening, and the elders sat with them and spoke of the harvest to come.';
  const parts = splitSentences(long, 'en');
  assert.ok(parts.length >= 2, 'a very long sentence is split');
  assert.ok(parts.every((p) => p.trim().length <= 110));
  assert.match(parts[0].trim(), /,$/, 'at a comma');
  assert.equal(parts.join(''), long);
  const zh = '那时众人都聚集在城门口，从早晨一直等候到晚上，长老们也坐在他们中间，谈论将要来到的丰收，又一同感谢赐下雨水的上帝。';
  const zp = splitSentences(zh, 'zh');
  assert.ok(zp.length >= 2 && zp.every((p) => [...p].length <= 45));
  assert.match(zp[0], /，$/);
  // a ; or : near the middle is preferred over a comma that is nearer
  const semi = 'And the people gathered at the gate of the city and waited there all day long until evening came; and the elders sat with them, and spoke of the harvest, and gave thanks.';
  const sp = splitSentences(semi, 'en');
  assert.match(sp[0].trim(), /came;$/, 'at the semicolon');
  assert.equal(sp.join(''), semi);
  const zsemi = '那时众人都聚集在城门口，从早晨一直等候到晚上；长老们也坐在他们中间，谈论将要来到的丰收，又一同感谢赐下雨水的上帝。';
  assert.match(splitSentences(zsemi, 'zh')[0], /晚上；$/);
  // never inside a verse reference: the colon in 3:16 is not a break point
  const ref = 'In the gospel of John at chapter three and verse sixteen, which we write as John 3:16 in the bulletin today, we read of the love of God for the world.';
  assert.ok(splitSentences(ref, 'en').every((p) => !/3:$/.test(p.trim()) && !/^16/.test(p.trim())));
});

// ---------------------------------------------------------------- chunking helpers

test('chunks: balanced, proportional across languages', () => {
  assert.deepEqual(balancedSizes(4, 2), [2, 2]);
  assert.deepEqual(balancedSizes(5, 2), [3, 2]);
  assert.deepEqual(balancedSizes(7, 3), [3, 2, 2]);
  // 6 English lines and 3 Chinese lines at 2 a slide: 3 slides, Chinese spread 1 + 1 + 1
  const c = alignChunks([['a', 'b', 'c', 'd', 'e', 'f'], ['一', '二', '三']], 2);
  assert.deepEqual(c, [[['a', 'b'], ['一']], [['c', 'd'], ['二']], [['e', 'f'], ['三']]]);
  assert.equal(lineLimit(2, { max_lines_multi: 2, max_lines_single: 3 }), 2);
  assert.equal(lineLimit(1, { max_lines_multi: 2, max_lines_single: 3 }), 3);
  assert.equal(lineLimit(3), 2, 'defaults: 2 for several languages');
  assert.equal(lineLimit(1), 3, 'defaults: 3 for one');
  // whole units while they fit; an over-long unit cut into aligned parts, which never share a slide with each other
  // but may share one with the next unit
  const g = groupUnits([[['a'], ['一']], [['b'], ['二']], [['c', 'd', 'e'], ['三', '四']], [['f'], ['五']]], 2);
  assert.deepEqual(g.map((s) => s.map((p) => [p.unit, p.part])), [[[0, 0], [1, 0]], [[2, 0]], [[2, 1], [3, 0]]]);
  assert.deepEqual(g[1][0].sentences, [['c', 'd'], ['三']]);
  assert.deepEqual(g[2][0].sentences, [['e'], ['四']]);
});

test('theme vars: lines per slide and the same-size switch, with defaults for old themes', () => {
  assert.equal(DEFAULT_THEME_VARS.max_lines_multi, 2);
  assert.equal(DEFAULT_THEME_VARS.max_lines_single, 3);
  assert.equal(DEFAULT_THEME_VARS.uniform_size, true);
  const old = normaliseThemeVars({ bg: '#000000' });
  assert.equal(old.max_lines_multi, 2);
  assert.equal(old.uniform_size, true);
  const v = normaliseThemeVars({ max_lines_multi: 99, max_lines_single: 0, uniform_size: false });
  assert.equal(v.max_lines_multi, 6);
  assert.equal(v.max_lines_single, 1);
  assert.equal(v.uniform_size, false);
});

// ---------------------------------------------------------------- slide model

function item(id: number, kind: RenderedItem['kind'], extra: Partial<RenderedItem>): RenderedItem {
  return {
    id, kind, title: { en: 'Item', zh: '项目' }, subtitle: {}, start: '10:00', end: '10:05', duration_min: 5, role_name: null, leader: null,
    notes: null, in_bulletin: true, on_slides: true, bulletin_text: null, bulletin_full: true, slide_blocks: [], ...extra,
  } as RenderedItem;
}
function service(items: RenderedItem[], languages = ['en', 'zh']): RenderedService {
  return {
    id: 1, date: '2026-10-11', start_time: '10:00', end_time: '11:30', title: { en: 'Worship', zh: '崇拜' }, theme: {}, preacher: null,
    sermon_title: {}, sermon_ref: {}, languages, church: { name: { en: 'Example Church' } }, items, slide_theme_id: null,
  } as unknown as RenderedService;
}
const song = (id: number, stanzas: { label: string; text: Record<string, string> }[]) =>
  item(id, 'song', {
    song: { id, title: { en: 'A Hymn', zh: '诗歌' }, author: null, composer: null, tune: null, meter: null, public_domain: true, copyright: null, ccli: null, stanzas },
  });

const FOUR_EN = 'Come, all who serve, with one accord\nLift up your voices to the Lord\nFrom morning light to evening fall\nGive thanks to God who made us all';
const FOUR_ZH = '同心合意来敬拜\n高声颂赞我主恩\n从早到晚常称谢\n万有都归创造主';

test('hymns: a 4-line stanza is 2 slides of 2 lines per language when bilingual', () => {
  const r = service([song(2, [{ label: '1', text: { en: FOUR_EN, zh: FOUR_ZH } }, { label: '2', text: { en: FOUR_EN, zh: FOUR_ZH } }])]);
  const s = buildSlides(r, ['en', 'zh']).filter((x) => x.type === 'lyrics');
  assert.equal(s.length, 4);
  for (const x of s) {
    assert.equal(x.lines!.en!.length, 2);
    assert.equal(x.lines!.zh!.length, 2);
  }
  // the second line pair is the second half of the stanza in both languages
  assert.equal(s[1].lines!.en![0].text, 'From morning light to evening fall');
  assert.equal(s[1].lines!.zh![0].text, '从早到晚常称谢');
  // label once, then the continuation marker
  assert.equal(s[0].label?.en, '1');
  assert.equal(s[0].cont, undefined);
  assert.equal(s[1].label, undefined);
  assert.equal(s[1].cont, true);
  assert.deepEqual(s.map((x) => x.key), ['2-s0.0', '2-s0.1', '2-s1.0', '2-s1.1']);
});

test('hymns: one language allows 3 lines; 4 lines are balanced 2 + 2, 5 lines 3 + 2', () => {
  const r = service([song(3, [{ label: '1', text: { en: FOUR_EN, zh: FOUR_ZH } }, { label: '2', text: { en: `${FOUR_EN}\nAmen, amen, we sing again` } }])]);
  const s = buildSlides(r, ['zh']).filter((x) => x.type === 'lyrics');
  assert.deepEqual(s.map((x) => x.lines!.zh!.length), [2, 2], 'stanza 2 has no Chinese: no slide');
  const en = buildSlides(r, ['en']).filter((x) => x.type === 'lyrics');
  assert.deepEqual(en.map((x) => x.lines!.en!.length), [2, 2, 3, 2]);
  // the theme's own limits
  const four = buildSlides(r, ['en'], { max_lines_single: 4, max_lines_multi: 2 }).filter((x) => x.type === 'lyrics');
  assert.deepEqual(four.map((x) => x.lines!.en!.length), [4, 3, 2]);
  // a stanza with different line counts finishes on the same slide in both languages
  const odd = service([song(4, [{ label: '1', text: { en: FOUR_EN, zh: '同心合意来敬拜\n万有都归创造主' } }])]);
  const o = buildSlides(odd, ['en', 'zh']).filter((x) => x.type === 'lyrics');
  assert.deepEqual(o.map((x) => [x.lines!.en!.length, x.lines!.zh!.length]), [[2, 1], [2, 1]]);
});

test('scripture: verses grouped within the limit; a long verse split aligned, number on the first part only', () => {
  const en = [
    'Blessed is the one who walks in the way of peace.',
    'In the morning the steward opened the gate. He called the workers. They came from the village. Each received a coin.',
    'And the evening came.',
  ];
  const zh = ['行在平安道路上的人有福了。', '早晨管家开了门，招呼工人。他们从村里来了。每人领了一个银钱。', '到了晚上。'];
  const verses = (xs: string[]) => xs.map((text, i) => ({ chapter: 5, verse: i + 1, text }));
  const r = service([
    item(5, 'scripture', {
      scripture: { ref: { en: 'Example 5:1–3', zh: '例书 5:1–3' }, passages: { en: { translation: 'XYZ', verses: verses(en) }, zh: { translation: 'XYZ', verses: verses(zh) } } },
    } as Partial<RenderedItem>),
  ]);
  const s = buildSlides(r, ['en', 'zh']).filter((x) => x.type === 'scripture');
  // verse 1 alone (verse 2 would make 5 sentences); verse 2 (4 en / 3 zh sentences) in two parts; verse 3
  assert.equal(s.length, 4);
  assert.deepEqual(s.map((x) => x.verses!.en!.map((v) => v.n)), [['1'], ['2'], [''], ['3']]);
  assert.deepEqual(s.map((x) => x.verses!.zh!.map((v) => v.n)), [['1'], ['2'], [''], ['3']]);
  assert.equal(s[1].verses!.en![0].text, 'In the morning the steward opened the gate. He called the workers.');
  assert.equal(s[2].verses!.en![0].text, 'They came from the village. Each received a coin.');
  assert.equal(s[1].verses!.zh![0].text, '早晨管家开了门，招呼工人。他们从村里来了。');
  assert.equal(s[2].verses!.zh![0].text, '每人领了一个银钱。');
  assert.equal(s[2].cont, true);
  assert.ok(s.every((x) => x.footer?.en === 'Example 5:1–3 · XYZ'), 'the reference on every slide');
  // a language with fewer sentences than the parts is halved at a comma, so no slide is left with one language
  const short = service([
    item(8, 'scripture', {
      scripture: {
        ref: { en: 'Example 6:1' },
        passages: {
          en: { translation: 'XYZ', verses: [{ chapter: 6, verse: 1, text: 'The steward went to the gate. He waited for the workers. Then he called them in.' }] },
          zh: { translation: 'XYZ', verses: [{ chapter: 6, verse: 1, text: '管家到了门口，等候工人，然后叫他们进来。' }] },
        },
      },
    } as Partial<RenderedItem>),
  ]);
  const sh = buildSlides(short, ['en', 'zh']).filter((x) => x.type === 'scripture');
  assert.equal(sh.length, 2);
  assert.ok(sh.every((x) => x.verses!.en?.length && x.verses!.zh?.length), 'both languages on every part');
  assert.equal(sh.map((x) => x.verses!.zh![0].text).join(''), '管家到了门口，等候工人，然后叫他们进来。');
  // one language: 3 sentences a slide; the parts of verse 2 (2 + 2) share slides with verses 1 and 3
  const one = buildSlides(r, ['en']).filter((x) => x.type === 'scripture');
  assert.deepEqual(one.map((x) => x.verses!.en!.map((v) => v.n)), [['1', '2'], ['', '3']]);
  assert.equal(one[0].verses!.en![1].text, 'In the morning the steward opened the gate. He called the workers.', '4 sentences: 2 + 2');
});

test('liturgy: sentences per slide, speaker labels kept and repeated on a continuation', () => {
  const para = (lines: [string | null, string][]) => lines.map(([who, text]) => ({ who: who as 'L' | 'C' | 'A' | null, text }));
  const r = service([
    item(6, 'text', {
      paras: {
        en: [para([['L', 'The Lord be with you.'], ['C', 'And also with you. Let us give thanks to the Lord our God. It is right to give our thanks and praise.']])],
        zh: [para([['L', '愿主与你们同在。'], ['C', '也与你同在。我们要感谢主我们的上帝。这是应当的。']])],
      },
    }),
  ]);
  const s = buildSlides(r, ['en', 'zh']).filter((x) => x.type === 'text');
  // L (1 sentence) + C (3 sentences, after the tiny "也与你同在。" joins the next): L alone, then C in two parts
  assert.ok(s.length >= 2);
  assert.ok(s.every((x) => x.speakers), 'two speakers: labels shown');
  assert.equal(s[0].lines!.en![0].who, 'L');
  const cLines = s.flatMap((x) => x.lines!.en!).filter((l) => l.who === 'C');
  assert.ok(cLines.length >= 2, 'the long People line continues on the next slide');
  assert.ok(cLines.slice(1).every((l) => l.cont && l.who === 'C'), 'continuations keep the speaker');
  for (const x of s) {
    for (const l of ['en', 'zh']) {
      const n = x.lines![l]!.flatMap((ln) => splitSentences(ln.text, l)).length;
      assert.ok(n <= 2, `at most 2 sentences per language (${x.key} ${l}: ${n})`);
    }
  }
  // same number of lines in both languages: line-aligned
  const c = chunkParagraph(
    [para([[null, 'The first sentence is here. The second sentence is here.'], [null, 'The third one is next.']]), para([[null, '第一句话在这里。'], [null, '第三句话在后面。']])],
    ['en', 'zh'],
    2,
  );
  assert.equal(c.length, 2, 'whole lines: 2 + 1 sentences would be 3');
  assert.equal(c[1][0][0].text, 'The third one is next.');
  assert.equal(c[1][1][0].text, '第三句话在后面。', 'the Chinese line stays with its English line');
  // a creed spoken by all: no labels
  const creed = service([item(7, 'text', { paras: { en: [para([['A', 'I believe in God the Father Almighty.'], ['A', 'Maker of heaven and earth.']])] } })], ['en']);
  assert.ok(buildSlides(creed, ['en']).filter((x) => x.type === 'text').every((x) => !x.speakers));
});

test('liturgy: lines of one sentence count as one and keep their line breaks; a new speaker starts a new sentence', () => {
  const para = (lines: [string | null, string][]) => lines.map(([who, text]) => ({ who: who as 'L' | 'C' | 'A' | null, text }));
  const en = para([
    [null, 'Almighty God, our Father,'], [null, 'we thank you for this day'], [null, 'and for all your gifts.'],
    [null, 'Teach us to love one another,'], [null, 'and keep us in your peace.'], [null, 'Amen.'],
  ]);
  const zh = para([
    [null, '全能的上帝，我们的天父，'], [null, '我们为今天感谢你，'], [null, '也为你一切的恩赐感谢你。'],
    [null, '求你教导我们彼此相爱，'], [null, '并保守我们在你的平安里。'], [null, '阿们。'],
  ]);
  const r = service([item(9, 'prayer', { paras: { en: [en], zh: [zh] } })]);
  const s = buildSlides(r, ['en', 'zh']).filter((x) => x.type === 'text');
  assert.equal(s.length, 1, 'six lines, two sentences per language: one slide');
  assert.deepEqual(s[0].lines!.en!.map((l) => l.text), ['Almighty God, our Father,\nwe thank you for this day\nand for all your gifts.', 'Teach us to love one another,\nand keep us in your peace.\nAmen.']);
  assert.equal(s[0].lines!.zh![0].text, '全能的上帝，我们的天父，\n我们为今天感谢你，\n也为你一切的恩赐感谢你。');
  // one language: still one slide
  assert.equal(buildSlides(r, ['zh']).filter((x) => x.type === 'text').length, 1);
  // a speaker change always starts a new sentence, even without a full stop
  const resp = chunkParagraph([para([['L', 'Lift up your hearts'], ['C', 'We lift them up to the Lord'], ['L', 'Let us give thanks']])], ['en'], 3);
  assert.deepEqual(resp[0][0].map((l) => [l.who, l.text]), [['L', 'Lift up your hearts'], ['C', 'We lift them up to the Lord'], ['L', 'Let us give thanks']]);
  // a joined sentence that is too long still breaks softly (here at the semicolon)
  const long = para([
    [null, 'Gracious Father, we bring before you all who serve here'], [null, 'and all who lead in our city and our land;'],
    [null, 'grant them wisdom and patience in their work,'], [null, 'and keep them in your care through every season of the year.'],
  ]);
  const lc = chunkParagraph([long], ['en'], 1);
  assert.equal(lc.length, 2, 'two pieces, one a slide');
  assert.match(lc[0][0][0].text, /land;$/);
  assert.match(lc[1][0][0].text, /^grant them wisdom/);
  assert.equal(lc[1][0][0].cont, true);
});

test('language mode: re-chunked deck, the same words stay on screen', () => {
  const r = service([song(2, [{ label: '1', text: { en: FOUR_EN, zh: FOUR_ZH } }])]);
  const both = buildSlides(r, ['en', 'zh']);
  const zh = buildSlides(r, ['zh']);
  assert.equal(both.length, 3, 'title + 2 lyric slides');
  assert.equal(zh.length, 3, 'one language: 4 lines are 2 + 2');
  assert.equal(mapSlideIndex(both, 2, zh), 2, 'same key');
  const six = service([song(2, [{ label: '1', text: { en: `${FOUR_EN}\nOne more line\nAnd another`, zh: `${FOUR_ZH}\n再一行\n又一行` } }])]);
  const b6 = buildSlides(six, ['en', 'zh']); // 3 lyric slides
  const z6 = buildSlides(six, ['zh']); // 2 lyric slides
  assert.equal(b6.length, 4);
  assert.equal(z6.length, 3);
  assert.equal(mapSlideIndex(b6, 3, z6), 2, 'the last third of the stanza → its second half');
  assert.equal(mapSlideIndex(b6, 0, z6), 0);
});

// ---------------------------------------------------------------- one text size per deck

test('deck size: the smallest fitted size, capped by the theme, with a floor', () => {
  // each "slide" fits up to its own size
  const limits = [90, 62, 75, 48, 70];
  const fits = (max: number, n: number) => n <= max;
  assert.deepEqual(deckFit(limits, fits, 80), { size: 48, binding: 3 });
  assert.deepEqual(deckFit([90, 95], fits, 80), { size: 80, binding: -1 }, 'the cap when everything fits');
  assert.deepEqual(deckFit([5], fits, 80, 14), { size: 14, binding: 0 }, 'never below the floor');
  assert.equal(deckFit([], fits, 80).size, 80);
  assert.equal(largestFitting((n) => n <= 33, 14, 80), 33);
  assert.equal(scaledCap(80, 1.25), 100);
  assert.equal(scaledCap(80, NaN), 80);
});

// ---------------------------------------------------------------- FreeShow uses the same chunks

test('FreeShow: hymns, readings and liturgy chunked like the slides', async () => {
  const { freeshowProject } = await import('../server/export/freeshow.ts');
  const r = service([
    song(2, [{ label: '1', text: { en: FOUR_EN, zh: FOUR_ZH } }, { label: 'R', text: { en: 'Alleluia, alleluia\nPraise the Lord', zh: '哈利路亚\n赞美主' } }, { label: 'R', text: { en: 'Alleluia, alleluia\nPraise the Lord', zh: '哈利路亚\n赞美主' } }]),
  ]);
  const fsp = await freeshowProject(r);
  const show = fsp.shows['canon-1-2'];
  const layout = Object.values(show.layouts)[0].slides;
  assert.equal(Object.keys(show.slides).length, 3, 'stanza 1 in two slides, the refrain once');
  assert.equal(layout.length, 4, 'the refrain is shown twice');
  const first = show.slides[layout[0].id];
  assert.deepEqual(first.items.map((i) => i.lines!.length), [2, 2]);
});

test('run sheet slide numbers: range per item, where each stanza starts, every place a repeated refrain comes', async () => {
  const { slideNumbers } = await import('../src/outputs/slideModel.ts');
  const R = { label: 'R', text: { en: 'Sing, sing, sing to the Lord\nSing, sing, sing to the Lord' } };
  const r = service([
    item(1, 'section', { title: { en: 'Gathering' } }),
    // stanzas 1–3 with the refrain after each (as the server expands "Refrain after each stanza")
    song(2, [{ label: '1', text: { en: FOUR_EN } }, R, { label: '2', text: { en: FOUR_EN } }, R, { label: '3', text: { en: FOUR_EN } }, R]),
    item(3, 'prayer', { slide_blocks: [{ id: 9, kind: 'qr', caption: { en: 'Give' }, has_image: false, v: '1', value: 'https://example.org/give' }] }),
  ], ['en']);
  const slides = buildSlides(r, ['en']);
  const m = slideNumbers(slides);
  // slide 1 is the service title, 2 the section
  assert.deepEqual([m.get(1)!.first, m.get(1)!.last], [2, 2]);
  const s = m.get(2)!;
  // one language: each 4-line stanza is 2 slides, the 2-line refrain 1 → 1 (3,4) R (5) 2 (6,7) R (8) 3 (9,10) R (11)
  assert.deepEqual([s.first, s.last], [3, 11]);
  assert.deepEqual(s.parts.map((p) => [p.label.en, p.at]), [['1', [3]], ['Refrain', [5, 8, 11]], ['2', [6]], ['3', [9]]]);
  assert.equal(s.parts[1].refrain, true);
  // the slide numbers are the deck's own positions
  assert.equal(slides[s.parts[1].at[2] - 1].refrain, true);
  // the QR code slide is a part of its item
  const q = m.get(3)!;
  assert.deepEqual(q.parts.map((p) => [!!p.blocks, p.at]), [[true, [q.last]]]);
});
