// Presentation model shared by the server and the web client:
//  - slide themes: colours, background picture, fonts per script, sizes, footer, plus admin-written CSS that is
//    scoped to the slide stage (`.slide-stage[data-theme="<id>"]`) by the small CSS scoper below;
//  - bulletin templates: paper, layout, what to print for each kind of item, which back-page sections to include.
//
// The scoper and the theme compiler are pure functions so the server validates exactly what the editor previews.
import type { ItemKind, L10n } from './types.ts';
import { DEFAULT_LINE_LIMITS } from './slide-chunks.ts';
import { legacyFromLayout, legacyLayout, normaliseLayout, type BulletinSection } from './bulletin-layout.ts';

export type PaperSize = 'a4-booklet' | 'a4' | 'a5' | 'letter-booklet' | 'letter';
export type CoverStyle = 'plain' | 'cross' | 'logo' | 'verse';
export const PAPER_SIZES: PaperSize[] = ['a4-booklet', 'a4', 'a5', 'letter-booklet', 'letter'];
export const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse'];

// ================================================================= slide themes

export type FontScript = 'latin' | 'sc' | 'tc' | 'other';
export const FONT_SCRIPTS: FontScript[] = ['latin', 'sc', 'tc', 'other'];

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
  /** lines per language on a slide that shows two or more languages (a "line" = a lyric line or a sentence) */
  max_lines_multi: number;
  /** lines on a slide that shows one language */
  max_lines_single: number;
  /** one text size for all hymn, scripture and liturgy slides of a service (else each slide fits on its own) */
  uniform_size: boolean;
}

export interface SlideTheme {
  id: number;
  name: L10n;
  base: 'dark' | 'light';
  vars: SlideThemeVars;
  css: string;
  sort: number;
  updated_at: string;
  /** stable key of a built-in theme ('ink', 'papyrus', 'contrast', 'season'); built-ins can't be changed or deleted */
  builtin?: string | null;
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
};

/** "Papyrus" — the original light slides. */
export const LIGHT_THEME_COLOURS: Pick<SlideThemeVars, 'bg' | 'fg' | 'accent' | 'heading'> = {
  bg: '#f3eee2', fg: '#1e2430', accent: '#7a6224', heading: '#1e2430',
};

const COLOUR = /^#[0-9a-f]{6}$/i;
/** A font-family list: names, quotes, commas, spaces, dashes and dots only (no ; { } url( or escapes). */
const FONT_STACK = /^[\p{L}\p{N}\s,'"._-]*$/u;
const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
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
    // themes saved before these settings existed get the defaults
    max_lines_multi: Math.round(clamp(v.max_lines_multi, 1, 6, base.max_lines_multi ?? DEFAULT_LINE_LIMITS.max_lines_multi)),
    max_lines_single: Math.round(clamp(v.max_lines_single, 1, 8, base.max_lines_single ?? DEFAULT_LINE_LIMITS.max_lines_single)),
    uniform_size: typeof v.uniform_size === 'boolean' ? v.uniform_size : (base.uniform_size ?? true),
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
  { cls: '.slide-title', what: { en: 'big titles: service, section, sermon and item titles', zh: '大标题：崇拜、段落、讲道、项目标题' } },
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

const MAX_CSS = 50_000;
const ALLOWED_URL = /^(\/api\/assets\/[A-Za-z0-9_.-]+(\?[A-Za-z0-9_=&.%-]*)?|data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=\s]+)$/i;
const FORBIDDEN: [RegExp, string][] = [
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
    ['--slide-show-ref', show(v.footer_reference)],
    ['--slide-show-church', show(v.footer_church)],
    ['--slide-show-number', show(v.footer_number)],
    ['--slide-show-posture', show(v.show_posture)],
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

export type SongPrint = 'full' | 'first_stanza' | 'title';
export type ScripturePrint = 'full' | 'reference';
export type BodyPrint = 'full' | 'title';

/** Hymn numbers in the bulletin: "HP 123 · Title" / "123 Title" / title only. */
export type HymnNumberStyle = 'abbr' | 'number' | 'none';

/** What goes on the back cover (the last page), besides the existing roster / notices / contact sections. */
export interface BulletinBackPage {
  /** this service's serving table: role names (English, or as the role is called in any language), e.g. ["Usher", "Welcome"] */
  this_week_roles: string[];
  /** next service's roster table ("Serving on 11 Oct" / "10月11日 服事人员"), e.g. ["Preacher", "Worship Leader"] */
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
  name: L10n;
  description: L10n;
  options: BulletinOptions;
  sort: number;
  updated_at: string;
  /** stable key of a built-in template ('full', 'order', 'large') */
  builtin?: string | null;
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
export const blockImageUrl = (id: number, version: string) => `/api/assets/${blockImageKey(id)}?v=${encodeURIComponent(version)}`;
/** The block's QR code as SVG (PNG with `.png`); `v` busts the cache when the block changes. */
export const blockQrUrl = (id: number, version: string, ext: 'svg' | 'png' = 'svg') => `/api/bulletin-blocks/${id}/qr.${ext}?v=${encodeURIComponent(version)}`;
/** A QR code for any text (live preview while typing, downloads). */
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
