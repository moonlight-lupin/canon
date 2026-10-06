// Builds the projector slide list from a rendered service (shared by Slides and the run sheet's AV cues).
import type { L10n, Lang, Posture } from './types.ts';
import type { Line, Paras, RenderedItem, RenderedService, RenderedSlideBlock, RenderedVerse } from './render-types.ts';
import { biText, hasAny, isRefrain, stanzaLabel } from './output-labels.ts';
import { alignChunks, chunkParagraph, groupUnits, joinPieces, lineLimit, splitSentences, type ChunkLine, type LineLimits } from './slide-chunks.ts';

export type SlideType = 'title' | 'section' | 'lyrics' | 'scripture' | 'text' | 'sermon' | 'item' | 'blocks';

export interface SlideVerse {
  /** verse number ('' on the later parts of a verse split over several slides) */
  n: string;
  text: string;
}

/** A line on a slide; `cont` = it continues a line from the slide before. */
export type SlideLine = ChunkLine;

export interface SlideDef {
  key: string;
  type: SlideType;
  /** id of the run-sheet item (null for the service title slide) */
  itemId: number | null;
  /** item kind for the theme's .kind-<kind> class hook ('service' for the title slide) */
  kind?: string;
  /** small heading at the top (song title, item title) */
  heading?: L10n;
  /** a QR code in a corner of the slide (the title slide: the attendees' bulletin link, shown while people arrive) */
  corner?: RenderedSlideBlock;
  /** stanza label, e.g. "2" or "Refrain" */
  label?: L10n;
  refrain?: boolean;
  /** continues the stanza / paragraph / verse of the slide before (songs show a small "…" instead of the label) */
  cont?: boolean;
  /** the item has more than one speaker (Leader / People): show the speaker labels */
  speakers?: boolean;
  /** big title (title / section / sermon / item slides) */
  big?: L10n;
  sub?: L10n;
  meta?: string[];
  lines?: Partial<Record<Lang, SlideLine[]>>;
  verses?: Partial<Record<Lang, SlideVerse[]>>;
  /** footer, e.g. scripture reference + translation */
  footer?: L10n;
  /** what the congregation does (first slide of the item only); shown when the theme turns it on */
  posture?: Posture;
  /** 'blocks' slides: the QR codes, pictures and notes to show (1–4, in a row) */
  blocks?: RenderedSlideBlock[];
  /** the item's own background picture (Library → Slide backgrounds), instead of the template's */
  bg?: { id: number; v: string };
}

/** At most this many blocks share one slide (more would make the QR codes too small to scan). */
export const MAX_SLIDE_BLOCKS = 4;

/** Blocks that can be drawn: a QR code with something to encode, a picture or caption, a note with words. */
const showable = (b: RenderedSlideBlock) =>
  b.kind === 'qr' ? !!b.value : b.kind === 'image' ? b.has_image || hasAny(b.caption) : hasAny(b.text);

/**
 * The slide after an item that shows its QR codes / pictures / notes (e.g. PayNow and Instagram during the
 * offering). The item title is the small heading; an item that is not otherwise on the slides gets it as a title instead.
 */
export function blocksSlide(it: RenderedItem, titled: boolean): SlideDef | null {
  const blocks = (it.slide_blocks ?? []).filter(showable).slice(0, MAX_SLIDE_BLOCKS);
  if (!blocks.length) return null;
  return { key: `${it.id}-blocks`, type: 'blocks', itemId: it.id, kind: it.kind, ...(titled ? { big: it.title } : { heading: it.title }), blocks };
}

const splitLines = (s: string | undefined): Line[] =>
  (s ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ who: null, text }));

/**
 * Hymn words: each stanza is cut by line index into slides of at most `limit` lines per language (balanced: four
 * lines at three a slide give 2 + 2). Languages with different line counts are spread proportionally so they finish
 * on the same slide. The stanza label goes on the first slide; the others carry `cont`.
 */
function songSlides(it: RenderedItem, langs: Lang[], limits?: Partial<LineLimits> | null): SlideDef[] {
  const s = it.song!;
  const out: SlideDef[] = [];
  s.stanzas.forEach((st, i) => {
    const sl = langs.filter((l) => st.text[l]?.trim());
    if (!sl.length) return;
    const label: L10n | undefined = s.stanzas.length > 1 ? Object.fromEntries(langs.map((l) => [l, stanzaLabel(st.label, l)])) : undefined;
    const chunks = alignChunks(sl.map((l) => splitLines(st.text[l])), lineLimit(sl.length, limits));
    chunks.forEach((c, j) => {
      const lines: Partial<Record<Lang, SlideLine[]>> = {};
      sl.forEach((l, li) => {
        if (c[li].length) lines[l] = c[li];
      });
      out.push({
        key: `${it.id}-s${i}${chunks.length > 1 ? `.${j}` : ''}`, type: 'lyrics', itemId: it.id, heading: s.number ? it.subtitle : s.title,
        ...(j === 0 ? { label } : { cont: true }), refrain: isRefrain(st.label), lines,
      });
    });
  });
  return out;
}

/**
 * A reading: whole verses are grouped while every language stays within `limit` sentences; a verse longer than that
 * is cut into parts holding the same share of the verse in each language, the verse number on the first part only.
 */
function scriptureSlides(it: RenderedItem, langs: Lang[], limits?: Partial<LineLimits> | null): SlideDef[] {
  const sc = it.scripture;
  const vLangs = langs.filter((l) => sc?.passages[l]?.verses.length);
  const out: SlideDef[] = [];
  if (vLangs.length) {
    // Align by chapter:verse so each slide shows the same verses in every language.
    const keys: string[] = [];
    const by: Record<string, Partial<Record<Lang, RenderedVerse>>> = {};
    for (const l of vLangs) {
      for (const v of sc!.passages[l]!.verses) {
        const k = `${v.chapter}:${v.verse}`;
        if (!by[k]) {
          by[k] = {};
          keys.push(k);
        }
        by[k][l] = v;
      }
    }
    const firstCh = Number(keys[0]?.split(':')[0]);
    const units = keys.map((k) => vLangs.map((l) => (by[k][l] ? splitSentences(by[k][l]!.text, l) : [])));
    const groups = groupUnits(units, lineLimit(vLangs.length, limits), vLangs);
    const trans = (l: Lang) => sc!.passages[l]?.translation ?? '';
    const footer: L10n = {};
    for (const l of langs) {
      const ref = sc!.ref[l] ?? sc!.ref.en ?? '';
      footer[l] = [ref, trans(l)].filter(Boolean).join(' · ');
    }
    groups.forEach((pieces, ci) => {
      const verses: Partial<Record<Lang, SlideVerse[]>> = {};
      vLangs.forEach((l, li) => {
        const vs = pieces
          .filter((p) => p.sentences[li].length)
          .map((p) => {
            const v = by[keys[p.unit]][l]!;
            return { n: p.part > 0 ? '' : v.chapter !== firstCh ? `${v.chapter}:${v.verse}` : String(v.verse), text: joinPieces(p.sentences[li]) };
          });
        if (vs.length) verses[l] = vs;
      });
      out.push({ key: `${it.id}-v${ci}`, type: 'scripture', itemId: it.id, heading: it.title, verses, footer, ...(pieces[0].part > 0 ? { cont: true } : {}) });
    });
    return out;
  }
  // Pasted text only (e.g. a licensed translation): sentences per slide, paragraph by paragraph.
  if (it.paras) return textSlides(it, langs, limits, sc?.ref);
  return [];
}

/**
 * Liturgy, creeds, prayers: paragraph by paragraph, at most `limit` sentences per language a slide, languages
 * kept aligned. A line split over two slides repeats its speaker label (Leader / People) on the second.
 */
function textSlides(it: RenderedItem, langs: Lang[], limits?: Partial<LineLimits> | null, footer?: L10n): SlideDef[] {
  const paras = it.paras ?? {};
  const pl = langs.filter((l) => paras[l]?.length);
  const n = Math.max(0, ...pl.map((l) => (paras[l] as Paras).length));
  const speakers = pl.some((l) => new Set((paras[l] as Paras).flat().map((x) => x.who).filter(Boolean)).size > 1);
  const out: SlideDef[] = [];
  for (let i = 0; i < n; i++) {
    const present = pl.filter((l) => paras[l]![i]?.length);
    if (!present.length) continue;
    const chunks = chunkParagraph(present.map((l) => paras[l]![i]), present, lineLimit(present.length, limits));
    chunks.forEach((c, j) => {
      const lines: Partial<Record<Lang, SlideLine[]>> = {};
      present.forEach((l, li) => {
        if (c[li].length) lines[l] = c[li];
      });
      if (!Object.keys(lines).length) return;
      out.push({
        key: `${it.id}-p${i}${chunks.length > 1 ? `.${j}` : ''}`, type: 'text', itemId: it.id, heading: it.title, lines,
        footer: footer && hasAny(footer) ? footer : undefined, ...(speakers ? { speakers } : {}), ...(j > 0 ? { cont: true } : {}),
      });
    });
  }
  return out;
}

function titleSlide(it: RenderedItem): SlideDef {
  return { key: `${it.id}-t`, type: 'item', itemId: it.id, big: it.title, sub: hasAny(it.subtitle) ? it.subtitle : undefined, meta: it.leader ? [it.leader] : [] };
}

/**
 * The slides of a service in the languages shown. `limits` (the slide theme's max_lines_multi / max_lines_single)
 * caps the lines (lyric lines or sentences) per language on a slide; the limit depends on how many of the shown
 * languages an item actually has.
 */
export function buildSlides(r: RenderedService, langs: Lang[], limits?: Partial<LineLimits> | null): SlideDef[] {
  const slides: SlideDef[] = [];
  // the bulletin link's QR code (for people as they arrive) sits in a corner of the title slide, on screen before the service
  const corner = (r.opening_blocks ?? []).filter(showable)[0];
  slides.push({ key: 'title', type: 'title', itemId: null, kind: 'service', heading: r.church.name, big: r.title, sub: hasAny(r.theme) ? r.theme : undefined, ...(corner ? { corner } : {}) });
  for (const it of r.items) {
    const own: SlideDef[] = it.on_slides ? itemSlides(r, it, langs, limits) : [];
    // QR codes / notes: one slide after the item's own; an item that is not on the slides shows only this one
    const b = it.kind === 'section' ? null : blocksSlide(it, !it.on_slides);
    if (b) own.push(b);
    slides.push(...(it.slide_bg ? own.map((s) => ({ ...s, bg: it.slide_bg! })) : own));
  }
  return slides;
}

function itemSlides(r: RenderedService, it: RenderedItem, langs: Lang[], limits?: Partial<LineLimits> | null): SlideDef[] {
  if (it.kind === 'section') return [{ key: `${it.id}-sec`, type: 'section', itemId: it.id, kind: it.kind, big: it.title }];
  if (it.kind === 'sermon') {
    const m: string[] = [];
    if (it.leader) m.push(it.leader);
    const title = hasAny(r.sermon_title) ? r.sermon_title : hasAny(it.subtitle) ? it.subtitle : it.title;
    return [{ key: `${it.id}-sermon`, type: 'sermon', itemId: it.id, kind: it.kind, heading: it.title, big: title, sub: hasAny(r.sermon_ref) ? r.sermon_ref : undefined, meta: m, ...(it.posture ? { posture: it.posture } : {}) }];
  }
  let s: SlideDef[] = [];
  if (it.song?.stanzas.length) s = songSlides(it, langs, limits);
  else if (it.kind === 'scripture') s = scriptureSlides(it, langs, limits);
  else if (it.paras) s = textSlides(it, langs, limits);
  if (!s.length) s = [titleSlide(it)];
  return s.map((x, i) => ({ ...x, kind: it.kind, ...(i === 0 && it.posture ? { posture: it.posture } : {}) }));
}

/** One line of plain text describing a slide (for the "next" preview). */
export function slideText(s: SlideDef, langs: Lang[], max = 90): string {
  let txt = '';
  if (s.lines) txt = langs.map((l) => s.lines![l]?.map((x) => x.text.replace(/\n/g, ' ')).join(' / ')).filter(Boolean)[0] ?? '';
  else if (s.verses) txt = langs.map((l) => s.verses![l]?.map((v) => `${v.n} ${v.text}`).join(' ')).filter(Boolean)[0] ?? '';
  else if (s.blocks) txt = `▦ ${s.blocks.map((b) => biText(b.kind === 'text' ? b.text : b.caption, langs.slice(0, 1)).split('\n')[0] || (b.kind === 'qr' ? 'QR' : '…')).join(' · ')}`;
  else txt = biText(s.big, langs);
  const head = s.label ? `${biText(s.label, langs.slice(0, 1))} · ` : '';
  const full = head + txt;
  return full.length > max ? full.slice(0, max - 1) + '…' : full;
}

/** Where an item's slides are in the deck (numbered from 1, as the slide footer and "number + Enter" count). */
export interface ItemSlideNumbers {
  first: number;
  last: number;
  /** where each stanza starts (a refrain sung after each stanza lists every place), and the QR code / note slide */
  parts: { key: string; label: L10n; refrain?: boolean; blocks?: boolean; at: number[] }[];
}

/** Slide numbers per item, for the run sheet's AV cues. */
export function slideNumbers(slides: SlideDef[]): Map<number, ItemSlideNumbers> {
  const out = new Map<number, ItemSlideNumbers>();
  slides.forEach((s, i) => {
    if (s.itemId == null) return;
    const n = i + 1;
    let e = out.get(s.itemId);
    if (!e) out.set(s.itemId, (e = { first: n, last: n, parts: [] }));
    e.last = n;
    // the stanza label is on a stanza's first slide only (later slides of a long stanza carry `cont`)
    const key = s.type === 'blocks' ? '#blocks' : s.label ? JSON.stringify(s.label) : null;
    if (!key) return;
    let p = e.parts.find((x) => x.key === key);
    if (!p) e.parts.push((p = { key, label: s.label ?? {}, ...(s.refrain ? { refrain: true } : {}), ...(s.type === 'blocks' ? { blocks: true } : {}), at: [] }));
    p.at.push(n);
  });
  return out;
}

/**
 * Where to go in a re-chunked deck (the language mode changed, so slides hold more or fewer lines): the same slide
 * if it still exists, else the same position within the same item, else the nearest index.
 */
export function mapSlideIndex(from: SlideDef[], idx: number, to: SlideDef[]): number {
  if (!to.length) return 0;
  const cur = from[idx];
  if (!cur) return Math.min(Math.max(0, idx), to.length - 1);
  const exact = to.findIndex((s) => s.key === cur.key);
  if (exact >= 0) return exact;
  const mine = (xs: SlideDef[]) => xs.map((s, i) => ({ s, i })).filter((x) => x.s.itemId === cur.itemId);
  const a = mine(from);
  const b = mine(to);
  if (cur.itemId != null && b.length) {
    const pos = a.findIndex((x) => x.i === idx) / Math.max(1, a.length);
    return b[Math.min(b.length - 1, Math.floor(pos * b.length))].i;
  }
  return Math.min(idx, to.length - 1);
}
