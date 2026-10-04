// Builds the projector slide list from a rendered service (shared by Slides and the run sheet's AV cues).
import type { L10n, Lang, Line, Paras, Posture, RenderedItem, RenderedService } from '../types-client.ts';
import type { RenderedSlideBlock, RenderedVerse } from '../../shared/render-types.ts';
import { biText, hasAny, isRefrain, stanzaLabel, textWeight } from '../../shared/output-labels.ts';

export type SlideType = 'title' | 'section' | 'lyrics' | 'scripture' | 'text' | 'sermon' | 'item' | 'blocks';

export interface SlideVerse {
  n: string;
  text: string;
}

export interface SlideDef {
  key: string;
  type: SlideType;
  /** id of the run-sheet item (null for the service title slide) */
  itemId: number | null;
  /** item kind for the theme's .kind-<kind> class hook ('service' for the title slide) */
  kind?: string;
  /** small heading at the top (song title, item title) */
  heading?: L10n;
  /** stanza label, e.g. "2" or "Refrain" */
  label?: L10n;
  refrain?: boolean;
  /** big title (title / section / sermon / item slides) */
  big?: L10n;
  sub?: L10n;
  meta?: string[];
  lines?: Partial<Record<Lang, Line[]>>;
  verses?: Partial<Record<Lang, SlideVerse[]>>;
  /** footer, e.g. scripture reference + translation */
  footer?: L10n;
  /** what the congregation does (first slide of the item only); shown when the theme turns it on */
  posture?: Posture;
  /** 'blocks' slides: the QR codes, pictures and notes to show (1–4, in a row) */
  blocks?: RenderedSlideBlock[];
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

const CHUNK = 350;
/** Width-weighted length: in a CJK language (isCJK) a character takes about 2.2 Latin characters of room. */
export const weight = (s: string, lang?: Lang) => textWeight(s, lang);
/** Text budget per slide: three stacked languages share the height, so each gets less. */
const budget = (n: number, nLangs: number) => (nLangs > 2 ? Math.round(n * 0.7) : n);

const splitLines = (s: string | undefined): Line[] =>
  (s ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ who: null, text }));

function songSlides(it: RenderedItem, langs: Lang[]): SlideDef[] {
  const s = it.song!;
  return s.stanzas
    .map((st, i): SlideDef | null => {
      const lines: Partial<Record<Lang, Line[]>> = {};
      for (const l of langs) if (st.text[l]?.trim()) lines[l] = splitLines(st.text[l]);
      if (!Object.keys(lines).length) return null;
      const label: L10n | undefined = s.stanzas.length > 1 ? Object.fromEntries(langs.map((l) => [l, stanzaLabel(st.label, l)])) : undefined;
      return { key: `${it.id}-s${i}`, type: 'lyrics', itemId: it.id, heading: s.number ? it.subtitle : s.title, label, refrain: isRefrain(st.label), lines };
    })
    .filter((x): x is SlideDef => !!x);
}

function scriptureSlides(it: RenderedItem, langs: Lang[]): SlideDef[] {
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
    const chunks: string[][] = [];
    let cur: string[] = [];
    const size = (ks: string[]) => Math.max(...vLangs.map((l) => ks.reduce((n, k) => n + weight(by[k][l]?.text ?? '', l), 0)));
    const cap = budget(CHUNK, vLangs.length);
    for (const k of keys) {
      if (cur.length && size([...cur, k]) > cap) {
        chunks.push(cur);
        cur = [];
      }
      cur.push(k);
    }
    if (cur.length) chunks.push(cur);
    const trans = (l: Lang) => sc!.passages[l]?.translation ?? '';
    const footer: L10n = {};
    for (const l of langs) {
      const ref = sc!.ref[l] ?? sc!.ref.en ?? '';
      footer[l] = [ref, trans(l)].filter(Boolean).join(' · ');
    }
    chunks.forEach((ks, ci) => {
      const verses: Partial<Record<Lang, SlideVerse[]>> = {};
      for (const l of vLangs) {
        verses[l] = ks
          .filter((k) => by[k][l])
          .map((k) => {
            const v = by[k][l]!;
            return { n: v.chapter !== firstCh ? `${v.chapter}:${v.verse}` : String(v.verse), text: v.text.trim() };
          });
      }
      out.push({ key: `${it.id}-v${ci}`, type: 'scripture', itemId: it.id, heading: it.title, verses, footer });
    });
    return out;
  }
  // Pasted text only (e.g. a licensed translation): one slide per paragraph.
  if (it.paras) return textSlides(it, langs, sc?.ref);
  return [];
}

/** Weighted size above which a paragraph is spread over several slides. */
const PARA_LIMIT = 320;
const lineWeight = (ls: Line[], lang?: Lang) => ls.reduce((n, l) => n + weight(l.text, lang), 0);

/** Break over-long single lines at sentence / clause punctuation. */
function breakLongLines(lines: Line[], lang?: Lang): Line[] {
  return lines.flatMap((ln) => {
    if (weight(ln.text, lang) <= PARA_LIMIT / 2) return [ln];
    const parts = ln.text.match(/[^.;:!?。；：！？]+[.;:!?。；：！？]*["'”’」』）)]*\s*/g) ?? [ln.text];
    return parts.map((p) => p.trim()).filter(Boolean).map((text) => ({ who: ln.who, text }));
  });
}

/** Split lines into k contiguous groups of roughly equal weight. */
function splitInto(lines: Line[], k: number, lang?: Lang): Line[][] {
  const total = lineWeight(lines, lang);
  const groups: Line[][] = Array.from({ length: k }, () => []);
  let acc = 0;
  for (const ln of lines) {
    const g = Math.min(k - 1, Math.floor((acc / total) * k));
    groups[g].push(ln);
    acc += weight(ln.text, lang);
  }
  return groups;
}

function textSlides(it: RenderedItem, langs: Lang[], footer?: L10n): SlideDef[] {
  const paras = it.paras ?? {};
  const pl = langs.filter((l) => paras[l]?.length);
  const n = Math.max(0, ...pl.map((l) => (paras[l] as Paras).length));
  const out: SlideDef[] = [];
  for (let i = 0; i < n; i++) {
    const src: Partial<Record<Lang, Line[]>> = {};
    for (const l of pl) if (paras[l]![i]) src[l] = breakLongLines(paras[l]![i], l);
    const present = Object.keys(src) as Lang[];
    const limit = budget(PARA_LIMIT, present.length);
    const k = Math.max(1, Math.min(Math.ceil(Math.max(...present.map((l) => lineWeight(src[l]!, l))) / limit), Math.min(...present.map((l) => src[l]!.length))));
    const parts: Partial<Record<Lang, Line[][]>> = {};
    for (const l of present) parts[l] = k > 1 ? splitInto(src[l]!, k, l) : [src[l]!];
    for (let j = 0; j < k; j++) {
      const lines: Partial<Record<Lang, Line[]>> = {};
      for (const l of present) if (parts[l]![j]?.length) lines[l] = parts[l]![j];
      out.push({ key: `${it.id}-p${i}${k > 1 ? `.${j}` : ''}`, type: 'text', itemId: it.id, heading: it.title, lines, footer: footer && hasAny(footer) ? footer : undefined });
    }
  }
  return out;
}

function titleSlide(it: RenderedItem): SlideDef {
  return { key: `${it.id}-t`, type: 'item', itemId: it.id, big: it.title, sub: hasAny(it.subtitle) ? it.subtitle : undefined, meta: it.leader ? [it.leader] : [] };
}

export function buildSlides(r: RenderedService, langs: Lang[]): SlideDef[] {
  const slides: SlideDef[] = [];
  slides.push({ key: 'title', type: 'title', itemId: null, kind: 'service', heading: r.church.name, big: r.title, sub: hasAny(r.theme) ? r.theme : undefined });
  for (const it of r.items) {
    if (it.on_slides) slides.push(...itemSlides(r, it, langs));
    // QR codes / notes: one slide after the item's own; an item that is not on the slides shows only this one
    const b = it.kind === 'section' ? null : blocksSlide(it, !it.on_slides);
    if (b) slides.push(b);
  }
  return slides;
}

function itemSlides(r: RenderedService, it: RenderedItem, langs: Lang[]): SlideDef[] {
  if (it.kind === 'section') return [{ key: `${it.id}-sec`, type: 'section', itemId: it.id, kind: it.kind, big: it.title }];
  if (it.kind === 'sermon') {
    const m: string[] = [];
    if (it.leader) m.push(it.leader);
    const title = hasAny(r.sermon_title) ? r.sermon_title : hasAny(it.subtitle) ? it.subtitle : it.title;
    return [{ key: `${it.id}-sermon`, type: 'sermon', itemId: it.id, kind: it.kind, heading: it.title, big: title, sub: hasAny(r.sermon_ref) ? r.sermon_ref : undefined, meta: m, ...(it.posture ? { posture: it.posture } : {}) }];
  }
  let s: SlideDef[] = [];
  if (it.song?.stanzas.length) s = songSlides(it, langs);
  else if (it.kind === 'scripture') s = scriptureSlides(it, langs);
  else if (it.paras) s = textSlides(it, langs);
  if (!s.length) s = [titleSlide(it)];
  return s.map((x, i) => ({ ...x, kind: it.kind, ...(i === 0 && it.posture ? { posture: it.posture } : {}) }));
}

/** One line of plain text describing a slide (for the "next" preview). */
export function slideText(s: SlideDef, langs: Lang[], max = 90): string {
  let txt = '';
  if (s.lines) txt = langs.map((l) => s.lines![l]?.map((x) => x.text).join(' / ')).filter(Boolean)[0] ?? '';
  else if (s.verses) txt = langs.map((l) => s.verses![l]?.map((v) => `${v.n} ${v.text}`).join(' ')).filter(Boolean)[0] ?? '';
  else if (s.blocks) txt = `▦ ${s.blocks.map((b) => biText(b.kind === 'text' ? b.text : b.caption, langs.slice(0, 1)).split('\n')[0] || (b.kind === 'qr' ? 'QR' : '…')).join(' · ')}`;
  else txt = biText(s.big, langs);
  const head = s.label ? `${biText(s.label, langs.slice(0, 1))} · ` : '';
  const full = head + txt;
  return full.length > max ? full.slice(0, max - 1) + '…' : full;
}
