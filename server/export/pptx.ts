// PowerPoint (.pptx) slides for a service, built with `pptxgenjs` from the same slide list as the projector
// (shared/slide-model.ts) and styled by the service's slide template: colours, background picture, fonts, text
// size, line spacing, alignment, footer and screen shape (16:9 or 4:3). Custom CSS cannot be carried over.
// PowerPoint does not shrink text to fit when a file is opened, so Canon sizes every text box itself from an
// estimate of how the words wrap; "same text size on every slide" uses one size for the whole deck as on the projector.
import PptxGenJS from 'pptxgenjs';
import type { L10n, Lang } from '../../shared/types.ts';
import type { RenderedService, RenderedSlideBlock } from '../../shared/render-types.ts';
import { buildSlides, type SlideDef } from '../../shared/slide-model.ts';
import { biParts, biText, dateIn } from '../../shared/output-labels.ts';
import { postureL10n, speakerLabel } from '../../shared/labels.ts';
import { langInfo } from '../../shared/languages.ts';
import { DEFAULT_THEME_VARS, blockImageKey, type FontScript, type SlideThemeVars } from '../../shared/presentation.ts';
import { assetRow, getTheme, qrPng } from '../repo/presentation.ts';

type TextProps = PptxGenJS.TextProps;

/** Slide width in inches per screen shape; the height is always 7.5 in. */
const SHAPES = { '16:9': { w: 13.333, layout: 'LAYOUT_WIDE' }, '4:3': { w: 10, layout: 'LAYOUT_4x3' } } as const;
const H = 7.5;
/** Largest text per slide type in points (the projector's sizes: 1920 px wide = 960 pt). */
const MAX_PT: Record<SlideDef['type'], number> = { title: 56, section: 56, sermon: 52, item: 50, lyrics: 40, scripture: 32, text: 34, blocks: 28 };
const MIN_PT = 12;
/** Fonts PowerPoint can use when the template keeps Canon's built-in choice. */
const DEFAULT_FONT: Record<FontScript, string> = { latin: 'Georgia', sc: 'SimSun', tc: 'PMingLiU', other: 'Nirmala UI' };
const UI_FONT = 'Segoe UI';

const hex = (c: string) => c.replace('#', '').slice(0, 6).toUpperCase();

function scriptOf(lang: Lang): FontScript {
  if (lang === 'zh-Hant') return 'tc';
  if (lang === 'zh' || lang.startsWith('zh')) return 'sc';
  return langInfo(lang).cjk || ['ta', 'ko', 'ja', 'th', 'hi'].includes(lang) ? 'other' : 'latin';
}

/** The first family of a CSS font stack ('' = Canon's default for that script). */
function fontFor(v: SlideThemeVars, lang: Lang): string {
  const s = scriptOf(lang);
  const stack = v[`font_${s}`];
  const first = stack.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return first && !/^(serif|sans-serif|monospace)$/.test(first) ? first : DEFAULT_FONT[s];
}

// ---------------------------------------------------------------- fitting text

/** Rough width of a string in ems: CJK characters are square, Latin letters about half as wide. */
function ems(text: string): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x2e80 && c <= 0xffef) w += 1;
    else if (ch === ' ') w += 0.28;
    else if (/[A-Z]/.test(ch)) w += 0.66;
    else w += 0.52;
  }
  return w;
}

/** A paragraph to fit: its text, its size relative to the base size, and whether it is a gap between languages. */
interface Para { text: string; rel: number }

/** Does the text fit a box of w × h inches at `pt` points? */
function fits(paras: Para[], pt: number, w: number, h: number, lineHeight: number): boolean {
  let height = 0;
  for (const p of paras) {
    const size = pt * p.rel;
    const perLine = (w * 72) / size; // ems per line
    const lines = p.text ? p.text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(ems(l) / perLine)), 0) : 1;
    height += (lines * size * lineHeight) / 72;
  }
  return height <= h * 0.94;
}

function fitSize(paras: Para[], max: number, w: number, h: number, lineHeight: number): number {
  for (let pt = Math.round(max); pt > MIN_PT; pt--) if (fits(paras, pt, w, h, lineHeight)) return pt;
  return MIN_PT;
}

// ---------------------------------------------------------------- pictures

/** Pixel size of a PNG / JPEG (null for other formats). */
function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >> 14) & 0x3fff) };
    }
  }
  return null;
}

const dataUri = (mime: string, data: Uint8Array) => `${mime || 'image/png'};base64,${Buffer.from(data).toString('base64')}`;

// ---------------------------------------------------------------- the deck

/** The slide template in effect for a service (its vars), falling back to Canon's dark default. */
function themeVars(r: RenderedService): { vars: SlideThemeVars; id: number | null } {
  try {
    if (r.slide_theme_id) return { vars: { ...DEFAULT_THEME_VARS, ...getTheme(r.slide_theme_id).vars }, id: r.slide_theme_id };
  } catch {
    /* template deleted: the default */
  }
  return { vars: DEFAULT_THEME_VARS, id: null };
}

export async function servicePptx(r: RenderedService, opts: { langs?: Lang[] } = {}): Promise<Buffer> {
  const langs: Lang[] = opts.langs?.length ? opts.langs : r.languages.length ? r.languages : ['en'];
  const { vars: v, id: themeId } = themeVars(r);
  const shape = SHAPES[v.aspect === '4:3' ? '4:3' : '16:9'];
  const W = shape.w;
  const slides = buildSlides(r, langs, v);
  const accent = hex(v.accent_from_season && r.season.color ? r.season.color : v.accent);
  const align = v.align === 'left' ? 'left' : 'center';

  const pptx = new PptxGenJS();
  pptx.layout = shape.layout;
  pptx.title = biText(r.title, langs.slice(0, 1)) || 'Service';
  pptx.company = biText(r.church.name, langs.slice(0, 1));
  pptx.author = 'Canon';

  // background: colour, picture (cover / contain / tile ≈ cover) and the fade over it
  const bgAsset = themeId && v.bg_image ? assetRow(`slide-theme-${themeId}-bg`) : undefined;
  const bgBuf = bgAsset?.data?.length ? Buffer.from(bgAsset.data) : null;
  const bgSize = bgBuf ? imageSize(bgBuf) : null;
  const objects: PptxGenJS.SlideMasterProps['objects'] = [];
  if (bgBuf && bgAsset) {
    if (bgSize) {
      const s = v.bg_fit === 'contain' ? Math.min(W / bgSize.w, H / bgSize.h) : Math.max(W / bgSize.w, H / bgSize.h);
      const w = bgSize.w * s;
      const h = bgSize.h * s;
      objects.push({ image: { x: (W - w) / 2, y: (H - h) / 2, w, h, data: dataUri(bgAsset.mime, bgBuf) } });
    } else {
      objects.push({ image: { x: 0, y: 0, w: W, h: H, data: dataUri(bgAsset.mime, bgBuf) } });
    }
    if (v.bg_dim > 0) objects.push({ rect: { x: 0, y: 0, w: W, h: H, fill: { color: hex(v.bg), transparency: Math.round((1 - v.bg_dim) * 100) } } });
  }
  pptx.defineSlideMaster({ title: 'CANON', background: { color: hex(v.bg) }, objects });

  // geometry: heading band, body box, footer band
  const padX = W * 0.0625;
  const body = { x: padX, y: 1.0, w: W - 2 * padX, h: H - 1.0 - 0.75 };
  const lh = v.line_height;

  const bodyParas = (s: SlideDef): Para[] => {
    const out: Para[] = [];
    const present = langs.filter((l) => (s.lines?.[l]?.length ?? 0) + (s.verses?.[l]?.length ?? 0) > 0);
    present.forEach((l, i) => {
      if (i > 0) out.push({ text: '', rel: 0.45 });
      if (s.lines?.[l]) for (const ln of s.lines[l]!) out.push({ text: (s.speakers && ln.who ? speakerLabel(ln.who, l) + ' ' : '') + ln.text, rel: 1 });
      if (s.verses?.[l]) out.push({ text: s.verses[l]!.map((x) => `${x.n} ${x.text}`).join(' '), rel: 1 });
    });
    return out;
  };
  const titleParas = (s: SlideDef): Para[] => [
    ...biParts(s.big, langs).map((p) => ({ text: p.text, rel: 1 })),
    ...(s.sub ? biParts(s.sub, langs).map((p) => ({ text: p.text, rel: 0.55 })) : []),
    ...(s.meta ?? []).map((m) => ({ text: m, rel: 0.4 })),
    ...(s.type === 'title' ? langs.map(() => ({ text: 'date', rel: 0.4 })) : []),
  ];

  // one size for every hymn, reading and liturgy slide (the fullest one decides), as on the projector
  const fitted = slides.map((s) => {
    const max = MAX_PT[s.type] * v.scale;
    if (s.lines || s.verses) return fitSize(bodyParas(s), max, body.w, body.h, lh);
    if (s.blocks) return max;
    return fitSize(titleParas(s), max, body.w, body.h, 1.15);
  });
  const isBody = (s: SlideDef) => s.type === 'lyrics' || s.type === 'scripture' || s.type === 'text';
  const bodySizes = slides.map((s, i) => (isBody(s) ? fitted[i] : Infinity)).filter(Number.isFinite);
  const deck = v.uniform_size && bodySizes.length ? Math.max(Math.min(...bodySizes), MAX_PT.text * v.scale * 0.6) : null;

  // pictures for QR codes / picture blocks, made once
  const blockImg = new Map<number, string>();
  for (const b of slides.flatMap((s) => s.blocks ?? [])) {
    if (blockImg.has(b.id)) continue;
    if (b.kind === 'qr' && b.value) {
      const png = await qrPng(b.value).catch(() => null);
      if (png) blockImg.set(b.id, dataUri('image/png', png));
    } else if (b.kind === 'image' && b.has_image) {
      const a = assetRow(blockImageKey(b.id));
      if (a?.data?.length) blockImg.set(b.id, dataUri(a.mime, a.data));
    }
  }
  const logo = r.has_logo ? assetRow('logo') : undefined;
  const itemBgs = new Map<number, { data: string; size: { w: number; h: number } | null } | null>();
  const itemBg = (id: number) => {
    if (!itemBgs.has(id)) {
      const a = assetRow(blockImageKey(id));
      itemBgs.set(id, a?.data?.length ? { data: dataUri(a.mime, a.data), size: imageSize(Buffer.from(a.data)) } : null);
    }
    return itemBgs.get(id)!;
  };

  slides.forEach((s, i) => {
    const sl = pptx.addSlide({ masterName: 'CANON' });
    // an item's own background picture covers the template's, faded with the background colour
    const own = s.bg ? itemBg(s.bg.id) : null;
    if (own) {
      sl.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: hex(v.bg) }, line: { color: hex(v.bg) } });
      if (own.size) {
        const k = Math.max(W / own.size.w, H / own.size.h);
        sl.addImage({ data: own.data, x: (W - own.size.w * k) / 2, y: (H - own.size.h * k) / 2, w: own.size.w * k, h: own.size.h * k });
      } else {
        sl.addImage({ data: own.data, x: 0, y: 0, w: W, h: H });
      }
      sl.addShape('rect', { x: 0, y: 0, w: W, h: H, fill: { color: hex(v.bg), transparency: Math.round((1 - Math.max(v.bg_dim, 0.3)) * 100) }, line: { type: 'none' } });
    }
    const run = (text: string, lang: Lang, o: TextProps['options'] = {}): TextProps => ({ text, options: { fontFace: fontFor(v, lang), lang: langInfo(lang).htmlLang, ...o } });

    // heading band: small item heading, stanza label, posture cue
    const head: TextProps[] = [];
    if (s.heading) head.push({ text: biText(s.heading, langs, '  ·  '), options: { color: accent } });
    if (s.label) head.push({ text: `   ${biText(s.label, langs, ' ')}`, options: { color: accent, bold: true } });
    if (s.cont && s.type === 'lyrics') head.push({ text: '   …', options: { color: accent } });
    if (head.length) sl.addText(head, { x: padX, y: 0.3, w: body.w * (s.posture && v.show_posture ? 0.75 : 1), h: 0.55, fontFace: UI_FONT, fontSize: 15, align: v.align === 'left' ? 'left' : 'center', valign: 'middle' });
    if (s.posture && v.show_posture) {
      sl.addText(biText(postureL10n(s.posture, langs), langs, ' · '), { x: padX + body.w * 0.75, y: 0.3, w: body.w * 0.25, h: 0.55, fontFace: UI_FONT, fontSize: 15, bold: true, color: accent, align: 'right', valign: 'middle' });
    }

    if (s.lines || s.verses) {
      const pt = deck ? Math.min(deck, fitted[i]) : fitted[i];
      const present = langs.filter((l) => (s.lines?.[l]?.length ?? 0) + (s.verses?.[l]?.length ?? 0) > 0);
      const runs: TextProps[] = [];
      present.forEach((l, li) => {
        if (li > 0) runs.push({ text: ' ', options: { breakLine: true, fontSize: Math.round(pt * 0.45) } });
        if (s.lines?.[l]) {
          let prev: string | null | undefined;
          for (const ln of s.lines[l]!) {
            if (s.speakers && ln.who && ln.who !== prev) runs.push(run(speakerLabel(ln.who, l) + ' ', l, { color: accent, bold: true, fontFace: UI_FONT, fontSize: Math.round(pt * 0.7) }));
            prev = ln.who;
            runs.push(run(ln.text, l, { breakLine: true, bold: ln.who === 'C' || ln.who === 'A', italic: !!s.refrain && scriptOf(l) === 'latin' }));
          }
        }
        if (s.verses?.[l]) {
          s.verses[l]!.forEach((x, xi) => {
            if (x.n) runs.push(run(`${x.n} `, l, { superscript: true, color: accent, fontFace: UI_FONT }));
            runs.push(run(x.text + ' ', l, xi === s.verses![l]!.length - 1 ? { breakLine: true } : {}));
          });
        }
      });
      sl.addText(runs, { ...body, fontSize: pt, color: hex(v.fg), align, valign: 'middle', lineSpacingMultiple: lh, paraSpaceAfter: 0 });
    } else if (s.blocks) {
      blocksOn(sl, s, s.blocks, langs, { W, padX, body, v, accent, blockImg, fontFor });
    } else {
      const pt = fitted[i];
      const runs: TextProps[] = [];
      for (const p of biParts(s.big, langs)) runs.push(run(v.uppercase_titles ? p.text.toUpperCase() : p.text, p.lang, { breakLine: true, color: hex(v.heading), bold: s.type !== 'item' }));
      if (s.type === 'title') {
        for (const l of langs) runs.push(run(dateIn(r.date, l), l, { breakLine: true, fontSize: Math.round(pt * 0.4), color: hex(v.fg) }));
        runs.push({ text: `${r.start_time}${r.end_time ? `–${r.end_time}` : ''}`, options: { breakLine: true, fontSize: Math.round(pt * 0.4), color: hex(v.fg), fontFace: UI_FONT } });
      }
      if (s.sub) for (const p of biParts(s.sub, langs)) runs.push(run(p.text, p.lang, { breakLine: true, fontSize: Math.round(pt * 0.55), color: accent }));
      for (const m of s.meta ?? []) runs.push({ text: m, options: { breakLine: true, fontSize: Math.round(pt * 0.4), color: hex(v.fg), fontFace: UI_FONT } });
      let y = body.y;
      let h = body.h;
      if (s.type === 'title' && logo?.data?.length) {
        const buf = Buffer.from(logo.data);
        const size = imageSize(buf);
        const lh2 = 1.1;
        const lw = size ? Math.min(3, (lh2 * size.w) / size.h) : lh2;
        sl.addImage({ data: dataUri(logo.mime, buf), x: align === 'left' ? padX : (W - lw) / 2, y: body.y, w: lw, h: lh2 });
        y += lh2 + 0.15;
        h -= lh2 + 0.15;
      }
      sl.addText(runs, { x: body.x, y, w: body.w, h, fontSize: pt, align, valign: 'middle', lineSpacingMultiple: 1.15 });
    }

    // footer: church name · scripture reference · slide number
    const fy = H - 0.6;
    if (v.footer_church) sl.addText(biText(r.church.name, langs.slice(0, 1)), { x: padX, y: fy, w: body.w / 3, h: 0.4, fontFace: UI_FONT, fontSize: 11, color: hex(v.fg), transparency: 30, align: 'left' });
    if (v.footer_reference && s.footer) sl.addText(biText(s.footer, langs, '   '), { x: padX + body.w / 6, y: fy, w: (body.w * 2) / 3, h: 0.4, fontFace: UI_FONT, fontSize: 12, color: accent, align: 'center' });
    if (v.footer_number) sl.addText(String(i + 1), { x: W - padX - 1, y: fy, w: 1, h: 0.4, fontFace: UI_FONT, fontSize: 11, color: hex(v.fg), transparency: 30, align: 'right' });

    // the presenter's notes: what this slide belongs to
    const item = s.itemId != null ? r.items.find((x) => x.id === s.itemId) : null;
    if (item?.notes) sl.addNotes(item.notes);
  });

  return (await pptx.write({ outputType: 'nodebuffer', compression: true })) as Buffer;
}

/** QR codes and pictures side by side (on white cards so codes scan on dark templates), notes underneath. */
function blocksOn(
  sl: PptxGenJS.Slide,
  s: SlideDef,
  blocks: RenderedSlideBlock[],
  langs: Lang[],
  g: { W: number; padX: number; body: { x: number; y: number; w: number; h: number }; v: SlideThemeVars; accent: string; blockImg: Map<number, string>; fontFor: (v: SlideThemeVars, l: Lang) => string },
) {
  const { padX, body, v, accent, blockImg } = g;
  let y = body.y;
  if (s.big) {
    sl.addText(biText(s.big, langs, '  ·  '), { x: body.x, y, w: body.w, h: 0.8, fontSize: 32, bold: true, color: hex(v.heading), align: 'center', fontFace: g.fontFor(v, langs[0]) });
    y += 0.9;
  }
  const cards = blocks.filter((b) => b.kind !== 'text');
  const notes = blocks.filter((b) => b.kind === 'text');
  const notesH = notes.length ? 0.5 + 0.35 * notes.reduce((n, b) => n + linesOf(b.text, langs).length, 0) : 0;
  if (cards.length) {
    const gap = 0.4;
    const cw = Math.min(3.4, (body.w - gap * (cards.length - 1)) / cards.length);
    const ch = Math.min(cw + 1.0, body.y + body.h - y - notesH);
    const total = cards.length * cw + gap * (cards.length - 1);
    cards.forEach((b, i) => {
      const x = padX + (body.w - total) / 2 + i * (cw + gap);
      const cap = linesOf(b.caption, langs);
      const capH = Math.min(1.0, 0.3 * cap.length);
      const img = blockImg.get(b.id);
      const side = Math.min(cw - 0.3, ch - capH - 0.3);
      sl.addShape('rect', { x, y, w: cw, h: side + capH + 0.3, fill: { color: 'FFFFFF' }, line: { color: 'FFFFFF' } });
      if (img) sl.addImage({ data: img, x: x + (cw - side) / 2, y: y + 0.15, w: side, h: side });
      if (cap.length) sl.addText(cap.map((c) => ({ text: c.text, options: { breakLine: true, fontFace: g.fontFor(v, c.lang) } })), { x, y: y + 0.15 + side, w: cw, h: capH, fontSize: 12, color: '1E2430', align: 'center', valign: 'top' });
    });
    y += Math.min(cw + 1.0, ch) + 0.2;
  }
  for (const b of notes) {
    const ls = linesOf(b.text, langs);
    sl.addText(ls.map((c) => ({ text: c.text, options: { breakLine: true, fontFace: g.fontFor(v, c.lang) } })), { x: body.x, y, w: body.w, h: 0.35 * ls.length + 0.2, fontSize: 18, bold: b.bold !== false, color: accent, align: 'center' });
    y += 0.35 * ls.length + 0.3;
  }
}

/** Caption / note lines in the slide languages; a line that is the same in two languages is shown once. */
function linesOf(x: L10n | undefined, langs: Lang[]): { lang: Lang; text: string }[] {
  const seen = new Set<string>();
  const out: { lang: Lang; text: string }[] = [];
  for (const l of langs) {
    for (const raw of (x?.[l] ?? '').split(/\r?\n/)) {
      const t = raw.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push({ lang: l, text: t });
      }
    }
  }
  return out;
}
