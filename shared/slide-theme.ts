// Slide templates: theme variables, font presets, and checking and scoping a template's own CSS.
import type { L10n } from './types.ts';
import { DEFAULT_LINE_LIMITS } from './slide-chunks.ts';

export type FontScript = 'latin' | 'sc' | 'tc' | 'other';

export const FONT_SCRIPTS: FontScript[] = ['latin', 'sc', 'tc', 'other'];

export type QrCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type QrSize = 'small' | 'medium' | 'large';
export const QR_CORNERS: QrCorner[] = ['bottom-left', 'bottom-right', 'top-left', 'top-right'];
/** the QR code's side on a 1920 × 1080 slide, and in the PowerPoint file (inches on a 13.33 in wide slide) */
export const QR_SIZE_PX: Record<QrSize, number> = { small: 170, medium: 230, large: 300 };
export const QR_SIZE_IN: Record<QrSize, number> = { small: 1.2, medium: 1.6, large: 2.1 };

export interface SlideThemeVars {
  /** background colour (#rrggbb) */
  bg: string;
  /** version tag of the uploaded background picture (asset `slide-theme-<id>-bg`); null = none. Set by the server. */
  bg_image: string | null;
  /** how the picture fills the slide */
  bg_fit: 'cover' | 'contain' | 'tile';
  /** 0–0.9: the background colour laid over the picture so words stay readable */
  bg_dim: number;
  /** words */
  fg: string;
  /** small headings, verse numbers, Leader/People markers, dividers */
  accent: string;
  /** big titles (service, section, sermon, item) */
  heading: string;
  /** the accent follows the liturgical season colour when season colours are on */
  accent_from_season: boolean;
  /** CSS font-family stacks per script; '' = Canon's built-in choice */
  font_latin: string;
  font_sc: string;
  font_tc: string;
  font_other: string;
  /** multiplies the largest text size (auto-fit still shrinks long texts) */
  scale: number;
  line_height: number;
  align: 'center' | 'left';
  uppercase_titles: boolean;
  /** footer: scripture reference / church name / slide number */
  footer_reference: boolean;
  footer_church: boolean;
  footer_number: boolean;
  /** a small "All stand" / 众立 cue on the first slide of an item that has a posture */
  show_posture: boolean;
  /** the bulletin link's QR code on the title slide: which corner, and how big */
  qr_corner?: QrCorner;
  qr_size?: QrSize;
  /** lines per language on a slide that shows two or more languages (a "line" = a lyric line or a sentence) */
  max_lines_multi: number;
  /** lines on a slide that shows one language */
  max_lines_single: number;
  /** one text size for all hymn, scripture and liturgy slides of a service (else each slide fits on its own) */
  uniform_size: boolean;
  /** screen shape: widescreen 16:9 (1920 × 1080) or the older 4:3 (1440 × 1080) projectors */
  aspect: SlideAspect;
}

export type SlideAspect = '16:9' | '4:3';

/** Logical stage size of a slide per screen shape (the height is always 1080). */
export const ASPECT_WIDTH: Record<SlideAspect, number> = { '16:9': 1920, '4:3': 1440 };

export interface SlideTheme {
  id: number;
  /** a reference people choose, e.g. "EN-WIDE" */
  ref?: string | null;
  name: L10n;
  base: 'dark' | 'light';
  vars: SlideThemeVars;
  css: string;
  sort: number;
  updated_at: string;
  /** stable key of a built-in theme ('ink', 'papyrus', 'contrast', 'season'); built-ins can't be changed or deleted */
  builtin?: string | null;
  /** left out of the pickers (services that chose it keep it) */
  hidden?: boolean;
}

/** Safe system font stacks (Canon works offline, so no web fonts). '' = the built-in default. */
export const FONT_PRESETS: Record<FontScript, { label: L10n; stack: string }[]> = {
  latin: [
    { label: { en: 'Default (Georgia serif)', zh: '默认（Georgia 衬线）' }, stack: '' },
    { label: { en: 'Book serif (Palatino)', zh: '书卷衬线（Palatino）' }, stack: "'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif" },
    { label: { en: 'Classic serif (Times)', zh: '经典衬线（Times）' }, stack: "'Times New Roman', Times, serif" },
    { label: { en: 'Garamond', zh: 'Garamond' }, stack: "Garamond, 'EB Garamond', 'Palatino Linotype', Georgia, serif" },
    { label: { en: 'Clean sans (Segoe UI / Helvetica)', zh: '无衬线（Segoe UI / Helvetica）' }, stack: "'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif" },
    { label: { en: 'Wide sans (Verdana)', zh: '宽体无衬线（Verdana）' }, stack: 'Verdana, Tahoma, sans-serif' },
  ],
  sc: [
    { label: { en: 'Default (Song 宋体)', zh: '默认（宋体）' }, stack: '' },
    { label: { en: 'Hei 黑体 (sans)', zh: '黑体（无衬线）' }, stack: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', sans-serif" },
    { label: { en: 'Kai 楷体 (brush)', zh: '楷体' }, stack: "'Kaiti SC', 'STKaiti', KaiTi, 'Noto Serif SC', serif" },
    { label: { en: 'Fangsong 仿宋', zh: '仿宋' }, stack: "'STFangsong', FangSong, 'Noto Serif SC', serif" },
  ],
  tc: [
    { label: { en: 'Default (Ming 明體)', zh: '默认（明体）' }, stack: '' },
    { label: { en: 'Hei 黑體 (sans)', zh: '黑体（无衬线）' }, stack: "'PingFang TC', 'Microsoft JhengHei', 'Noto Sans TC', 'Source Han Sans TC', sans-serif" },
    { label: { en: 'Kai 楷體 (brush)', zh: '楷体' }, stack: "'Kaiti TC', DFKai-SB, BiauKai, 'Noto Serif TC', serif" },
  ],
  other: [
    { label: { en: 'Default (per language)', zh: '默认（按语言）' }, stack: '' },
    { label: { en: 'Sans (Nirmala UI / Segoe UI)', zh: '无衬线（Nirmala UI / Segoe UI）' }, stack: "'Nirmala UI', 'Segoe UI', 'Noto Sans', sans-serif" },
  ],
};

/** "Ink" — the original dark slides. */
export const DEFAULT_THEME_VARS: SlideThemeVars = {
  bg: '#12151b',
  bg_image: null,
  bg_fit: 'cover',
  bg_dim: 0.45,
  fg: '#f3eee2',
  accent: '#c9a85a',
  heading: '#f3eee2',
  accent_from_season: false,
  font_latin: '',
  font_sc: '',
  font_tc: '',
  font_other: '',
  scale: 1,
  line_height: 1.3,
  align: 'center',
  uppercase_titles: false,
  footer_reference: true,
  footer_church: false,
  footer_number: false,
  show_posture: false,
  max_lines_multi: DEFAULT_LINE_LIMITS.max_lines_multi,
  max_lines_single: DEFAULT_LINE_LIMITS.max_lines_single,
  uniform_size: true,
  aspect: '16:9',
};

/** "Papyrus" — the original light slides. */
export const LIGHT_THEME_COLOURS: Pick<SlideThemeVars, 'bg' | 'fg' | 'accent' | 'heading'> = {
  bg: '#f3eee2', fg: '#1e2430', accent: '#7a6224', heading: '#1e2430',
};

export const COLOUR = /^#[0-9a-f]{6}$/i;

/** A font-family list: names, quotes, commas, spaces, dashes and dots only (no ; { } url( or escapes). */
export const FONT_STACK = /^[\p{L}\p{N}\s,'"._-]*$/u;

export const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : dflt;
  return Math.min(hi, Math.max(lo, v));
};

/** Why a font stack can't be used (null = fine). */
export function fontStackProblem(s: string): string | null {
  if (s.length > 300) return 'is too long';
  if (!FONT_STACK.test(s)) return 'may only contain font names, quotes and commas';
  if ((s.match(/"/g)?.length ?? 0) % 2 || (s.match(/'/g)?.length ?? 0) % 2) return 'has an unclosed quote';
  return null;
}

/** Fill in defaults and clamp numbers. Throws on an unusable font stack (shown to the user). */
export function normaliseThemeVars(input: unknown, base: SlideThemeVars = DEFAULT_THEME_VARS): SlideThemeVars {
  const v = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof SlideThemeVars, unknown>>;
  const col = (k: 'bg' | 'fg' | 'accent' | 'heading') => (typeof v[k] === 'string' && COLOUR.test(v[k] as string) ? (v[k] as string).toLowerCase() : base[k]);
  const bool = (k: keyof SlideThemeVars) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : (base[k] as boolean));
  const font = (k: 'font_latin' | 'font_sc' | 'font_tc' | 'font_other') => {
    const s = typeof v[k] === 'string' ? (v[k] as string).trim() : base[k];
    const p = fontStackProblem(s);
    if (p) throw new Error(`The font list "${s.slice(0, 40)}" ${p}.`);
    return s;
  };
  return {
    bg: col('bg'),
    bg_image: typeof v.bg_image === 'string' && /^[\w-]{1,40}$/.test(v.bg_image) ? v.bg_image : v.bg_image === null ? null : base.bg_image,
    bg_fit: v.bg_fit === 'contain' || v.bg_fit === 'tile' || v.bg_fit === 'cover' ? v.bg_fit : base.bg_fit,
    bg_dim: Math.round(clamp(v.bg_dim, 0, 0.9, base.bg_dim) * 100) / 100,
    fg: col('fg'),
    accent: col('accent'),
    heading: col('heading'),
    accent_from_season: bool('accent_from_season'),
    font_latin: font('font_latin'),
    font_sc: font('font_sc'),
    font_tc: font('font_tc'),
    font_other: font('font_other'),
    scale: Math.round(clamp(v.scale, 0.6, 1.5, base.scale) * 100) / 100,
    line_height: Math.round(clamp(v.line_height, 1, 2, base.line_height) * 100) / 100,
    align: v.align === 'left' || v.align === 'center' ? v.align : base.align,
    uppercase_titles: bool('uppercase_titles'),
    footer_reference: bool('footer_reference'),
    footer_church: bool('footer_church'),
    footer_number: bool('footer_number'),
    show_posture: typeof v.show_posture === 'boolean' ? v.show_posture : (base.show_posture ?? false),
    qr_corner: QR_CORNERS.includes(v.qr_corner as QrCorner) ? (v.qr_corner as QrCorner) : (base.qr_corner ?? 'bottom-right'),
    qr_size: v.qr_size === 'small' || v.qr_size === 'medium' || v.qr_size === 'large' ? v.qr_size : (base.qr_size ?? 'medium'),
    // themes saved before these settings existed get the defaults
    max_lines_multi: Math.round(clamp(v.max_lines_multi, 1, 6, base.max_lines_multi ?? DEFAULT_LINE_LIMITS.max_lines_multi)),
    max_lines_single: Math.round(clamp(v.max_lines_single, 1, 8, base.max_lines_single ?? DEFAULT_LINE_LIMITS.max_lines_single)),
    uniform_size: typeof v.uniform_size === 'boolean' ? v.uniform_size : (base.uniform_size ?? true),
    aspect: v.aspect === '4:3' || v.aspect === '16:9' ? v.aspect : (base.aspect ?? '16:9'),
  };
}

/** Asset key of a theme's background picture (served at /api/assets/<key>). */
export const themeBgKey = (id: number) => `slide-theme-${id}-bg`;

export const themeBgUrl = (id: number, version: string) => `/api/assets/${themeBgKey(id)}?v=${encodeURIComponent(version)}`;

// ---------------------------------------------------------------- CSS scoper

/**
 * Stable class hooks the custom CSS can target (all inside the slide stage). Kept here so the editor's reference
 * list and the renderer stay in step.
 */
export const SLIDE_CLASS_HOOKS: { cls: string; what: L10n }[] = [
  { cls: '.slide', what: { en: 'every slide (the whole 1920×1080 face)', zh: '每张投影片（整个 1920×1080 画面）' } },
  { cls: '.slide-title', what: { en: 'big titles: service, section, sermon and item titles', zh: '大标题：聚会、段落、讲道、项目标题' } },
  { cls: '.slide-section', what: { en: 'a section heading slide (on .slide)', zh: '段落标题投影片（在 .slide 上）' } },
  { cls: '.slide-heading', what: { en: 'the small heading at the top (hymn title, reading)', zh: '顶部小标题（诗歌名、读经）' } },
  { cls: '.slide-lyrics', what: { en: 'hymn words', zh: '诗歌歌词' } },
  { cls: '.slide-stanza-label', what: { en: 'stanza label, e.g. "2" or "Refrain"', zh: '节数标签，如「2」或「副歌」' } },
  { cls: '.slide-cont', what: { en: 'the small "…" on a slide that continues a stanza', zh: '诗节接续投影片上的小「…」' } },
  { cls: '.slide-scripture', what: { en: 'Bible passage', zh: '经文' } },
  { cls: '.slide-verse-num', what: { en: 'verse numbers', zh: '节数' } },
  { cls: '.slide-text', what: { en: 'liturgy, creeds, prayers', zh: '礼文、信经、祷文' } },
  { cls: '.slide-who', what: { en: 'Leader / People / All markers', zh: '领 / 众 / 齐 标记' } },
  { cls: '.slide-sub', what: { en: 'subtitle under a big title', zh: '大标题下的副标题' } },
  { cls: '.slide-footer', what: { en: 'the footer line', zh: '页脚' } },
  { cls: '.slide-ref', what: { en: 'scripture reference in the footer', zh: '页脚的经文出处' } },
  { cls: '.slide-church', what: { en: 'church name in the footer', zh: '页脚的教会名称' } },
  { cls: '.slide-number', what: { en: 'slide number in the footer', zh: '页脚的投影片编号' } },
  { cls: '.slide-posture', what: { en: 'the "All stand" / 众立 cue (when turned on)', zh: '「众立」等提示（开启时）' } },
  { cls: '.slide-blocks', what: { en: 'the row of QR codes, pictures and notes shown after an item (e.g. the offering)', zh: '项目之后显示的二维码、图片和短讯（如奉献）' } },
  { cls: '.slide-block', what: { en: 'one QR code, picture or note with its caption', zh: '单个二维码、图片或短讯及其说明' } },
  { cls: '.slide-qr', what: { en: 'the white card behind a QR code or picture (keep it light so phones can scan it)', zh: '二维码或图片的白色底卡（请保持浅色，以便手机扫描）' } },
  { cls: '.slide-corner', what: { en: 'the bulletin link’s QR code in a corner of the title slide', zh: '标题投影角落的次序单链接二维码' } },
  { cls: '.slide-block-caption', what: { en: 'the caption under a QR code or picture', zh: '二维码或图片下方的说明' } },
  { cls: '.slide-block-text', what: { en: 'a short note shown with the QR codes', zh: '与二维码一同显示的短讯' } },
  { cls: '.lang-en, .lang-zh, .lang-zh-Hant …', what: { en: 'text in one language', zh: '某一种语言的文字' } },
  { cls: '.kind-song, .kind-scripture, .kind-text, .kind-sermon, .kind-section, .kind-service …', what: { en: 'slides of one kind of item (on .slide)', zh: '某类项目的投影片（在 .slide 上）' } },
];

export const CSS_EXAMPLE = `/* Bigger hymn words, a soft shadow and gold verse numbers */
.slide-lyrics { font-size: 1.1em; text-shadow: 0 2px 8px rgb(0 0 0 / 0.6); }
.slide-verse-num { color: #e8c66a; }

/* Chinese lines a little smaller than English */
.slide-lyrics .lang-zh { font-size: 0.92em; }

/* Section slides: title in capitals with wide spacing */
.slide-section .slide-title { text-transform: uppercase; letter-spacing: 0.12em; }`;

export class CssError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.line = line;
  }
}

export const MAX_CSS = 50_000;

export const ALLOWED_URL = /^(\/api\/assets\/[A-Za-z0-9_.-]+(\?[A-Za-z0-9_=&.%-]*)?|data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+)$/i;

export const FORBIDDEN: [RegExp, string][] = [
  [/<\/style/i, '"</style" is not allowed.'],
  [/@import/i, '@import is not allowed — put all the CSS in this box.'],
  [/expression\s*\(/i, 'expression() is not allowed.'],
  [/behavior\s*:/i, 'behavior: is not allowed.'],
  [/-moz-binding/i, '-moz-binding is not allowed.'],
  [/(java|vb)script\s*:/i, 'script URLs are not allowed.'],
  [/image-set\s*\(/i, 'image-set() is not allowed; use url(/api/assets/…).'],
];

/**
 * Scope admin-written CSS to one slide theme: every selector is prefixed with `.slide-stage[data-theme="<scope>"]`
 * (selector lists and @media / @supports blocks included). Anything that could load outside resources or
 * escape the <style> element is rejected with a line number. Returns the scoped CSS; throws CssError.
 */
export function scopeCss(src: string, scope: string): string {
  if (!/^[\w-]+$/.test(scope)) throw new Error(`bad CSS scope ${scope}`);
  if (src.length > MAX_CSS) throw new CssError('The custom CSS is too long (50,000 characters at most).', 1);
  const lineAt = (i: number) => src.slice(0, i).split('\n').length;
  const fail = (msg: string, i: number): never => {
    throw new CssError(msg, lineAt(i));
  };

  // 1. Blank out comments (keeping positions for line numbers); check quotes, escapes and "<".
  let s = '';
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) fail('A comment is not closed (missing */).', i);
      s += src.slice(i, end + 2).replace(/[^\n]/g, ' ');
      i = end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') fail('A text in quotes is not closed.', i);
        if (src[j] === '\\') j++;
        j++;
      }
      if (j >= src.length) fail('A text in quotes is not closed.', i);
      s += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '\\') fail('Backslash escapes are only allowed inside quotes.', i);
    if (c === '<') fail('"<" is not allowed (no HTML in CSS).', i);
    s += c;
    i++;
  }

  // 2. Forbidden constructs and url() targets.
  for (const [re, msg] of FORBIDDEN) {
    const m = re.exec(s);
    if (m) fail(msg, m.index);
  }
  for (const m of s.matchAll(/url\s*\(/gi)) {
    let j = m.index + m[0].length;
    while (/\s/.test(s[j] ?? '')) j++;
    let value = '';
    if (s[j] === '"' || s[j] === "'") {
      const q = s[j];
      const end = s.indexOf(q, j + 1);
      value = s.slice(j + 1, end);
      j = end + 1;
      while (/\s/.test(s[j] ?? '')) j++;
    } else {
      const end = s.indexOf(')', j);
      if (end < 0) fail('url( is not closed.', m.index);
      value = s.slice(j, end).trim();
      j = end;
    }
    if (s[j] !== ')') fail('url( is not closed.', m.index);
    if (value.includes('\\') || !ALLOWED_URL.test(value.trim())) {
      fail('url() can only use a picture uploaded to Canon (/api/assets/…) or a data:image. Pictures and fonts from other websites are not allowed.', m.index);
    }
  }

  // 3. Parse rules and prefix selectors.
  const S = `.slide-stage[data-theme="${scope}"]`;
  /** index of the closing quote of the string starting at i (quotes were checked above) */
  const strEnd = (text: string, i: number) => {
    let j = i + 1;
    while (j < text.length && text[j] !== text[i]) j += text[j] === '\\' ? 2 : 1;
    return j;
  };
  /** index of the first of `stops` at nesting depth 0 (outside strings and brackets), or -1 */
  const findTop = (from: number, end: number, stops: string): number => {
    let depth = 0;
    for (let i = from; i < end; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = strEnd(s, i);
        continue;
      }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && stops.includes(c)) return i;
    }
    return -1;
  };
  const matchBrace = (open: number, end: number): number => {
    let depth = 0;
    for (let i = open; i < end; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = strEnd(s, i);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return i;
    }
    return -1;
  };
  const splitTop = (text: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'") {
        const end = strEnd(text, i);
        cur += text.slice(i, end + 1);
        i = end;
        continue;
      }
      if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      if (c === ',' && depth === 0) {
        out.push(cur);
        cur = '';
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const prefix = (raw: string, at: number): string => {
    const sel = raw.trim().replace(/\s+/g, ' ');
    if (!sel) fail('A selector list has an empty entry (check the commas).', at);
    const rooted = sel.replace(/^(:root|html|body)(?![\w-])/i, '.slide-stage');
    if (/^\.slide-stage(?![\w-])/.test(rooted)) return S + rooted.slice('.slide-stage'.length);
    return `${S} ${sel}`;
  };

  const block = (from: number, end: number, nested: boolean): string[] => {
    const out: string[] = [];
    let i = from;
    for (;;) {
      while (i < end && /\s/.test(s[i])) i++;
      if (i >= end) break;
      if (s[i] === '}') fail('Unexpected "}" — check your braces.', i);
      if (s[i] === ';') {
        i++;
        continue;
      }
      if (s[i] === '@') {
        const name = (/^@([\w-]+)/.exec(s.slice(i, i + 40))?.[1] ?? '').toLowerCase();
        const open = findTop(i, end, '{;');
        if (open < 0 || s[open] === ';') fail(`@${name || '?'} is not supported here.`, i);
        const close = matchBrace(open, end);
        if (close < 0) fail('A "{" is not closed.', open);
        const prelude = s.slice(i, open).trim().replace(/\s+/g, ' ');
        const body = s.slice(open + 1, close);
        if (name === 'media' || name === 'supports') {
          out.push(`${prelude} {\n${block(open + 1, close, true).map((r) => '  ' + r.replace(/\n/g, '\n  ')).join('\n')}\n}`);
        } else if (name === 'font-face') {
          if (nested) fail('@font-face must not be inside another block.', i);
          if (body.includes('{')) fail('@font-face cannot contain other rules.', open);
          out.push(`@font-face {${body}}`);
        } else if (name === 'keyframes' || name === '-webkit-keyframes') {
          if (!/^@(-webkit-)?keyframes [\w-]+$/i.test(prelude)) fail('@keyframes needs a simple name, e.g. @keyframes glow.', i);
          out.push(`${prelude} {${body}}`);
        } else {
          fail(`@${name} rules are not supported. Use plain rules, @media, @supports, @font-face or @keyframes.`, i);
        }
        i = close + 1;
        continue;
      }
      const open = findTop(i, end, '{;}');
      if (open < 0 || s[open] !== '{') fail('Expected "{" after the selector.', i);
      const close = matchBrace(open, end);
      if (close < 0) fail('A "{" is not closed.', open);
      const body = s.slice(open + 1, close);
      if (findTop(open + 1, close, '{') >= 0) fail('Nested rules are not supported — write each selector on its own.', open + 1);
      const sels = splitTop(s.slice(i, open)).map((x) => prefix(x, i));
      out.push(`${sels.join(',\n')} {${body.replace(/^\s*\n/, '\n').replace(/\s+$/, ' ')}}`);
      i = close + 1;
    }
    return out;
  };
  return block(0, s.length, false).join('\n');
}

// ---------------------------------------------------------------- theme compiler

/**
 * The CSS for one theme: its settings as custom properties on the stage, then the admin CSS scoped to it.
 * `scope` is the theme id (or e.g. "draft" for the editor preview); `bgUrl` is the background picture URL.
 */
export function compileThemeCss(scope: string, vars: SlideThemeVars, css: string, bgUrl: string | null): string {
  const v = normaliseThemeVars(vars);
  const S = `.slide-stage[data-theme="${scope}"]`;
  const show = (on: boolean) => (on ? 'flex' : 'none');
  const decl: [string, string][] = [
    ['--slide-bg', v.bg],
    ['--slide-fg', v.fg],
    ['--slide-accent', v.accent],
    ['--slide-heading', v.heading],
    ['--slide-muted', `color-mix(in srgb, ${v.fg} 62%, ${v.bg})`],
    ['--slide-scale', String(v.scale)],
    ['--slide-line-height', String(v.line_height)],
    ['--slide-align', v.align],
    ['--slide-align-items', v.align === 'left' ? 'flex-start' : 'center'],
    ['--slide-rule-left', v.align === 'left' ? '0' : 'auto'],
    ['--slide-title-transform', v.uppercase_titles ? 'uppercase' : 'none'],
    ['--slide-bg-image', bgUrl ? `url("${bgUrl}")` : 'none'],
    ['--slide-bg-size', v.bg_fit === 'tile' ? 'auto' : v.bg_fit],
    ['--slide-bg-repeat', v.bg_fit === 'tile' ? 'repeat' : 'no-repeat'],
    ['--slide-bg-overlay', bgUrl ? `color-mix(in srgb, ${v.bg} ${Math.round(v.bg_dim * 100)}%, transparent)` : 'transparent'],
    // an item's own background picture fades like the template's (at least 30%, so words stay readable)
    ['--slide-item-bg-overlay', `color-mix(in srgb, ${v.bg} ${Math.round(Math.max(v.bg_dim, 0.3) * 100)}%, transparent)`],
    ['--slide-show-ref', show(v.footer_reference)],
    ['--slide-show-church', show(v.footer_church)],
    ['--slide-show-number', show(v.footer_number)],
    ['--slide-show-posture', show(v.show_posture)],
    // the bulletin link's QR code on the title slide
    ['--slide-qr-size', `${QR_SIZE_PX[v.qr_size ?? 'medium']}px`],
    ['--slide-qr-top', (v.qr_corner ?? 'bottom-right').startsWith('top') ? '110px' : 'auto'],
    ['--slide-qr-bottom', (v.qr_corner ?? 'bottom-right').startsWith('bottom') ? '100px' : 'auto'],
    ['--slide-qr-left', (v.qr_corner ?? 'bottom-right').endsWith('left') ? '70px' : 'auto'],
    ['--slide-qr-right', (v.qr_corner ?? 'bottom-right').endsWith('right') ? '70px' : 'auto'],
  ];
  for (const k of FONT_SCRIPTS) {
    const f = v[`font_${k}`];
    if (f) decl.push([`--slide-font-${k}`, f]);
  }
  let out = `${S} {\n${decl.map(([k, val]) => `  ${k}: ${val};`).join('\n')}\n}\n`;
  if (v.accent_from_season) out += `${S} .slide.seasonal { --slide-accent: var(--s-season); }\n`;
  if (css.trim()) out += `/* custom CSS */\n${scopeCss(css, scope)}\n`;
  return out;
}

// ================================================================= bulletin templates
