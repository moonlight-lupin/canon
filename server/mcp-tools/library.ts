// MCP tools for the library: songs (with hymnal numbers), liturgical texts (with catechism / confession parts),
// hymnals and the Bible.
import { z } from 'zod';
import { listImages } from '../repo/images.ts';
import * as S from '../../shared/schemas.ts';
import { parsePartSelection, partRuns } from '../../shared/parts.ts';
import { isCJK, isChinese } from '../../shared/languages.ts';
import type { Lang } from '../../shared/types.ts';
import { tx } from '../db.ts';
import { BadRequest } from '../lib/table.ts';
import * as lib from '../repo/library.ts';
import * as bible from '../repo/bible.ts';
import { getSettings } from '../repo/settings.ts';
import { songUsage, textPartsHistory } from '../repo/history.ts';
import { libraryChecks } from '../repo/checks.ts';
import { DateStr, Id, L10N_MERGE_NOTE, Limit, RO, WRITE, canRead, mergeL10n, mergeL10nFields, mergeLabelled, type Ctx, type ToolDef } from './common.ts';

const SONG_CATEGORIES = ['hymn', 'psalm', 'song', 'doxology', 'response'] as const;
const TEXT_CATEGORIES = S.TextCategorySchema.options;
const CJK = /[㐀-鿿]/;
const MAX_VERSES = 200;
const MAX_PARTS = 60;

type SongPatch = Partial<z.infer<typeof S.SongInput>>;
type TextPatch = Partial<z.infer<typeof S.TextInput>>;
const noText = (l: Record<string, string> | undefined) => !l || !Object.values(l).some((v) => v.trim());

/** An agent's song update merged into the stored song by language (stanzas by label), unless told to replace. */
function songPatch(id: number, fields: SongPatch, replaceStanzas: boolean): SongPatch {
  const cur = lib.songs.get(id) as unknown as Required<SongPatch>;
  const out = mergeL10nFields(cur, fields, ['title']);
  if (fields.stanzas && !replaceStanzas) {
    out.stanzas = mergeLabelled(cur.stanzas, fields.stanzas, (x, y) => ({ ...x, text: mergeL10n(x.text, y.text) }), (x) => noText(x.text));
  }
  return out;
}

/** An agent's text update merged into the stored text by language (parts by label), unless told to replace. */
function textPatch(id: number, fields: TextPatch, replaceParts: boolean): TextPatch {
  const cur = lib.texts.get(id) as unknown as Required<TextPatch>;
  const out = mergeL10nFields(cur, fields, ['title', 'body']);
  if (fields.parts && !replaceParts) {
    out.parts = mergeLabelled(
      cur.parts,
      fields.parts,
      (x, y) => ({ ...x, body: mergeL10n(x.body, y.body), ...(y.title ? { title: mergeL10n(x.title, y.title) } : {}) }),
      (x) => noText(x.body),
    );
  }
  return out;
}

const songSummary = (s: ReturnType<typeof lib.songs.get>) => ({
  id: s.id,
  key: s.key,
  title: s.title,
  category: s.category,
  author: s.author,
  tune: s.tune,
  meter: s.meter,
  psalm: s.psalm,
  public_domain: s.public_domain,
  ccli: s.ccli,
  stanzas: s.stanzas.map((x) => x.label),
  has_words: s.stanzas.length > 0 ? undefined : false,
  hymnals: s.hymnals?.length ? s.hymnals : undefined,
});
const textSummary = (t: ReturnType<typeof lib.texts.get>) => ({
  id: t.id, key: t.key, category: t.category, title: t.title, source: t.source, public_domain: t.public_domain,
  part_count: t.parts?.length || undefined,
});
const hymnalSummary = (h: ReturnType<typeof lib.listHymnals>[number]) => ({
  id: h.id, abbr: h.abbr, name: h.name, publisher: h.publisher, year: h.year, song_count: h.song_count,
});

const firstLine = (body: Record<string, string | undefined>) =>
  (Object.values(body).find((v) => v?.trim()) ?? '').split('\n')[0].replace(/^[LCA]:\s?/, '').slice(0, 120);

/** Which parts earlier (and already planned) services used, and the label to continue the series from. */
function partsHistory(id: number, ctx: Ctx) {
  if (!canRead(ctx, 'services')) return {};
  const h = textPartsHistory(id);
  return { history: h.history.length ? h.history.map((x) => ({ date: x.date, service_id: x.service_id, parts: x.runs, planned: x.planned })) : undefined, next_suggested_label: h.next_suggested_label };
}

function textItem(id: number, selection: string | undefined, ctx: Ctx) {
  const t = lib.texts.get(id);
  const parts = t.parts ?? [];
  if (!parts.length) {
    if (selection) throw new BadRequest(`text ${t.id} has no parts — omit "parts" to read it`);
    return t;
  }
  const all = parts.map((p) => p.label);
  if (!selection) {
    return { ...lib.textOverview(t), hint: 'Pass parts "index" for the part list, or a selection such as "1-3"; use the labels as stanzas of a text item.', ...partsHistory(t.id, ctx) };
  }
  if (selection.trim().toLowerCase() === 'index') {
    return {
      id: t.id, key: t.key, title: t.title, category: t.category, part_count: parts.length,
      parts: parts.map((p) => ({ label: p.label, title: p.title && Object.values(p.title).find(Boolean), first_line: firstLine(p.body) })),
      ...partsHistory(t.id, ctx),
    };
  }
  const sel = parsePartSelection(selection, all);
  if (!sel.labels.length) throw new BadRequest(`no parts match "${selection}" (labels run ${partRuns(all, all).join(', ')})`);
  if (sel.labels.length > MAX_PARTS) throw new BadRequest(`${sel.labels.length} parts selected — ask for at most ${MAX_PARTS} at a time`);
  const want = new Set(sel.labels);
  return {
    id: t.id, key: t.key, title: t.title, category: t.category,
    stanzas: sel.labels,
    unknown: sel.unknown.length ? sel.unknown : undefined,
    parts: parts.filter((p) => want.has(p.label)),
    ...partsHistory(t.id, ctx),
  };
}

export const LIBRARY_TOOLS: ToolDef[] = [
  {
    name: 'canon_search_library', module: 'library', access: 'read', title: 'Search the library', annotations: RO,
    description: 'Search songs and liturgical texts by words in any language, or songs by hymnal number ("HP 123"). type: all | songs | texts | hymnals (the hymnbooks) | images (Library → Images: pictures to show on a slide of their own after an item — put their ids in the item\'s slide_images with canon_edit_order) | checks (languages that drift apart and likely duplicates; see the check_library playbook). Songs carry stanza labels, hymnal numbers and usage {last_used, times_12m} before `before` (default today) — avoid hymns sung in the last ~4 weeks; sort "least_recent" or "most_used". Example: {"q":"grace","type":"songs","before":"2026-10-11"}.',
    input: {
      q: z.string().max(200).optional(),
      type: z.enum(['all', 'songs', 'texts', 'hymnals', 'images', 'checks']).default('all'),
      category: z.enum([...SONG_CATEGORIES, ...TEXT_CATEGORIES]).optional(),
      usage: z.boolean().default(true).describe('songs: add last_used and times_12m'),
      sort: z.enum(['least_recent', 'most_used']).optional().describe('songs, by usage'),
      before: DateStr.optional().describe('count usage before this date, e.g. the service being planned'),
      limit: Limit(30, 100),
    },
    handler: (a, ctx) => {
      const q: string = a.q?.trim() ?? '';
      if (a.type === 'checks') {
        const r = libraryChecks();
        const issues = r.issues.filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q.toLowerCase()));
        return { checked: r.checked, counts: r.counts, total: issues.length, issues: issues.slice(0, Math.max(a.limit, 100)) };
      }
      if (a.type === 'images') {
        return { images: listImages(q).slice(0, a.limit).map((i) => ({ id: i.id, name: i.name, width: i.width, height: i.height, fit: i.fit, uses: i.uses })) };
      }
      if (a.type === 'hymnals') {
        const ql = q.toLowerCase();
        return { hymnals: lib.listHymnals().filter((h) => !ql || JSON.stringify([h.abbr, h.name]).toLowerCase().includes(ql)).map(hymnalSummary) };
      }
      const songCat = (SONG_CATEGORIES as readonly string[]).includes(a.category ?? '');
      const textCat = (TEXT_CATEGORIES as readonly string[]).includes(a.category ?? '');
      const wantSongs = (a.type === 'all' || a.type === 'songs') && !textCat;
      const wantTexts = (a.type === 'all' || a.type === 'texts') && !songCat;
      // usage comes from the services module: only when this connection may read services
      const withUsage = (a.usage || a.sort) && canRead(ctx, 'services');
      let songs: ReturnType<typeof lib.searchSongs> | undefined;
      let usage = new Map<number, { last_used: string; times: number }>();
      if (wantSongs) {
        songs = lib.searchSongs(q, a.category, a.sort && withUsage ? 5000 : a.limit);
        if (withUsage) usage = songUsage(songs.length <= 500 ? songs.map((s) => s.id) : null, { before: a.before });
        if (a.sort && withUsage) {
          const last = (id: number) => usage.get(id)?.last_used ?? '9999';
          const times = (id: number) => usage.get(id)?.times ?? 0;
          songs = [...songs].sort(a.sort === 'most_used' ? (x, y) => times(y.id) - times(x.id) : (x, y) => last(x.id).localeCompare(last(y.id)));
        }
        songs = songs.slice(0, a.limit);
      }
      return {
        songs: songs?.map((s) => {
          if (!withUsage) return songSummary(s);
          const u = usage.get(s.id);
          return { ...songSummary(s), last_used: u?.last_used, times_12m: u?.times ?? 0 };
        }),
        texts: wantTexts ? lib.searchTexts(q, a.category, a.limit).map(textSummary) : undefined,
      };
    },
  },
  {
    name: 'canon_get_library_item', module: 'library', access: 'read', title: 'Get a library item', annotations: RO,
    description: 'One library item in full. type "song": title, stanzas {label, text {lang: …}}, author, tune, meter, copyright / CCLI and hymnal numbers. type "text": the liturgical text (responsive lines start "L: " leader, "C: " congregation, "A: " all). Long texts in parts (Westminster Shorter Catechism key "wsc" parts "1".."107", Larger "wlc", Confession "wcf" parts "I.1" = chapter.section): parts "index" lists labels with first lines, a selection like "1-3", "1,4,7-9", "I.1-3" or "XXI" returns those parts (max 60); history lists the parts earlier and planned services used, and next_suggested_label continues the series. type "hymnal": the hymnbook with its songs by number. Example: {"type":"text","id":5,"parts":"1-3"}.',
    input: {
      type: z.enum(['song', 'text', 'hymnal']),
      id: Id,
      parts: z.string().max(200).optional().describe('texts only: "index" or a selection such as "1-3"'),
    },
    handler: (a, ctx) => {
      if (a.type === 'song') return lib.songs.get(a.id);
      if (a.type === 'text') return textItem(a.id, a.parts, ctx);
      const h = lib.hymnals.get(a.id);
      return {
        ...h,
        songs: lib.hymnalSongs(a.id).map((s) => ({ number: s.number, song_id: s.id, title: s.title, has_words: s.stanzas.length > 0 ? undefined : false })),
      };
    },
  },
  {
    name: 'canon_bible', module: 'library', access: 'read', title: 'Bible passage or search', annotations: RO,
    description: `Bible text. With ref: the passage, e.g. "John 3:16-21", "Ps 23", "罗马书 8:28-39", in lang (default the church's first language) using the church's Bible for that language unless translation is given; returns {ref, translation, verses:[{chapter, verse, text}]} (max ${MAX_VERSES}). With q instead: verses containing a word or phrase (Chinese queries search the Chinese Bible); returns [{ref, text}]. With neither: the installed Bible versions [{code, lang, name, source, verses, default}] (church uploads such as ESV or 和合本修订版 included) — use a code as translation here, or in a service's / reading's bibles {lang: code}. Example: {"ref":"Psalm 23","lang":"zh"}.`,
    input: {
      ref: z.string().min(1).max(200).optional(),
      q: z.string().min(2).max(100).optional(),
      lang: S.LangSchema.optional(),
      translation: z.string().max(20).optional(),
      limit: Limit(30, 100).describe('search results, max 100'),
    },
    handler: (a) => {
      if (a.ref) {
        const lang = (a.lang ?? getSettings().languages[0] ?? 'en') as Lang;
        if (a.translation) bible.checkTranslation(a.translation.toUpperCase(), lang);
        const p = bible.passage(a.ref, lang, a.translation?.toUpperCase() ?? bible.defaultTranslation(lang));
        if (!p.verses.length) throw new BadRequest(`No verses found for "${a.ref}" in ${p.translation} (is the Bible imported?)`);
        const verses = p.verses.slice(0, MAX_VERSES).map(({ chapter, verse, text }) => ({ chapter, verse, text }));
        return { ref: p.ref, translation: p.translation, lang: p.lang, verses, truncated: p.verses.length > MAX_VERSES || undefined };
      }
      if (!a.q) {
        const defaults = getSettings().bibles;
        return bible.translations().map((t) => ({ code: t.code, lang: t.lang, name: t.name, source: t.source, verses: t.verses, default: defaults[t.lang] === t.code || undefined }));
      }
      const langs = getSettings().languages;
      const lang = (a.lang ?? (CJK.test(a.q) ? langs.find(isChinese) ?? 'zh' : langs.find((l) => !isCJK(l)) ?? 'en')) as Lang;
      const tr = a.translation ?? bible.defaultTranslation(lang);
      if (!tr) throw new BadRequest(`No Bible is set up for language ${lang}`);
      return bible.searchBible(a.q, tr, a.limit).map((v) => ({ ref: v.ref, text: v.text }));
    },
  },
  {
    name: 'canon_save_song', module: 'library', access: 'write', title: 'Save a song', annotations: { ...WRITE, idempotentHint: true },
    description: 'Create a song (no id; fields.title required) or update one (id; only the given fields change, L10n merges by language). Stanzas merge by label ("1", "2", "R" = refrain) unless replace_stanzas; hymnal_numbers replaces all its numbers. Copyrighted songs: public_domain=false with copyright and ccli; never invent copyrighted lyrics. Details: handbook "Writing services and songs". Returns the summary. Example: {"fields":{"title":{"en":"Doxology"},"category":"doxology"},"hymnal_numbers":[{"hymnal_id":1,"number":"512"}]}.',
    input: {
      id: Id.optional(),
      fields: S.SongInput.partial().default({}),
      hymnal_numbers: S.SongHymnalsInput.optional(),
      replace_stanzas: z.boolean().optional().describe('update: true = fields.stanzas replaces the whole list (default: merge by label and language)'),
    },
    handler: (a) => tx(() => {
      const id = a.id ? lib.songs.update(a.id, songPatch(a.id, a.fields, !!a.replace_stanzas)).id : lib.songs.insert(S.SongInput.parse(a.fields)).id;
      if (a.hymnal_numbers) lib.setSongHymnals(id, a.hymnal_numbers);
      return { ...songSummary(lib.songs.get(id)), created: a.id ? undefined : true };
    }),
  },
  {
    name: 'canon_save_text', module: 'library', access: 'write', title: 'Save a liturgical text', annotations: { ...WRITE, idempotentHint: true },
    description: 'Create a liturgical text (no id; fields.category, title, body required) or update one (id; only the given fields change; ' + L10N_MERGE_NOTE + ' parts merge by label the same way, replace_parts=true replaces the whole list, parts=null removes them). body is L10n; use "L: ", "C: ", "A: " line prefixes for responsive readings, blank lines between paragraphs. Long documents may carry parts [{label, title?, body}]. category: call_to_worship|invocation|confession|assurance|creed|catechism|prayer|sacrament|benediction|liturgy|other. Returns the summary.',
    input: {
      id: Id.optional(),
      fields: S.TextInput.partial().default({}),
      replace_parts: z.boolean().optional().describe('update: true = fields.parts replaces the whole list (default: merge by label and language)'),
    },
    handler: (a) => {
      const t = a.id ? lib.texts.update(a.id, textPatch(a.id, a.fields, !!a.replace_parts)) : lib.texts.insert(S.TextInput.parse(a.fields));
      return { ...textSummary(t), created: a.id ? undefined : true };
    },
  },
];
