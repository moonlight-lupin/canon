// Presentation model shared by the server and the web client:
//  - slide themes: colours, background picture, fonts per script, sizes, footer, plus admin-written CSS that is
//    scoped to the slide stage (`.slide-stage[data-theme="<id>"]`) by the small CSS scoper below;
//  - bulletin templates: paper, layout, what to print for each kind of item, which back-page sections to include.
//
// The scoper and the theme compiler are pure functions so the server validates exactly what the editor previews.
import type { ItemKind, L10n } from './types.ts';
import { legacyFromLayout, legacyLayout, normaliseLayout, type BulletinSection } from './bulletin-layout.ts';
import { COLOUR } from './slide-theme.ts';

export type PaperSize = 'a4-booklet' | 'a4' | 'a5' | 'letter-booklet' | 'letter';

export type CoverStyle = 'plain' | 'cross' | 'logo' | 'verse';

export const PAPER_SIZES: PaperSize[] = ['a4-booklet', 'a4', 'a5', 'letter-booklet', 'letter'];

export const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse'];

// ================================================================= slide themes

export type SongPrint = 'full' | 'first_stanza' | 'title';

export type ScripturePrint = 'full' | 'reference';

export type BodyPrint = 'full' | 'title';

/** Hymn numbers in the bulletin: "HP 123 · Title" / "123 Title" / title only. */
export type HymnNumberStyle = 'abbr' | 'number' | 'none';

/** What goes on the back cover (the last page), besides the existing roster / notices / contact sections. */
export interface BulletinBackPage {
  /** this service's serving table: role names (English, or as the role is called in any language), e.g. ["Usher", "Welcome"] */
  this_week_roles: string[];
  /** next service's roster table ("Serving on 11 Oct" / "10月11日 服事人员"), e.g. ["Preacher", "Liturgist"] */
  next_week_roles: string[];
  /** a bold centred line, e.g. "敬请留下参加祷告会！" */
  note: L10n;
  /** bulletin block ids (QR codes, pictures, notes), printed in this order in a grid */
  blocks: number[];
}

export interface BulletinOptions {
  paper: PaperSize;
  layout: 'parallel' | 'stacked';
  /** font size in points; null = the paper's default */
  font_pt: number | null;
  /**
   * cover style; 'default' = the service's choice, else the church default. 'banner' = no cover page: a dark band
   * (logo, church name + service title, address) at the top of page 1 and the order of service right below it.
   */
  cover: CoverStyle | 'banner' | 'default';
  /** banner colours (#rrggbb) */
  banner: { bg: string; fg: string };
  /** 'service' = every language of the service; 'primary' = its first language only */
  languages: 'service' | 'primary';
  /** what to print for each kind of item */
  print: {
    song: SongPrint;
    scripture: ScripturePrint;
    /** creeds, confessions, catechism, responsive liturgy */
    text: BodyPrint;
    /** prayers and every other item that has its own words */
    other: BodyPrint;
  };
  sections: { roster: boolean; notes: boolean; ccli: boolean; sermon_notes: boolean; contact: boolean };
  show_leaders: boolean;
  show_times: boolean;
  /** 'list' = item, subtitle and leader lines; 'table' = three columns (item | what | who) with shaded rows */
  order_style: 'list' | 'table';
  /** print the posture (All stand / 众立); in a table it fills the "who" column when nobody leads the item */
  show_posture: boolean;
  hymn_number: HymnNumberStyle;
  /** sermon and creed / catechism titles in 【】 (Chinese, Japanese, Korean) or “ ” (other languages) */
  sermon_brackets: boolean;
  /** 'inline' = words right under each item; 'separate' = the order first, then all printed words in their own section */
  full_text_section: 'inline' | 'separate';
  /** 'inline' = under the announcements item; 'separate' = its own page with a heading */
  announcements_section: 'inline' | 'separate';
  /** heading of the separate announcements page; empty = "Announcements / 报告事项" */
  announcements_heading: L10n;
  back_page: BulletinBackPage;
  /**
   * The page layout: the sections in print order, with page breaks and the back-cover group (the source of truth).
   * The four fields above (full_text_section, announcements_section, announcements_heading, back_page) and
   * `sections` are derived from it, kept readable for older tools for one release.
   */
  page_layout: BulletinSection[];
}

export interface BulletinTemplate {
  id: number;
  /** a reference people choose, e.g. "CN-A5" */
  ref?: string | null;
  name: L10n;
  description: L10n;
  options: BulletinOptions;
  sort: number;
  updated_at: string;
  /** stable key of a built-in template ('full', 'order', 'large') */
  builtin?: string | null;
  /** left out of the pickers (services that chose it keep it) */
  hidden?: boolean;
}

export const DEFAULT_BANNER = { bg: '#141414', fg: '#ffffff' };

/** "Full words booklet" — what the bulletin printed before templates existed. */
const LEGACY_DEFAULT: Omit<BulletinOptions, 'page_layout'> = {
  paper: 'a4-booklet',
  layout: 'parallel',
  font_pt: null,
  cover: 'default',
  banner: { ...DEFAULT_BANNER },
  languages: 'service',
  print: { song: 'full', scripture: 'full', text: 'full', other: 'full' },
  sections: { roster: true, notes: true, ccli: true, sermon_notes: true, contact: true },
  show_leaders: true,
  show_times: false,
  order_style: 'list',
  show_posture: false,
  hymn_number: 'abbr',
  sermon_brackets: false,
  full_text_section: 'inline',
  announcements_section: 'inline',
  announcements_heading: {},
  back_page: { this_week_roles: [], next_week_roles: [], note: {}, blocks: [] },
};

export const DEFAULT_BULLETIN_OPTIONS: BulletinOptions = { ...LEGACY_DEFAULT, page_layout: legacyLayout(LEGACY_DEFAULT) };

/** A language-keyed text map from untrusted input (language-code keys, non-empty strings, 500 characters each). */
export function l10nOf(v: unknown, d: L10n = {}): L10n {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return d;
  const out: L10n = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(k) && typeof x === 'string' && x.trim()) out[k] = x.slice(0, 500);
  }
  return out;
}

const strList = (v: unknown, d: string[]): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, 80)).filter(Boolean))].slice(0, 12) : d;

export function normaliseBulletinOptions(input: unknown, base: BulletinOptions = DEFAULT_BULLETIN_OPTIONS): BulletinOptions {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const p = (o.print && typeof o.print === 'object' ? o.print : {}) as Record<string, unknown>;
  const sec = (o.sections && typeof o.sections === 'object' ? o.sections : {}) as Record<string, unknown>;
  const ban = (o.banner && typeof o.banner === 'object' ? o.banner : {}) as Record<string, unknown>;
  const bp = (o.back_page && typeof o.back_page === 'object' ? o.back_page : {}) as Record<string, unknown>;
  // templates saved before these options existed have no value: their defaults keep the old behaviour
  const d = DEFAULT_BULLETIN_OPTIONS;
  const baseBack = base.back_page ?? d.back_page;
  const baseBanner = base.banner ?? d.banner;
  const one = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);
  const b = (v: unknown, dflt: boolean) => (typeof v === 'boolean' ? v : dflt);
  const colour = (v: unknown, dflt: string) => (typeof v === 'string' && COLOUR.test(v) ? v.toLowerCase() : dflt);
  const res: Omit<BulletinOptions, 'page_layout'> = {
    paper: one(o.paper, PAPER_SIZES, base.paper),
    layout: one(o.layout, ['parallel', 'stacked'] as const, base.layout),
    font_pt: o.font_pt === null ? null : typeof o.font_pt === 'number' && Number.isFinite(o.font_pt) ? Math.min(16, Math.max(7, Math.round(o.font_pt * 2) / 2)) : base.font_pt,
    cover: one(o.cover, ['default', 'banner', ...COVER_STYLES] as const, base.cover),
    banner: { bg: colour(ban.bg, baseBanner.bg), fg: colour(ban.fg, baseBanner.fg) },
    languages: one(o.languages, ['service', 'primary'] as const, base.languages),
    print: {
      song: one(p.song, ['full', 'first_stanza', 'title'] as const, base.print.song),
      scripture: one(p.scripture, ['full', 'reference'] as const, base.print.scripture),
      text: one(p.text, ['full', 'title'] as const, base.print.text),
      other: one(p.other, ['full', 'title'] as const, base.print.other),
    },
    sections: {
      roster: b(sec.roster, base.sections.roster),
      notes: b(sec.notes, base.sections.notes),
      ccli: b(sec.ccli, base.sections.ccli),
      sermon_notes: b(sec.sermon_notes, base.sections.sermon_notes),
      contact: b(sec.contact, base.sections.contact),
    },
    show_leaders: b(o.show_leaders, base.show_leaders),
    show_times: b(o.show_times, base.show_times),
    order_style: one(o.order_style, ['list', 'table'] as const, base.order_style ?? d.order_style),
    show_posture: b(o.show_posture, base.show_posture ?? d.show_posture),
    hymn_number: one(o.hymn_number, ['abbr', 'number', 'none'] as const, base.hymn_number ?? d.hymn_number),
    sermon_brackets: b(o.sermon_brackets, base.sermon_brackets ?? d.sermon_brackets),
    full_text_section: one(o.full_text_section, ['inline', 'separate'] as const, base.full_text_section ?? d.full_text_section),
    announcements_section: one(o.announcements_section, ['inline', 'separate'] as const, base.announcements_section ?? d.announcements_section),
    announcements_heading: l10nOf(o.announcements_heading, base.announcements_heading ?? {}),
    back_page: {
      this_week_roles: strList(bp.this_week_roles, baseBack.this_week_roles),
      next_week_roles: strList(bp.next_week_roles, baseBack.next_week_roles),
      note: l10nOf(bp.note, baseBack.note),
      blocks: Array.isArray(bp.blocks)
        ? [...new Set(bp.blocks.filter((x): x is number => Number.isInteger(x) && (x as number) > 0))].slice(0, 12)
        : baseBack.blocks,
    },
  };
  // The page layout is the source of truth: given → kept from the stored template (a PATCH without it) → built
  // from the old fields of a template saved before layouts existed, printing exactly what it printed then.
  const page_layout = Array.isArray(o.page_layout)
    ? normaliseLayout(o.page_layout)
    : base !== DEFAULT_BULLETIN_OPTIONS && Array.isArray(base.page_layout)
      ? normaliseLayout(base.page_layout)
      : legacyLayout(res);
  return { ...res, ...legacyFromLayout(page_layout), page_layout };
}

/** What the bulletin prints for an item: true = its words, false = title / reference only, 'first_stanza' (hymns). */
export type BulletinFull = boolean | 'first_stanza';

/**
 * Per-item decision. The item's own choice (`bulletin_text` 'full' | 'title') overrides the template's rule for
 * its kind; null follows the template. "First stanza only" can only come from the template.
 */
export function bulletinDecision(kind: ItemKind, override: 'full' | 'title' | null | undefined, o: BulletinOptions): BulletinFull {
  if (override === 'full') return true;
  if (override === 'title') return false;
  if (kind === 'song') return o.print.song === 'title' ? false : o.print.song === 'first_stanza' ? 'first_stanza' : true;
  if (kind === 'scripture') return o.print.scripture === 'full';
  if (kind === 'text') return o.print.text === 'full';
  return o.print.other === 'full';
}

/** The first stanza in singing order, plus the refrain sung straight after it. */
export function firstStanza<T extends { label: string }>(stanzas: T[]): T[] {
  if (!stanzas.length) return stanzas;
  const out = [stanzas[0]];
  if (stanzas[1] && /^(R|C|REFRAIN|CHORUS)$/i.test(stanzas[1].label.trim())) out.push(stanzas[1]);
  return out;
}

// ---------------------------------------------------------------- bulletin text helpers

const CJK_LANG = (l: string) => l === 'zh' || l.startsWith('zh-') || l === 'ja' || l === 'ko';

/** A title in brackets: 【title】 in Chinese, Japanese and Korean, “title” elsewhere. Already bracketed text is kept. */
export function bracket(text: string, lang: string): string {
  const t = text.trim();
  if (!t || /^[【“"「『]/.test(t)) return t;
  return CJK_LANG(lang) ? `【${t}】` : `“${t}”`;
}

/**
 * Bracket the title part of a subtitle: "威斯敏斯特大教理问答 第78问" with head "威斯敏斯特大教理问答" →
 * "【威斯敏斯特大教理问答】第78问"; without a head the whole subtitle is bracketed, with a head that doesn't match nothing is.
 */
export function bracketL10n(sub: L10n, head: L10n | undefined, langs: string[]): L10n {
  const out: L10n = { ...sub };
  for (const l of langs) {
    const s = sub[l]?.trim();
    if (!s) continue;
    const h = head?.[l]?.trim();
    if (h && s.startsWith(h) && s.length > h.length) {
      const rest = s.slice(h.length).trim();
      out[l] = `${bracket(h, l)}${CJK_LANG(l) ? '' : ' '}${rest}`;
    } else if (!h || s === h) out[l] = bracket(s, l);
    // with a head that the subtitle doesn't start with (e.g. a benediction's reference), nothing is bracketed
  }
  return out;
}

/**
 * The hymn line printed in the bulletin per language: 'abbr' keeps the rendered subtitle ("HP 123 · Title"),
 * 'number' gives "123 Title", 'none' the title only.
 */
export function hymnLine(
  song: { title: L10n; number?: { abbr: string; number: string } },
  subtitle: L10n,
  langs: string[],
  style: HymnNumberStyle,
): L10n {
  if (style === 'abbr') return subtitle;
  const fallback = song.title.en ?? Object.values(song.title).find((v) => v?.trim()) ?? '';
  const out: L10n = {};
  for (const l of new Set([...langs, ...Object.keys(song.title)])) {
    const t = song.title[l]?.trim() || fallback;
    out[l] = style === 'number' && song.number ? `${song.number.number} ${t}` : t;
  }
  return out;
}

export * from './bulletin-layout.ts';

// ================================================================= bulletin blocks (QR codes, pictures, notes)

export type BulletinBlockKind = 'qr' | 'image' | 'text';

export const BLOCK_KINDS: BulletinBlockKind[] = ['qr', 'image', 'text'];

export interface BulletinBlockData {
  /** qr: the web address or text the code holds */
  value?: string;
  /** qr / image: caption printed under the code or picture (several lines allowed) */
  caption?: L10n;
  /** text: the note */
  text?: L10n;
  /** text: bold (default) or normal */
  bold?: boolean;
  /** text: centred (default) or left */
  align?: 'center' | 'left';
  /** image: version tag of the uploaded picture (asset `bulletin-block-<id>`); null = none yet. Set by the server. */
  image?: string | null;
}

export interface BulletinBlock {
  id: number;
  kind: BulletinBlockKind;
  /** admin label, e.g. "PayNow giving" */
  name: string;
  data: BulletinBlockData;
  sort: number;
  updated_at: string;
}

export const MAX_QR_TEXT = 1000;

/** Keep only the fields of a block's kind; clamp lengths. `image` is kept from `base` (only the upload route sets it). */
export function normaliseBlockData(kind: BulletinBlockKind, input: unknown, base: BulletinBlockData = {}): BulletinBlockData {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const has = (k: string) => k in v && v[k] !== undefined;
  if (kind === 'qr') {
    const value = has('value') ? (typeof v.value === 'string' ? v.value.trim().slice(0, MAX_QR_TEXT) : '') : (base.value ?? '');
    return { value, caption: has('caption') ? l10nOf(v.caption) : (base.caption ?? {}) };
  }
  if (kind === 'image') return { caption: has('caption') ? l10nOf(v.caption) : (base.caption ?? {}), image: base.image ?? null };
  return {
    text: has('text') ? l10nOf(v.text) : (base.text ?? {}),
    bold: typeof v.bold === 'boolean' ? v.bold : (base.bold ?? true),
    align: v.align === 'left' || v.align === 'center' ? v.align : (base.align ?? 'center'),
  };
}

export const blockImageKey = (id: number) => `bulletin-block-${id}`;

/** A slide background picture (Library → Slide backgrounds); `v` busts the cache when it changes. */
export const backgroundUrl = (id: number, version: string) => `/api/assets/slide-bg-${id}?v=${encodeURIComponent(version)}`;

/** A picture from Library → Images (0.19.10). */
export const imageUrl = (id: number, version: string) => `/api/assets/image-${id}?v=${encodeURIComponent(version)}`;

export const blockImageUrl = (id: number, version: string) => `/api/assets/${blockImageKey(id)}?v=${encodeURIComponent(version)}`;

/** The block's QR code as SVG (PNG with `.png`); `v` busts the cache when the block changes. */
export const blockQrUrl = (id: number, version: string, ext: 'svg' | 'png' = 'svg') => `/api/bulletin-blocks/${id}/qr.${ext}?v=${encodeURIComponent(version)}`;

/** The QR image of a block; blocks Canon adds itself (negative ids, e.g. the visitor form) are drawn from their value. */
export const blockQrSrc = (id: number, version: string, value?: string) =>
  id < 0 ? `/api/bulletin-blocks/qr.svg?text=${encodeURIComponent(value ?? '')}` : blockQrUrl(id, version);

/** A QR code for any text (live preview while typing, downloads). */
/** A page of a song's sheet music (Library → song → Sheet music); `download` saves it instead of opening it. */
export const scoreUrl = (id: number, download = false) => `/api/songs/scores/${id}${download ? '?download=1' : ''}`;

export const qrPreviewUrl = (text: string, ext: 'svg' | 'png' = 'svg', download = false) =>
  `/api/bulletin-blocks/qr.${ext}?text=${encodeURIComponent(text)}${download ? '&download=1' : ''}`;

export type QrPreset = 'website' | 'instagram' | 'facebook' | 'whatsapp' | 'link';

export const QR_PRESETS: QrPreset[] = ['website', 'instagram', 'facebook', 'whatsapp', 'link'];

/** Turn what the user typed for a preset into the text the QR code holds. */
export function qrPresetValue(preset: QrPreset, input: string): string {
  const s = input.trim();
  if (!s) return '';
  const url = (x: string) => (/^[a-z][a-z0-9+.-]*:/i.test(x) ? x : `https://${x.replace(/^\/+/, '')}`);
  switch (preset) {
    case 'website':
      return url(s);
    case 'instagram': {
      if (/instagram\.com\//i.test(s)) return url(s);
      const h = s.replace(/^@/, '').replace(/[^\w.]/g, '');
      return h ? `https://www.instagram.com/${h}/` : '';
    }
    case 'facebook': {
      if (/(facebook|fb)\.com\//i.test(s)) return url(s);
      const h = s.replace(/^@/, '').replace(/[^\w.-]/g, '');
      return h ? `https://www.facebook.com/${h}` : '';
    }
    case 'whatsapp': {
      if (/wa\.me\//i.test(s)) return url(s);
      const d = s.replace(/\D/g, '');
      return d ? `https://wa.me/${d}` : '';
    }
    default:
      return s;
  }
}

/**
 * A reading's reference with its Bible version code, always (publishers require attribution): "雅各书 3:13-18 (CUVS)".
 * Languages without a bundled passage (a pasted text) are left as they are.
 */
export function withVersion(ref: L10n, scripture: { passages: Partial<Record<string, { translation: string }>> } | undefined, langs: string[]): L10n {
  if (!scripture) return ref;
  const out: L10n = { ...ref };
  for (const l of langs) {
    const code = scripture.passages[l]?.translation?.trim();
    const r = ref[l]?.trim();
    if (code && r && !r.endsWith(`(${code})`)) out[l] = `${r} (${code})`;
  }
  return out;
}
