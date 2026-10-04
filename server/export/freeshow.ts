// FreeShow (https://freeshow.app, GPL, github.com/ChurchApps/FreeShow) project export.
//
// Format notes — checked against FreeShow `main` (Oct 2026):
// VERIFIED (read from source):
//  - A `.project` file may be plain JSON (or a zip with media); FreeShow's importer reads
//    `{ project, parentFolder, shows, overlays?, effects?, actions?, media?, categories? }`.
//    https://github.com/ChurchApps/FreeShow/blob/main/src/frontend/converters/project.ts (importProject)
//    https://github.com/ChurchApps/FreeShow/blob/main/src/frontend/components/export/project.ts (exportProject)
//    https://github.com/ChurchApps/FreeShow/blob/main/src/electron/data/import.ts ("some .project files are plain JSON")
//  - Project = { name, created, parent, shows: ProjectShowRef[] }; a show ref is { id } (type defaults to "show");
//    a section divider is { id, type: "section", name, notes }.            src/types/Projects.ts, src/frontend/values/empty.ts
//  - Show = { name, category, settings: { activeLayout, template }, timestamps, meta, slides, layouts, media };
//    Slide = { group, color, settings, notes, items }; Item = { style, lines: [{ align, text: [{ value, style }] }] };
//    Layout = { name, notes, slides: [{ id }] } — a layout may reference the same slide more than once
//    (that is how a repeated chorus is sung).                                src/types/Show.ts, src/frontend/classes/Show.ts
//  - Default text box geometry on the 1920x1080 canvas: "top:88px;left:50px;height:904px;width:1820px;".
//                                                                          src/frontend/components/edit/scripts/itemHelpers.ts
//  - Default group colours (verse #5825f5, chorus #f525d2, bridge #f52598 ...). src/electron/data/defaults.ts
//  - Pictures on a slide (QR codes & notes blocks): a media item is { type: "media", style, src, fit? }
//    (Item.src "media item path" L131, Item.fit L134 in src/types/Show.ts; the editor makes one with just
//    { style, type: "media", src }: src/frontend/components/edit/scripts/itemHelpers.ts addItem ~L85).
//    It renders through src/frontend/components/slide/SlideItems.svelte (L92) → views/MediaItem.svelte: loadMedia()
//    calls getMedia(src), which returns a non-local path unchanged (helpers/media.ts getMedia L206-L207:
//    `if (!isLocalFile(path) ...) return finish(path, path)`), and isLocalFile() is false for "data:" (L67-L71), so
//    encodeFilePath() hands a data: URI to <img src> as is (L74-L76; drawer/media/Image.svelte L44). A data: URI
//    has no ".", so getExtension() gives no video extension and getMediaType() says "image". object-fit is
//    item.fit || "contain". The same code is in the v1.6.5 release (tag v1.6.5, helpers/media.ts L67-L76, L207).
//    So QR codes (PNG from qrPng) and uploaded pictures are embedded as data: URIs and the file stays plain JSON.
//    https://github.com/ChurchApps/FreeShow/blob/main/src/frontend/components/slide/views/MediaItem.svelte
//    https://github.com/ChurchApps/FreeShow/blob/main/src/frontend/components/helpers/media.ts
//  - Not used, for the record: (1) a zip `.project` — data.json plus `files: [originalPath]` and the media at the zip
//    root named `<name>__<filePathHashCode(path)><ext>` (or plain basename); the importer extracts them to
//    <data>/imports/Projects and rewrites the paths (src/electron/data/import.ts importProject L189,
//    extractZipDataAndMedia L282-L338; src/electron/data/export.ts exportProject L306). Works too, but needs a
//    second download format. (2) a native { type: "qr_code", qr_code: { text } } item (views/QrCode.svelte) exists
//    only since 1.6.6-beta.2 (Sept 2026), not in the 1.6.5 release, so it is not used yet.
// ASSUMED (not exercised against a running FreeShow):
//  - The data: URI pictures display in the output window as in the editor (same MediaItem path), and a
//    2 MB picture (the upload limit) inside a show file does not slow FreeShow down noticeably.
//  - Explicit custom group names ("Verse 1", "Refrain") display as written (no `globalGroup`), and text styles
//    such as "font-size:72px;" / "font-weight:bold;" are honoured; text auto-shrinks to fit by default.
//  - Re-importing a file with the same project/show ids updates them rather than duplicating
//    (importProject passes the old project id to its history "UPDATE").
import type { L10n, Lang } from '../../shared/types.ts';
import type { Line, Paras, RenderedItem, RenderedService, RenderedVerse } from '../../shared/render-types.ts';
import { blockImageKey } from '../../shared/presentation.ts';
import { alignChunks, chunkParagraph, groupUnits, joinPieces, lineLimit, splitSentences, type LineLimits } from '../../shared/slide-chunks.ts';
import { assetRow, getTheme, qrPng } from '../repo/presentation.ts';

// ---------------------------------------------------------------- FreeShow shapes (subset of src/types/Show.ts)

interface FsText { value: string; style: string }
interface FsLine { align: string; text: FsText[] }
/** A text box (lines) or, with type "media", a picture: src is a file path, an http(s) URL or a data: URI. */
interface FsItem { style: string; lines?: FsLine[]; type?: 'media'; src?: string; fit?: 'contain' }
interface FsSlide { group: string | null; color: string | null; settings: Record<string, unknown>; notes: string; items: FsItem[] }
interface FsShow {
  name: string;
  category: string | null;
  settings: { activeLayout: string; template: string | null };
  timestamps: { created: number; modified: number | null; used: number | null };
  quickAccess: Record<string, unknown>;
  meta: Record<string, string>;
  slides: Record<string, FsSlide>;
  layouts: Record<string, { name: string; notes: string; slides: { id: string }[] }>;
  media: Record<string, unknown>;
}
type FsProjectRef = { id: string } | { id: string; type: 'section'; name: string; notes: string };
export interface FreeShowProjectFile {
  project: { id: string; name: string; created: number; modified: number; used: number; parent: string; shows: FsProjectRef[] };
  parentFolder: string;
  shows: Record<string, FsShow>;
}

// ---------------------------------------------------------------- layout constants (1920x1080 canvas)

const FULL_BOX = 'top:88px;left:50px;height:904px;width:1820px;';
const TOP_BOX = 'top:50px;left:50px;height:480px;width:1820px;';
const BOTTOM_BOX = 'top:550px;left:50px;height:480px;width:1820px;';
/** Three languages: three bands of the screen, top to bottom in the service's language order. */
const THIRD_BOXES = [
  'top:40px;left:50px;height:320px;width:1820px;',
  'top:380px;left:50px;height:320px;width:1820px;',
  'top:720px;left:50px;height:320px;width:1820px;',
];
const CENTER = 'text-align:center;';
const LEFT = 'text-align:left;';

const COLORS = { verse: '#5825f5', chorus: '#f525d2', bridge: '#f52598', tag: '#7525f5', intro: '#d525f5', text: '#3a7bd5', title: '#888888' };

/** Lines per slide: the service's slide theme (max_lines_multi / max_lines_single), as on Canon's own slides. */
type Limits = Partial<LineLimits> | null | undefined;

// ---------------------------------------------------------------- helpers

const pick = (x: L10n | null | undefined, l: Lang) => (x?.[l] ?? '').trim();
function bi(x: L10n | null | undefined, langs: Lang[], sep = ' '): string {
  if (!x) return '';
  const parts = [...new Set(langs.map((l) => pick(x, l)).filter(Boolean))];
  return parts.length ? parts.join(sep) : (Object.values(x).find((v) => v?.trim()) ?? '').trim();
}
const splitLines = (s: string | undefined) => (s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);

const textStyle = (size: number, extra = '') => `font-size:${size}px;${extra}`;
const line = (value: string, style: string, align = CENTER): FsLine => ({ align, text: [{ value, style }] });

/** One text box per language: full screen for one, top/bottom halves for two, thirds for three (in r.languages order). */
function boxes(perLang: FsLine[][]): FsItem[] {
  const filled = perLang.filter((l) => l.length);
  if (filled.length <= 1) return filled.map((lines) => ({ style: FULL_BOX, lines }));
  if (filled.length === 2) return filled.map((lines, i) => ({ style: i ? BOTTOM_BOX : TOP_BOX, lines }));
  return filled.slice(0, 3).map((lines, i) => ({ style: THIRD_BOXES[i], lines }));
}

function fontSize(lineCount: number, langCount: number) {
  const base = langCount > 2 ? 50 : langCount > 1 ? 64 : 84;
  return lineCount > 6 ? Math.round(base * 0.8) : base;
}

function stanzaGroup(label: string): { name: string; color: string } {
  const k = label.trim().toUpperCase();
  if (/^\d+$/.test(k)) return { name: `Verse ${k}`, color: COLORS.verse };
  if (k === 'R' || k === 'REFRAIN') return { name: 'Refrain', color: COLORS.chorus };
  if (k === 'C' || k === 'CHORUS') return { name: 'Chorus', color: COLORS.chorus };
  if (k === 'B' || k === 'BRIDGE') return { name: 'Bridge', color: COLORS.bridge };
  if (k === 'AMEN') return { name: 'Amen', color: COLORS.tag };
  return { name: label, color: COLORS.verse };
}

/** Ids are deterministic so a re-export of the same service maps onto the same FreeShow objects. */
const ids = (svcId: number) => ({
  project: `canon-svc-${svcId}`,
  show: (itemId: number) => `canon-${svcId}-${itemId}`,
  section: (itemId: number) => `canon-${svcId}-${itemId}-section`,
});

// ---------------------------------------------------------------- slide builders

interface Built { slides: { key: string; slide: FsSlide }[]; order: string[] }

function newBuilt(): Built {
  return { slides: [], order: [] };
}
function addSlide(b: Built, key: string, slide: FsSlide, repeat = 1) {
  if (!b.slides.find((s) => s.key === key)) b.slides.push({ key, slide });
  for (let i = 0; i < repeat; i++) b.order.push(key);
}
const slide = (group: string, color: string, items: FsItem[], notes = ''): FsSlide => ({ group, color, settings: {}, notes, items });

function titleSlide(it: RenderedItem, langs: Lang[], extra: string[] = []): FsSlide {
  const perLang = langs.map((l) => {
    const lines: FsLine[] = [];
    if (pick(it.title, l)) lines.push(line(pick(it.title, l), textStyle(langs.length > 2 ? 64 : langs.length > 1 ? 80 : 100, 'font-weight:bold;')));
    if (pick(it.subtitle, l) && pick(it.subtitle, l) !== pick(it.title, l)) lines.push(line(pick(it.subtitle, l), textStyle(56, 'font-style:italic;')));
    return lines;
  });
  if (extra.length) {
    const last = perLang.map((p, i) => ({ p, i })).filter(({ p }) => p.length).pop();
    const target = last ? perLang[last.i] : (perLang[0] ??= []);
    for (const e of extra) target.push(line(e, textStyle(48)));
  }
  // Fall back to any title text when the requested languages have none
  if (!perLang.some((p) => p.length)) perLang[0] = [line(bi(it.title, Object.keys(it.title)) || it.kind, textStyle(100, 'font-weight:bold;'))];
  return slide(bi(it.title, langs) || 'Title', COLORS.title, boxes(perLang));
}

/** A stanza becomes one slide per chunk of lines (by line index, the same chunking as Canon's slides). */
function songSlides(it: RenderedItem, langs: Lang[], limits?: Limits): Built {
  const b = newBuilt();
  for (const st of it.song!.stanzas) {
    const key = `${st.label}|${langs.map((l) => st.text[l] ?? '').join('|')}`;
    const { name, color } = stanzaGroup(st.label);
    const perLang = langs.map((l) => splitLines(st.text[l]));
    const shown = perLang.filter((p) => p.length).length;
    const chunks = alignChunks(perLang, lineLimit(shown, limits));
    chunks.forEach((c, j) => {
      const size = fontSize(Math.max(...c.map((p) => p.length)), shown);
      // a repeated refrain re-uses the same slides (same keys)
      addSlide(b, chunks.length > 1 ? `${key}#${j}` : key, slide(name, color, boxes(c.map((p) => p.map((t) => line(t, textStyle(size)))))));
    });
  }
  return b;
}

function verseText(v: RenderedVerse, showChapter: boolean, first: boolean, number = true): FsText[] {
  if (!number) return [{ value: `${first ? '' : ' '}${v.text.trim()}`, style: '' }];
  return [
    { value: `${first ? '' : ' '}${showChapter ? `${v.chapter}:` : ''}${v.verse} `, style: 'font-size:40px;color:#bbbbbb;' },
    { value: v.text.trim(), style: '' },
  ];
}

function scriptureSlides(it: RenderedItem, langs: Lang[], limits?: Limits): Built {
  const b = newBuilt();
  const ref = bi(it.scripture?.ref ?? it.subtitle, langs, ' · ');
  const withVerses = langs.filter((l) => it.scripture?.passages[l]?.verses.length);
  const withParas = langs.filter((l) => !withVerses.includes(l) && it.paras?.[l]?.length);

  if (withVerses.length) {
    // Whole verses while every language stays within the lines (sentences) per slide; a longer verse is cut into
    // parts with the same share in each language, the verse number on the first part (as on Canon's own slides).
    const master = it.scripture!.passages[withVerses[0]]!.verses;
    const byKey: Map<string, RenderedVerse>[] = [];
    for (const l of withVerses) byKey.push(new Map(it.scripture!.passages[l]!.verses.map((v) => [`${v.chapter}:${v.verse}`, v])));
    const multiChapter = new Set(master.map((v) => v.chapter)).size > 1;
    const keyOf = (v: RenderedVerse) => `${v.chapter}:${v.verse}`;
    const units = master.map((mv) => withVerses.map((l, i) => {
      const v = byKey[i].get(keyOf(mv));
      return v ? splitSentences(v.text, l) : [];
    }));
    const groups = groupUnits(units, lineLimit(withVerses.length, limits), withVerses);

    groups.forEach((pieces, ci) => {
      const perLang = langs.map((l) => {
        const li = withVerses.indexOf(l);
        if (li < 0) return [];
        const texts = pieces.flatMap((p, pi) => {
          const v = byKey[li].get(keyOf(master[p.unit]));
          return v && p.sentences[li].length ? verseText({ ...v, text: joinPieces(p.sentences[li]) }, multiChapter, pi === 0, p.part === 0) : [];
        });
        const size = withVerses.length > 2 ? 44 : withVerses.length > 1 ? 52 : 68;
        return texts.length ? [{ align: LEFT, text: texts.map((t) => ({ ...t, style: t.style || textStyle(size) })) }] : [];
      });
      const first = master[pieces[0].unit];
      const last = master[pieces[pieces.length - 1].unit];
      const range = first === last ? `${first.chapter}:${first.verse}` : `${first.chapter}:${first.verse}-${last.chapter === first.chapter ? '' : `${last.chapter}:`}${last.verse}`;
      addSlide(b, `chunk${ci}`, slide(pieces[0].part > 0 ? `${range} …` : range, COLORS.verse, boxes(perLang), ref));
    });
  } else if (withParas.length) {
    return parasSlides(it, langs, ref, limits);
  } else {
    addSlide(b, 'title', titleSlide(it, langs));
  }
  return b;
}

function parasLines(para: Line[] | undefined, size: number): FsLine[] {
  // a sentence that spans several source lines keeps its line breaks
  return (para ?? []).flatMap((ln) => ln.text.split('\n').map((t) => line(t, textStyle(size, ln.who === 'C' || ln.who === 'A' ? 'font-weight:bold;' : ''))));
}

/** Paragraph by paragraph, at most the lines (sentences) per slide in each language, languages kept aligned. */
function parasSlides(it: RenderedItem, langs: Lang[], notes = '', limits?: Limits): Built {
  const b = newBuilt();
  const withParas = langs.filter((l) => it.paras?.[l]?.length);
  const n = Math.max(0, ...withParas.map((l) => (it.paras![l] as Paras).length));
  const group = bi(it.title, langs) || 'Text';
  for (let i = 0; i < n; i++) {
    const present = withParas.filter((l) => it.paras![l]![i]?.length);
    if (!present.length) continue;
    const chunks = chunkParagraph(present.map((l) => it.paras![l]![i]), present, lineLimit(present.length, limits));
    chunks.forEach((c, j) => {
      const size = fontSize(Math.max(...c.map((p) => p.length)), present.length);
      const perLang = langs.map((l) => (present.includes(l) ? parasLines(c[present.indexOf(l)], size) : []));
      addSlide(b, chunks.length > 1 ? `p${i}.${j}` : `p${i}`, slide(group, COLORS.text, boxes(perLang), notes));
    });
  }
  return b;
}

/** Block id → `data:` URI of the QR code PNG or the uploaded picture (see blockMedia). */
type BlockMedia = Map<number, string>;

/**
 * Pictures for every QR / picture block on the slides: a QR code as a PNG (qrPng) and an uploaded picture as stored,
 * both as `data:` URIs so the `.project` stays one self-contained JSON file. A code that cannot be drawn (text too
 * long) or a picture that has gone missing is left out; its slide then falls back to the caption text.
 */
async function blockMedia(r: RenderedService): Promise<BlockMedia> {
  const out: BlockMedia = new Map();
  for (const b of r.items.flatMap((it) => (it.kind === 'section' ? [] : it.slide_blocks ?? []))) {
    if (out.has(b.id)) continue;
    if (b.kind === 'qr' && b.value) {
      const png = await qrPng(b.value).catch(() => null);
      if (png) out.set(b.id, `data:image/png;base64,${png.toString('base64')}`);
    } else if (b.kind === 'image' && b.has_image) {
      const a = assetRow(blockImageKey(b.id));
      if (a?.data?.length) out.set(b.id, `data:${a.mime || 'image/png'};base64,${Buffer.from(a.data).toString('base64')}`);
    }
  }
  return out;
}

/** Caption / note lines in the service languages; a line shared by two languages (a UEN, an address) is shown once. */
function blockTextLines(words: L10n | undefined, langs: Lang[], style: string, seen = new Set<string>()): FsLine[] {
  const out: FsLine[] = [];
  for (const t of langs.flatMap((l) => splitLines(words?.[l]))) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(line(t, style));
  }
  return out;
}

const px = (n: number) => `${Math.round(n)}px`;
const box = (top: number, left: number, height: number, width: number) => `top:${px(top)};left:${px(left)};height:${px(height)};width:${px(width)};`;

/**
 * QR codes / pictures / notes after an item (e.g. the offering), laid out like Canon's own blocks slide: the item
 * title along the top, the codes and pictures side by side as FreeShow media items (`data:` URI src) with each
 * caption in a text box underneath, and the notes across the bottom. With no code or picture to show it is a plain
 * TEXT slide (notes, captions and, under a QR code that could not be drawn, the address it opens).
 */
function blocksSlide(it: RenderedItem, langs: Lang[], media: BlockMedia = new Map()): FsSlide | null {
  const blocks = (it.slide_blocks ?? []).filter((b) => b.kind !== 'qr' || b.value);
  const visuals = blocks.filter((b) => b.kind !== 'text' && media.has(b.id));
  if (!visuals.length) return blocksTextSlide(it, langs);

  const items: FsItem[] = [];
  const title = langs.map((l) => pick(it.title, l)).filter((t, i, a) => t && a.indexOf(t) === i).join('  ·  ');
  if (title) items.push({ style: box(30, 50, 110, 1820), lines: [line(title, textStyle(langs.length > 2 ? 48 : 60, 'font-weight:bold;'))] });

  // notes underneath, across the slide: note blocks, and captions of blocks drawn as text
  const seen = new Set<string>();
  const notes: FsLine[] = [];
  for (const b of blocks) {
    if (visuals.includes(b)) continue;
    const lines = b.kind === 'text'
      ? blockTextLines(b.text, langs, textStyle(44, b.bold ? 'font-weight:bold;' : ''), seen)
      : [...blockTextLines(b.caption, langs, textStyle(40, 'font-weight:bold;'), seen), ...(b.kind === 'qr' && b.value ? [line(b.value, textStyle(32, 'color:#bbbbbb;'))] : [])];
    notes.push(...lines);
  }

  const n = visuals.length;
  const colW = 1820 / n;
  const top = title ? 160 : 60;
  const bottom = notes.length ? 830 : 1040;
  const capH = n > 2 ? 190 : 160;
  const size = Math.max(160, Math.min(colW - 40, bottom - top - capH - 20));
  const capSize = n > 3 ? 30 : n > 2 ? 34 : n > 1 ? 40 : 44;
  visuals.forEach((b, i) => {
    const left = 50 + i * colW;
    // a QR code is square; a picture (e.g. a bank's PayNow QR with its frame) gets the column width, fitted inside
    const w = b.kind === 'qr' ? size : colW - 40;
    items.push({ type: 'media', src: media.get(b.id)!, fit: 'contain', style: box(top, left + (colW - w) / 2, size, w) });
    const cap = blockTextLines(b.caption, langs, textStyle(capSize, 'font-weight:bold;'));
    if (cap.length) items.push({ style: box(top + size + 20, left + 10, capH, colW - 20), lines: cap });
  });
  if (notes.length) items.push({ style: box(850, 50, 200, 1820), lines: notes });
  return slide('QR codes', COLORS.tag, items);
}

/** The text-only blocks slide (no code or picture to embed). */
function blocksTextSlide(it: RenderedItem, langs: Lang[]): FsSlide | null {
  const lines: FsLine[] = [];
  const seen = new Set<string>();
  const add = (text: string, style: string) => {
    if (text && !seen.has(text)) {
      seen.add(text);
      lines.push(line(text, style));
    }
  };
  let shown = 0;
  for (const b of it.slide_blocks ?? []) {
    const words = b.kind === 'text' ? b.text : b.caption;
    const texts = langs.flatMap((l) => splitLines(words?.[l]));
    if (b.kind === 'qr' && !b.value) continue;
    if (!texts.length && b.kind !== 'qr') continue;
    if (shown++) lines.push(line(' ', textStyle(24)));
    for (const t of texts) add(t, textStyle(b.kind === 'text' ? 60 : 56, b.kind !== 'text' || b.bold ? 'font-weight:bold;' : ''));
    if (b.kind === 'qr') add(b.value!, textStyle(44, 'color:#bbbbbb;'));
  }
  if (!lines.length) return null;
  const unDrawn = (it.slide_blocks ?? []).some((b) => (b.kind === 'qr' && b.value) || (b.kind === 'image' && b.has_image));
  return slide('QR codes', COLORS.tag, [{ style: FULL_BOX, lines }], unDrawn ? 'A QR code or picture could not be embedded: show the QR slide from Canon when people need to scan it.' : '');
}

// ---------------------------------------------------------------- show assembly

function makeShow(name: string, built: Built, showId: string, created: number, now: number, meta: Record<string, string> = {}): FsShow {
  const layoutId = `${showId}-layout`;
  const keyToId = new Map(built.slides.map((s, i) => [s.key, `${showId}-s${i + 1}`]));
  const slides: Record<string, FsSlide> = {};
  for (const s of built.slides) {
    // FreeShow treats group === null as a child slide; give every slide a (possibly empty) group.
    slides[keyToId.get(s.key)!] = { ...s.slide, group: s.slide.group ?? '' };
  }
  return {
    name,
    category: null,
    settings: { activeLayout: layoutId, template: null },
    timestamps: { created, modified: now, used: null },
    quickAccess: {},
    meta,
    slides,
    layouts: { [layoutId]: { name: 'Default', notes: '', slides: built.order.map((k) => ({ id: keyToId.get(k)! })) } },
    media: {},
  };
}

export function freeshowFilename(r: RenderedService): string {
  return `canon-${r.date}.project`;
}

export async function freeshowProject(r: RenderedService): Promise<FreeShowProjectFile> {
  const media = await blockMedia(r);
  const langs: Lang[] = r.languages.length ? r.languages : ['en'];
  let limits: Limits = null;
  try {
    limits = r.slide_theme_id ? getTheme(r.slide_theme_id).vars : null;
  } catch {
    /* theme gone: the default lines per slide */
  }
  const id = ids(r.id);
  const now = Date.now();
  const created = Date.parse(`${r.date}T00:00:00Z`) || now;
  const shows: Record<string, FsShow> = {};
  const refs: FsProjectRef[] = [];

  for (const it of r.items) {
    const qr = it.kind === 'section' ? null : blocksSlide(it, langs, media);
    if (!it.on_slides && !qr) continue;
    const title = bi(it.title, langs) || it.kind;
    const showId = id.show(it.id);
    let built: Built;
    let meta: Record<string, string> = {};

    if (!it.on_slides) {
      // an item that is not on the slides but has QR codes / notes (e.g. the offering): just that slide
      built = newBuilt();
    } else if (it.kind === 'section') {
      // A native FreeShow section divider for navigation, followed by a title card.
      refs.push({ id: id.section(it.id), type: 'section', name: title, notes: '' });
      built = newBuilt();
      addSlide(built, 'title', titleSlide(it, langs));
    } else if (it.song?.stanzas.length) {
      built = songSlides(it, langs, limits);
      const s = it.song;
      meta = Object.fromEntries(
        Object.entries({
          title: bi(s.title, langs),
          author: s.author ?? '',
          composer: s.composer ?? '',
          copyright: s.copyright ?? (s.public_domain ? 'Public domain' : ''),
          CCLI: s.ccli ?? '',
        }).filter(([, v]) => v),
      );
    } else if (it.kind === 'scripture') {
      built = scriptureSlides(it, langs, limits);
    } else if (it.kind === 'sermon') {
      built = newBuilt();
      const extra = [r.preacher ?? it.leader].filter((x): x is string => !!x);
      addSlide(built, 'title', titleSlide(it, langs, extra));
    } else if (it.paras && Object.values(it.paras).some((p) => p?.length)) {
      built = parasSlides(it, langs, '', limits);
    } else {
      built = newBuilt();
      addSlide(built, 'title', titleSlide(it, langs));
    }
    if (qr) addSlide(built, 'qr', qr);
    if (!built.order.length) continue;

    const sub = bi(it.subtitle, langs);
    const name = `${r.date} ${title}${sub && sub !== title ? ` — ${sub}` : ''}`;
    shows[showId] = makeShow(name, built, showId, created, now, meta);
    refs.push({ id: showId });
  }

  return {
    project: {
      id: id.project,
      name: `${r.date} ${bi(r.title, langs) || 'Service'}`,
      created,
      modified: now,
      used: now,
      parent: '/',
      shows: refs,
    },
    parentFolder: '',
    shows,
  };
}
