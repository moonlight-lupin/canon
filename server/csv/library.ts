// CSV: the song library (with hymnal numbers and words per language), liturgical texts, and a hymnal's
// index (numbers and titles only). Songs and texts are matched by key, else by title in any language.
import type { L10n, LiturgyText, Song, SongHymnalRef, Stanza } from '../../shared/types.ts';
import { SongInput, TextInput } from '../../shared/schemas.ts';
import { all, get, run } from '../db.ts';
import { hymnalSongs, hymnals as hymnalTable, setSongHymnals, songs, texts } from '../repo/library.ts';
import { M, fail, say, type Change, type Column, type Ctx, type Entity, type InRow, type Msg, type RowPlan } from './engine.ts';
import {
  col, collect, diff, fmtBool, fmtList, hasText, l10nCols, mergeL10n, nameKey, parseBool, parseEnum, parseInt10, parseList, parseText, presentLangs, readL10n,
} from './common.ts';

// ---------------------------------------------------------------- words (stanzas) in a cell

/**
 * Stanzas from one language's cell: separated by a blank line, each optionally starting with a label line
 * such as [1], [2], [R] (refrain) or [Amen]. Unlabelled stanzas are numbered after the last number seen.
 */
export function parseWords(text: string, key: string): { label: string; text: string }[] {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((b) => b.trim()).filter(Boolean);
  const out: { label: string; text: string }[] = [];
  let last = 0;
  for (const b of blocks) {
    const lines = b.split('\n');
    const m = lines[0].match(/^\s*\[([^\]]{1,20})\]\s*(.*)$/);
    let label: string;
    if (m) {
      label = m[1].trim();
      if (m[2].trim()) lines[0] = m[2].trim();
      else lines.shift();
    } else label = String(last + 1);
    if (/^\d+$/.test(label)) last = Math.max(last, Number(label));
    const t = lines.map((l) => l.trimEnd()).join('\n').trim();
    if (!t) continue;
    if (out.some((s) => s.label === label)) fail(`${key}: the stanza label [${label}] is used twice.`, `${key}：诗节标记 [${label}] 用了两次。`);
    out.push({ label, text: t });
  }
  return out;
}

export function fmtWords(stanzas: Stanza[], lang: string): string {
  const norm = (t: string) => t.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
  return stanzas.filter((s) => s.text[lang]?.trim()).map((s) => `[${s.label}]\n${norm(s.text[lang]!)}`).join('\n\n');
}

/** Combine per-language stanzas (by label) with the song's current stanzas; languages not in the file are kept. */
function mergeStanzas(cur: Stanza[], inc: Record<string, { label: string; text: string }[]>): Stanza[] {
  const fileLangs = Object.keys(inc);
  const curLangs = new Set(cur.flatMap((s) => Object.keys(s.text).filter((l) => s.text[l]?.trim())));
  const base: Stanza[] = [...curLangs].every((l) => fileLangs.includes(l))
    ? []
    : cur.map((s) => ({ label: s.label, text: Object.fromEntries(Object.entries(s.text).filter(([l]) => !fileLangs.includes(l))) }));
  for (const lang of fileLangs) {
    for (const s of inc[lang]) {
      let hit = base.find((x) => x.label === s.label);
      if (!hit) {
        hit = { label: s.label, text: {} };
        base.push(hit);
      }
      hit.text[lang] = s.text;
    }
  }
  return base.filter((s) => Object.values(s.text).some((v) => v?.trim()));
}

// ---------------------------------------------------------------- hymnal numbers in a cell

const fmtRefs = (refs: SongHymnalRef[] | undefined) => (refs ?? []).map((r) => `${r.abbr} ${r.number}`).join('; ');

function parseRefs(s: string, hs: { id: number; abbr: string; sort: number }[]): SongHymnalRef[] {
  const out: SongHymnalRef[] = [];
  for (const item of parseList(s)) {
    const sp = item.match(/^(.*\S)\s+#?(\S+)$/);
    const ns = item.match(/^(\D+?)#?(\d\S*)$/);
    const [abbrRaw, number] = sp ? [sp[1], sp[2]] : ns ? [ns[1], ns[2]] : ['', item];
    const abbr = abbrRaw.replace(/\s*#$/, '').trim();
    if (!abbr) fail(`hymnals: "${item}" needs the hymnal abbreviation and number, like HP 123.`, `hymnals：「${item}」需要诗本缩写和编号，如 HP 123。`);
    const h = hs.find((x) => x.abbr.toLowerCase() === abbr.trim().toLowerCase());
    if (!h) fail(`hymnals: there is no hymnal with the abbreviation "${abbr}" (${hs.map((x) => x.abbr).join(', ') || 'no hymnals yet'}). Add it under Library → Hymnals first.`, `hymnals：没有缩写为「${abbr}」的诗本（现有：${hs.map((x) => x.abbr).join('、') || '尚无诗本'}）。请先在「资料库 → 诗本」中加入。`);
    const n = number.replace(/^#/, '');
    if (n.length > 12) fail(`hymnals: the number "${n}" is too long.`, `hymnals：编号「${n}」太长。`);
    if (out.some((r) => r.hymnal_id === h!.id)) fail(`hymnals: ${h!.abbr} is listed twice — a song has one number per hymnal.`, `hymnals：${h!.abbr} 列了两次 —— 每本诗本中一首诗歌只有一个编号。`);
    out.push({ hymnal_id: h!.id, abbr: h!.abbr, number: n });
  }
  const order = new Map(hs.map((h, i) => [h.id, i]));
  return out.sort((a, b) => order.get(a.hymnal_id)! - order.get(b.hymnal_id)!);
}

// ---------------------------------------------------------------- shared: match by key, else title

function matcher<T extends { id: number; key: string | null; title: L10n }>(rows: T[]) {
  const byKey = new Map(rows.filter((r) => r.key).map((r) => [r.key!.toLowerCase(), r]));
  const byTitle = new Map<string, T[]>();
  for (const r of rows) {
    for (const v of Object.values(r.title)) {
      if (!v) continue;
      const k = nameKey(v);
      const list = byTitle.get(k) ?? [];
      if (!list.includes(r)) list.push(r);
      byTitle.set(k, list);
    }
  }
  return (key: string | undefined, title: L10n, errors: Msg[], what: Msg): T | undefined => {
    if (key) {
      const hit = byKey.get(key.toLowerCase());
      if (hit) return hit;
    }
    const hits = [...new Set(Object.values(title).filter(Boolean).flatMap((v) => byTitle.get(nameKey(v!)) ?? []))]
      .filter((r) => !key || !r.key || r.key.toLowerCase() === key.toLowerCase());
    if (hits.length > 1) {
      errors.push(M(`${hits.length} ${what.en}s have this title (keys: ${hits.map((h) => h.key ?? `#${h.id}`).join(', ')}). Add the key column to say which one.`, `有 ${hits.length} 个${what.zh}使用这个标题（key：${hits.map((h) => h.key ?? `#${h.id}`).join('、')}）。请加上 key 栏位来指定。`));
      return undefined;
    }
    return hits[0];
  };
}

const keyCol = (what: Msg, example: string) =>
  col('key', M('Key', '代码'), M(`A short unique code for the ${what.en}, e.g. ${example}. Used by templates; optional.`, `${what.zh}的简短唯一代码，如 ${example}。供模板使用；可选。`), { example, aliases: ['code', 'id_key'] });

const keyParse = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  if (t.length > 100) fail('key is too long (at most 100 characters).', 'key 太长（最多 100 个字）。');
  return t;
};

/** Title / body per-language values and changes for the languages present in the file. */
function l10nPart(r: InRow, base: string, ctx: Ctx, present: Set<string>, cur: L10n | undefined, changes: Change[]) {
  const langs = presentLangs(base, ctx, present);
  const inc = readL10n(r, base, langs);
  for (const l of langs) if ((cur?.[l] ?? '').trim() !== (inc[l] ?? '').trim() && cur) changes.push({ field: `${base}_${l}`, from: cur[l] ?? '', to: inc[l] ?? '' });
  return { langs, inc, merged: mergeL10n(cur, inc) };
}

// ---------------------------------------------------------------- songs

const SONG_CATS = ['hymn', 'psalm', 'song', 'doxology', 'response'] as const;
const SONG_CAT_ALIAS: Record<string, (typeof SONG_CATS)[number]> = { 圣诗: 'hymn', 聖詩: 'hymn', 诗篇: 'psalm', 詩篇: 'psalm', 诗歌: 'song', 詩歌: 'song', 颂赞: 'doxology', 頌讚: 'doxology', 回应: 'response', 回應: 'response', chorus: 'song' };

interface SongField {
  col: Column;
  parse: (s: string) => unknown;
  get: (s: Song) => unknown;
  fmt?: (v: unknown) => string;
}
const SONG_FIELDS: SongField[] = [
  { col: col('author', M('Author', '作词'), M('Who wrote the words.', '歌词作者。'), { example: 'Thomas Ken', aliases: ['words_by', 'lyricist', '作词', '作詞'] }), parse: (s) => parseText(s, 'author', 300), get: (s) => s.author },
  { col: col('composer', M('Composer', '作曲'), M('Who wrote the music.', '作曲者。'), { example: 'Louis Bourgeois', aliases: ['music_by', '作曲'] }), parse: (s) => parseText(s, 'composer', 300), get: (s) => s.composer },
  { col: col('tune', M('Tune', '曲调名'), M('Tune name, e.g. OLD HUNDREDTH.', '曲调名称，如 OLD HUNDREDTH。'), { example: 'OLD HUNDREDTH' }), parse: (s) => parseText(s, 'tune', 200), get: (s) => s.tune },
  { col: col('meter', M('Meter', '韵律'), M('e.g. 8.8.8.8 or L.M.', '如 8.8.8.8 或 L.M.。'), { example: '8.8.8.8', aliases: ['metre'] }), parse: (s) => parseText(s, 'meter', 100), get: (s) => s.meter },
  { col: col('year', M('Year', '年份'), M('Year written.', '写作年份。'), { example: '1674' }), parse: (s) => parseInt10(s, 'year', 0, 2100), get: (s) => s.year },
  { col: col('category', M('Category', '类别'), M('hymn (default), psalm, song, doxology or response.', 'hymn（圣诗，默认）、psalm（诗篇）、song（诗歌）、doxology（颂赞）或 response（回应诗）。'), { values: [...SONG_CATS], example: 'doxology', aliases: ['type'] }), parse: (s) => parseEnum(s, 'category', SONG_CATS, SONG_CAT_ALIAS), get: (s) => s.category },
  { col: col('psalm', M('Psalm', '诗篇'), M('Psalm number for metrical psalms (1–150).', '韵文诗篇的篇数（1–150）。'), { aliases: ['psalm_number'] }), parse: (s) => parseInt10(s, 'psalm', 1, 150), get: (s) => s.psalm },
  { col: col('public_domain', M('Public domain', '公共领域'), M('yes if the words and music are free to use; no if under copyright (then fill copyright / ccli).', '若词曲可自由使用填 yes；有版权填 no（并填写 copyright / ccli）。'), { values: ['yes', 'no'], example: 'yes', aliases: ['pd'] }), parse: (s) => parseBool(s, 'public_domain'), get: (s) => s.public_domain, fmt: (v) => fmtBool(v as boolean) },
  { col: col('copyright', M('Copyright', '版权'), M('Copyright notice, if any.', '版权声明（如有）。'), {}), parse: (s) => parseText(s, 'copyright', 500), get: (s) => s.copyright },
  { col: col('ccli', M('CCLI number', 'CCLI 编号'), M('CCLI song number, if any.', 'CCLI 诗歌编号（如有）。'), { aliases: ['ccli_number', 'ccli_song'] }), parse: (s) => parseText(s, 'ccli', 50), get: (s) => s.ccli },
  { col: col('tags', M('Tags', '标签'), M('Words for finding the song, separated by semicolons, e.g. praise; trinity.', '方便搜寻的标签，以分号分隔，如 praise; trinity。'), { example: 'doxology; offering', aliases: ['tag', 'keywords', '标签'] }), parse: (s) => parseList(s).map((t) => t.slice(0, 50)), get: (s) => s.tags, fmt: (v) => fmtList(v as string[]) },
];

export const songsCsv: Entity = {
  key: 'songs',
  label: M('Hymns & songs', '诗歌'),
  module: 'library',
  pii: false,
  l10n: ['title', 'words'],
  intro: M(
    'One row per song. A row is matched by key, otherwise by title (any language); anything else is added. Words go in one cell per language: stanzas separated by a blank line, each may start with a label line such as [1], [2] or [R] for the refrain. Only enter words you are free or licensed to use.',
    '每行一首诗歌。以 key 对应，没有 key 时以标题（任何语言）对应；其余的会新增。歌词每种语言放在一个格子里：诗节之间空一行，每节开头可写标记行，如 [1]、[2]，副歌写 [R]。请只输入可自由使用或已获授权的歌词。',
  ),
  columns: (ctx) => [
    keyCol(M('song', '诗歌'), 'doxology'),
    ...l10nCols('title', ctx, M('Title', '标题'), M('Song title in this language. A new song needs a title in at least one language.', '此语言的诗歌标题。新增诗歌时至少要有一种语言的标题。'), { required: true, examples: { en: 'Doxology', zh: '三一颂', 'zh-Hant': '三一頌' } }),
    ...SONG_FIELDS.map((f) => f.col),
    col('hymnals', M('Hymnal numbers', '诗本编号'), M('Where the song appears in your hymnals: abbreviation and number, separated by semicolons, e.g. HP 123; TH 45. The hymnals must exist under Library → Hymnals.', '诗歌在各诗本中的编号：缩写加编号，以分号分隔，如 HP 123; TH 45。诗本须已在「资料库 → 诗本」中建立。'), { example: 'HP 470', aliases: ['hymnal', 'numbers', 'hymnal_numbers', '编号'] }),
    ...l10nCols('words', ctx, M('Words', '歌词'), M('All stanzas in this language, separated by a blank line; start a stanza with [1], [2] or [R] (refrain) to label it.', '此语言的全部诗节，诗节之间空一行；诗节开头可写 [1]、[2] 或 [R]（副歌）作为标记。'), { aliases: ['lyrics', 'text'] }),
    col('refrain_after_each', M('Refrain after each verse', '每节后唱副歌'), M('yes to sing the [R] stanza after every verse.', '若每节之后都唱副歌 [R]，填 yes。'), { values: ['yes', 'no'], example: 'no', aliases: ['refrain'] }),
    col('notes', M('Notes', '备注'), M('Anything else.', '其他备注。'), {}),
  ],
  example: () => [
    {
      key: 'doxology', title_en: 'Doxology', title_zh: '三一颂', 'title_zh-Hant': '三一頌', author: 'Thomas Ken', composer: 'Louis Bourgeois (Genevan Psalter, 1551)', tune: 'OLD HUNDREDTH', meter: '8.8.8.8', year: '1674', category: 'doxology', public_domain: 'yes', tags: 'doxology; offering; trinity', hymnals: '',
      words_en: '[1]\nPraise God, from whom all blessings flow;\nPraise him, all creatures here below;\nPraise him above, ye heavenly host;\nPraise Father, Son, and Holy Ghost. Amen.',
      words_zh: '[1]\n赞美真神万福之根，\n世上万民都当颂扬，\n天上万军也当赞美，\n赞美圣父、圣子、圣灵。阿们。',
      refrain_after_each: 'no',
    },
    {
      key: 'gloria-patri', title_en: 'Gloria Patri', title_zh: '荣耀颂', author: 'Traditional (early Church)', composer: 'Henry W. Greatorex', tune: 'GREATOREX', category: 'response', public_domain: 'yes', tags: 'response; trinity',
      words_en: 'Glory be to the Father,\nand to the Son, and to the Holy Ghost;\nas it was in the beginning, is now, and ever shall be,\nworld without end. Amen, Amen.',
      words_zh: '荣耀归于圣父、圣子和圣灵；\n起初这样，现在这样，\n以后也这样，永无穷尽。\n阿们，阿们。',
    },
    { title_en: 'Holy, Holy, Holy', title_zh: '圣哉，圣哉，圣哉', author: 'Reginald Heber', composer: 'John B. Dykes', tune: 'NICAEA', meter: '11.12.12.10', year: '1826', category: 'hymn', public_domain: 'yes', hymnals: '', notes: 'Words to be added' },
  ],
  export(ctx) {
    return songs.list('', [], `json_extract(title,'$.en') COLLATE NOCASE, id`).map((s) => {
      const out: Record<string, unknown> = { key: s.key, hymnals: fmtRefs(s.hymnals), refrain_after_each: fmtBool(s.refrain_after_each), notes: s.notes };
      for (const l of ctx.langs) {
        out[`title_${l}`] = s.title[l] ?? '';
        out[`words_${l}`] = fmtWords(s.stanzas, l);
      }
      for (const f of SONG_FIELDS) out[f.col.key] = f.fmt ? f.fmt(f.get(s)) : f.get(s);
      return out;
    });
  },
  plan(input, ctx, present) {
    const list = songs.list();
    const match = matcher(list);
    const hs = all<{ id: number; abbr: string; sort: number }>('SELECT id, abbr, sort FROM hymnals ORDER BY sort, id');
    const wordLangs = presentLangs('words', ctx, present);
    const seen = new Map<number | string, number>();
    const what = M('song', '诗歌');
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      const changes: Change[] = [];
      const key = present.has('key') ? collect(errors, () => keyParse(r.v.key)) ?? undefined : undefined;
      const title = readL10n(r, 'title', presentLangs('title', ctx, present));
      const cur = match(key, title, errors, what);
      const t = l10nPart(r, 'title', ctx, present, cur?.title, changes);
      const label = Object.values(cur ? t.merged : t.inc).filter(Boolean).join(' · ') || key || '—';
      const dupKey = cur ? cur.id : `new:${key ?? Object.values(title).filter(Boolean).map((v) => nameKey(v!))[0]}`;
      if (seen.has(dupKey)) errors.push(M(`Same song as row ${seen.get(dupKey)}.`, `与第 ${seen.get(dupKey)} 行是同一首诗歌。`));
      seen.set(dupKey, r.row);

      const patch: Record<string, unknown> = {};
      if (t.langs.length) patch.title = t.merged;
      if (key !== undefined && (key ?? null) !== (cur?.key ?? null)) {
        if (key === null && cur?.key) errors.push(M('key cannot be emptied (templates use it).', 'key 不能清空（模板会用到）。'));
        else if (key && get('SELECT 1 FROM songs WHERE key = ? COLLATE NOCASE AND id != ?', key, cur?.id ?? 0)) errors.push(M(`Another song already has the key "${key}".`, `另一首诗歌已使用 key「${key}」。`));
        else {
          patch.key = key;
          if (cur) changes.push({ field: 'key', from: cur.key ?? '', to: key ?? '' });
        }
      }
      for (const f of SONG_FIELDS) {
        if (!present.has(f.col.key)) continue;
        const v = collect(errors, () => f.parse(r.v[f.col.key] ?? ''));
        if (v === undefined) continue;
        let val = v;
        if (f.col.key === 'category' && val === null) val = 'hymn';
        if (f.col.key === 'public_domain' && val === null) val = false;
        patch[f.col.key] = val;
        if (cur) changes.push(...diff({ [f.col.key]: f.fmt ? f.fmt(f.get(cur)) : String(f.get(cur) ?? '') }, { [f.col.key]: f.fmt ? f.fmt(val) : String(val ?? '') }));
      }
      for (const k of ['refrain_after_each'] as const) {
        if (!present.has(k)) continue;
        const v = collect(errors, () => parseBool(r.v[k], k));
        if (v === undefined) continue;
        patch[k] = !!v;
        if (cur && !!v !== cur.refrain_after_each) changes.push({ field: k, from: fmtBool(cur.refrain_after_each), to: fmtBool(!!v) });
      }
      if (present.has('notes')) {
        const v = collect(errors, () => parseText(r.v.notes, 'notes'));
        if (v !== undefined) {
          patch.notes = v;
          if (cur) changes.push(...diff({ notes: cur.notes ?? '' }, { notes: v ?? '' }));
        }
      }
      let refs: SongHymnalRef[] | undefined;
      if (present.has('hymnals')) {
        refs = collect(errors, () => parseRefs(r.v.hymnals, hs));
        if (refs && cur) changes.push(...diff({ hymnals: fmtRefs(cur.hymnals) }, { hymnals: fmtRefs(refs) }));
      }
      if (wordLangs.length) {
        const inc: Record<string, { label: string; text: string }[]> = {};
        for (const l of wordLangs) {
          const w = collect(errors, () => parseWords(r.v[`words_${l}`] ?? '', `words_${l}`));
          if (w) inc[l] = w;
        }
        const stanzas = mergeStanzas(cur?.stanzas ?? [], inc);
        patch.stanzas = stanzas;
        if (cur) for (const l of wordLangs) changes.push(...diff({ [`words_${l}`]: fmtWords(cur.stanzas, l) }, { [`words_${l}`]: fmtWords(stanzas, l) }));
      }
      if (!cur && !hasText(t.inc)) errors.push(M('The title is empty — a new song needs a title in at least one language.', '标题是空的 —— 新增诗歌至少需要一种语言的标题。'));
      if (cur && t.langs.length && !hasText(t.merged)) errors.push(M('The title cannot be emptied in every language.', '标题不能在所有语言中都清空。'));
      if (!errors.length) {
        const check = (cur ? SongInput.partial() : SongInput).safeParse(patch);
        if (!check.success) errors.push(...check.error.issues.map((i) => M(`${i.path.join('.')}: ${i.message}`, `${i.path.join('.')}：${i.message}`)));
      }
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      const hymnalRefs = refs;
      if (!cur) {
        return {
          row: r.row, label, action: 'create', apply: () => {
            const s = songs.insert({ category: 'hymn', public_domain: false, tags: [], stanzas: [], ...patch });
            if (hymnalRefs) setSongHymnals(s.id, hymnalRefs);
          },
        };
      }
      if (!changes.length) return { row: r.row, label, action: 'unchanged' };
      const id = cur.id;
      return {
        row: r.row, label, action: 'update', changes, apply: () => {
          songs.update(id, patch);
          if (hymnalRefs) setSongHymnals(id, hymnalRefs);
        },
      };
    });
  },
};

// ---------------------------------------------------------------- liturgical texts

const TEXT_CATS = ['call_to_worship', 'invocation', 'confession', 'assurance', 'creed', 'catechism', 'prayer', 'sacrament', 'benediction', 'liturgy', 'other'] as const;
const TEXT_CAT_ALIAS: Record<string, (typeof TEXT_CATS)[number]> = {
  'call to worship': 'call_to_worship', 宣召: 'call_to_worship', 祈祷: 'prayer', 祷告: 'prayer', 禱告: 'prayer', 认罪: 'confession', 認罪: 'confession',
  赦罪: 'assurance', 'assurance of pardon': 'assurance', 信经: 'creed', 信經: 'creed', 要理问答: 'catechism', 圣礼: 'sacrament', 聖禮: 'sacrament',
  祝祷: 'benediction', 祝禱: 'benediction', 礼文: 'liturgy', 禮文: 'liturgy',
};

export const textsCsv: Entity = {
  key: 'texts',
  label: M('Liturgical texts', '礼文'),
  module: 'library',
  pii: false,
  l10n: ['title', 'body'],
  intro: M(
    'One row per text (creed, prayer, call to worship …). A row is matched by key, otherwise by title (any language); anything else is added. Responsive texts: start a line with "L: " for the leader, "C: " for the congregation, "A: " for all. Catechism questions (parts) are not changed by a CSV import.',
    '每行一篇礼文（信经、祷文、宣召等）。以 key 对应，没有 key 时以标题（任何语言）对应；其余的会新增。启应文：行首写「L: 」为领会者、「C: 」为会众、「A: 」为齐读。CSV 导入不会更改要理问答的分题内容。',
  ),
  columns: (ctx) => [
    keyCol(M('text', '礼文'), 'apostles-creed'),
    col('category', M('Category', '类别'), M('Needed for a new text.', '新增礼文时必填。'), { values: [...TEXT_CATS], example: 'creed', aliases: ['type'] }),
    ...l10nCols('title', ctx, M('Title', '标题'), M('Title in this language. A new text needs a title in at least one language.', '此语言的标题。新增礼文时至少要有一种语言的标题。'), { required: true, examples: { en: 'Gloria Patri', zh: '荣耀颂' } }),
    ...l10nCols('body', ctx, M('Text', '内容'), M('The full text in this language. Blank line = new paragraph / slide; L:, C:, A: mark who reads.', '此语言的全文。空行表示新段落/新投影片；L:、C:、A: 标示由谁诵读。'), { aliases: ['text'] }),
    col('source', M('Source', '出处'), M('Where the text comes from, e.g. KJV / 和合本.', '出处，如 KJV / 和合本。'), {}),
    col('tags', M('Tags', '标签'), M('Separated by semicolons.', '以分号分隔。'), { aliases: ['tag', 'keywords'] }),
    col('public_domain', M('Public domain', '公共领域'), M('yes if free to use.', '若可自由使用填 yes。'), { values: ['yes', 'no'], aliases: ['pd'] }),
  ],
  example: () => [
    { key: 'gloria-patri-said', category: 'liturgy', title_en: 'Gloria Patri (said)', title_zh: '荣耀颂（诵读）', body_en: 'A: Glory be to the Father, and to the Son, and to the Holy Ghost;\nA: as it was in the beginning, is now, and ever shall be, world without end. Amen.', body_zh: 'A: 荣耀归于圣父、圣子和圣灵；\nA: 起初这样，现在这样，以后也这样，永无穷尽。阿们。', source: 'Traditional', tags: 'trinity; praise', public_domain: 'yes' },
    { key: 'call-psalm-100', category: 'call_to_worship', title_en: 'Call to Worship: Psalm 100', title_zh: '宣召：诗篇100篇', body_en: 'L: Make a joyful noise unto the LORD, all ye lands.\nC: Serve the LORD with gladness: come before his presence with singing.', body_zh: 'L: 普天下当向耶和华欢呼！\nC: 你们当乐意事奉耶和华，当来向他歌唱！', source: 'KJV / 和合本 (CUV 1919)', tags: 'psalm; praise', public_domain: 'yes' },
  ],
  export(ctx) {
    return texts.list('', [], `category, json_extract(title,'$.en') COLLATE NOCASE, id`).map((x) => {
      const out: Record<string, unknown> = { key: x.key, category: x.category, source: x.source, tags: fmtList(x.tags), public_domain: fmtBool(x.public_domain) };
      for (const l of ctx.langs) {
        out[`title_${l}`] = x.title[l] ?? '';
        out[`body_${l}`] = x.body[l] ?? '';
      }
      return out;
    });
  },
  plan(input, ctx, present) {
    const list = texts.list();
    const match = matcher<LiturgyText>(list);
    const seen = new Map<number | string, number>();
    const what = M('text', '礼文');
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      const changes: Change[] = [];
      const key = present.has('key') ? collect(errors, () => keyParse(r.v.key)) ?? undefined : undefined;
      const title = readL10n(r, 'title', presentLangs('title', ctx, present));
      const cur = match(key, title, errors, what);
      const t = l10nPart(r, 'title', ctx, present, cur?.title, changes);
      const b = l10nPart(r, 'body', ctx, present, cur?.body, changes);
      const label = Object.values(cur ? t.merged : t.inc).filter(Boolean).join(' · ') || key || '—';
      const dupKey = cur ? cur.id : `new:${key ?? Object.values(title).filter(Boolean).map((v) => nameKey(v!))[0]}`;
      if (seen.has(dupKey)) errors.push(M(`Same text as row ${seen.get(dupKey)}.`, `与第 ${seen.get(dupKey)} 行是同一篇礼文。`));
      seen.set(dupKey, r.row);
      const patch: Record<string, unknown> = {};
      if (t.langs.length) patch.title = t.merged;
      if (b.langs.length) patch.body = b.merged;
      if (key !== undefined && (key ?? null) !== (cur?.key ?? null)) {
        if (key === null && cur?.key) errors.push(M('key cannot be emptied (templates use it).', 'key 不能清空（模板会用到）。'));
        else if (key && get('SELECT 1 FROM texts WHERE key = ? COLLATE NOCASE AND id != ?', key, cur?.id ?? 0)) errors.push(M(`Another text already has the key "${key}".`, `另一篇礼文已使用 key「${key}」。`));
        else {
          patch.key = key;
          if (cur) changes.push({ field: 'key', from: cur.key ?? '', to: key ?? '' });
        }
      }
      const inc: Record<string, string> = {};
      const curF: Record<string, string> = cur ? { category: cur.category, source: cur.source ?? '', tags: fmtList(cur.tags), public_domain: fmtBool(cur.public_domain) } : {};
      if (present.has('category')) {
        const v = collect(errors, () => parseEnum(r.v.category, 'category', TEXT_CATS, TEXT_CAT_ALIAS));
        if (v) {
          patch.category = v;
          inc.category = v;
        } else if (v === null && cur) errors.push(M('category cannot be emptied.', '类别（category）不能清空。'));
      }
      if (present.has('source')) {
        const v = collect(errors, () => parseText(r.v.source, 'source', 500));
        if (v !== undefined) {
          patch.source = v;
          inc.source = v ?? '';
        }
      }
      if (present.has('tags')) {
        patch.tags = parseList(r.v.tags).map((x) => x.slice(0, 50));
        inc.tags = fmtList(patch.tags as string[]);
      }
      if (present.has('public_domain')) {
        const v = collect(errors, () => parseBool(r.v.public_domain, 'public_domain'));
        if (v !== undefined) {
          patch.public_domain = !!v;
          inc.public_domain = fmtBool(!!v);
        }
      }
      if (cur) changes.push(...diff(curF, inc));
      if (!cur && !patch.category) errors.push(M('category is empty — it is needed to add a new text.', '类别（category）是空的 —— 新增礼文时必须填写。'));
      if (!cur && !hasText(t.inc)) errors.push(M('The title is empty — a new text needs a title in at least one language.', '标题是空的 —— 新增礼文至少需要一种语言的标题。'));
      if (!errors.length) {
        const check = (cur ? TextInput.partial() : TextInput).safeParse({ body: {}, ...patch });
        if (!check.success) errors.push(...check.error.issues.map((i) => M(`${i.path.join('.')}: ${i.message}`, `${i.path.join('.')}：${i.message}`)));
      }
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      if (!cur) return { row: r.row, label, action: 'create', apply: () => void texts.insert({ body: {}, tags: [], public_domain: false, ...patch }) };
      if (!changes.length) return { row: r.row, label, action: 'unchanged' };
      const id = cur.id;
      return { row: r.row, label, action: 'update', changes, apply: () => void texts.update(id, patch) };
    });
  },
};

// ---------------------------------------------------------------- hymnal index

function hymnalOf(ctx: Ctx) {
  const id = Number(ctx.query.hymnal_id);
  if (!Number.isInteger(id) || id <= 0) fail('Choose a hymnal first (hymnal_id is missing).', '请先选择诗本（缺少 hymnal_id）。');
  const h = hymnalTable.find(id);
  if (!h) fail(`Hymnal ${id} not found.`, `找不到诗本 ${id}。`);
  return h!;
}

export const hymnalIndexCsv: Entity = {
  key: 'hymnal_index',
  label: M('Hymnal index', '诗本目录'),
  module: 'library',
  pii: false,
  l10n: ['title'],
  needs: ['hymnal_id'],
  intro: M(
    'One row per hymn in this hymnal: its number and title (in one or more languages). Existing songs are matched by title in any language; the others are added with their title only (tagged needs-words). The index decides: a number held by another song moves to the matched song. Hymn words are never imported here.',
    '每行是此诗本中的一首诗歌：编号和标题（一种或多种语言）。已有的诗歌以任何语言的标题对应；其余的只以标题新增（标记为 needs-words）。以目录为准：若编号原属另一首诗歌，会改给对应的诗歌。这里不会导入歌词。',
  ),
  columns: (ctx) => [
    col('number', M('Number', '编号'), M('The hymn number in this hymnal, e.g. 123 or 123a.', '此诗本中的编号，如 123 或 123a。'), { required: true, example: '1', aliases: ['no', '#', 'num', 'hymn_number', '编号', '編號'] }),
    ...l10nCols('title', ctx, M('Title', '标题'), M('Hymn title in this language.', '此语言的诗歌标题。'), { required: true, examples: { en: 'Holy, Holy, Holy', zh: '圣哉，圣哉，圣哉', 'zh-Hant': '聖哉，聖哉，聖哉' } }),
    col('author', M('Author', '作词'), M('Optional; used only for new songs.', '可选；只用于新增的诗歌。'), {}),
  ],
  example: () => [
    { number: '1', title_en: 'Holy, Holy, Holy', title_zh: '圣哉，圣哉，圣哉', 'title_zh-Hant': '聖哉，聖哉，聖哉', author: 'Reginald Heber' },
    { number: '2', title_en: 'Doxology', title_zh: '三一颂', 'title_zh-Hant': '三一頌', author: 'Thomas Ken' },
    { number: '3', title_en: 'Gloria Patri', title_zh: '荣耀颂', 'title_zh-Hant': '榮耀頌' },
  ],
  fileName: (ctx) => `hymnal-${hymnalOf(ctx).abbr.replace(/[^\w-]+/g, '')}`,
  export(ctx) {
    const h = hymnalOf(ctx);
    return hymnalSongs(h.id).map((s) => {
      const out: Record<string, unknown> = { number: s.number, author: s.author };
      for (const l of ctx.langs) out[`title_${l}`] = s.title[l] ?? '';
      return out;
    });
  },
  plan(input, ctx, present) {
    const h = hymnalOf(ctx);
    if (!present.has('number')) fail('A "number" column is required.', '必须有「number」（编号）栏位。');
    const langs = presentLangs('title', ctx, present);
    if (!langs.length) fail('At least one title column is required (title_en, title_zh …).', '至少需要一个标题栏位（title_en、title_zh …）。');
    const byTitle = new Map<string, number>();
    const titles = new Map<number, L10n>();
    for (const r of all<{ id: number; title: string }>('SELECT id, title FROM songs ORDER BY id')) {
      const t = JSON.parse(r.title) as L10n;
      titles.set(r.id, t);
      for (const v of Object.values(t)) if (v && !byTitle.has(nameKey(v))) byTitle.set(nameKey(v), r.id);
    }
    const nums = all<{ song_id: number; number: string }>('SELECT song_id, number FROM song_hymnals WHERE hymnal_id = ?', h.id);
    const numOf = new Map(nums.map((n) => [n.song_id, n.number]));
    const holder = new Map(nums.map((n) => [n.number.toLowerCase(), n.song_id]));
    // stubs created by this import, shared by rows with the same title
    const stubs = new Map<string, { id: number | null }>();
    const seenNum = new Map<string, number>();
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      const number = (r.v.number ?? '').replace(/^#/, '').trim();
      const title = readL10n(r, 'title', langs);
      for (const k of Object.keys(title)) if (!title[k]) delete title[k];
      const label = `${h.abbr} ${number} · ${Object.values(title).join(' · ')}`;
      if (!number) errors.push(M('number is empty.', '编号（number）是空的。'));
      else if (number.length > 12) errors.push(M(`The number "${number}" is too long.`, `编号「${number}」太长。`));
      else if (seenNum.has(number.toLowerCase())) errors.push(M(`Number ${number} is also on row ${seenNum.get(number.toLowerCase())}.`, `编号 ${number} 也出现在第 ${seenNum.get(number.toLowerCase())} 行。`));
      seenNum.set(number.toLowerCase(), r.row);
      if (!hasText(title)) errors.push(M('No title.', '没有标题。'));
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      const keys = Object.values(title).map((v) => nameKey(v!));
      const songId = keys.map((k) => byTitle.get(k)).find(Boolean);
      const author = present.has('author') ? r.v.author || null : null;
      const other = holder.get(number.toLowerCase());
      const warnings: Msg[] = [];
      if (other && other !== songId) {
        const ot = titles.get(other) ?? {};
        const n = Object.values(ot).find(Boolean) ?? `#${other}`;
        warnings.push(M(`${h.abbr} ${number} moves from "${n}" to this song.`, `${h.abbr} ${number} 将从「${n}」改给这首诗歌。`));
      }
      const link = (id: number) => {
        run('DELETE FROM song_hymnals WHERE hymnal_id = ? AND number = ? COLLATE NOCASE AND song_id != ?', h.id, number, id);
        run('INSERT OR REPLACE INTO song_hymnals (song_id, hymnal_id, number) VALUES (?, ?, ?)', id, h.id, number);
      };
      if (!songId) {
        const sk = keys[0];
        const stub = stubs.get(sk) ?? { id: null };
        const first = !stubs.has(sk);
        stubs.set(sk, stub);
        return {
          row: r.row, label, action: 'create', warnings,
          changes: [{ field: 'song', from: '', to: first ? `${Object.values(title).join(' · ')} ${say(M('(new, title only)', '（新增，只有标题）'), ctx.lang)}` : Object.values(title).join(' · ') }],
          apply: () => {
            if (!stub.id || !get('SELECT 1 FROM songs WHERE id = ?', stub.id)) {
              stub.id = songs.insert({ title, author, category: 'hymn', public_domain: false, tags: ['needs-words'], stanzas: [] }).id;
            }
            link(stub.id);
          },
        };
      }
      const cur = numOf.get(songId);
      if (cur && cur.toLowerCase() === number.toLowerCase()) return { row: r.row, label, action: 'unchanged' };
      return { row: r.row, label, action: 'update', warnings, changes: [{ field: 'number', from: cur ? `${h.abbr} ${cur}` : '', to: `${h.abbr} ${number}` }], apply: () => link(songId) };
    });
  },
};

