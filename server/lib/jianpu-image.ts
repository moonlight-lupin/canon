// Drawing a melody for the downloads (0.21.3): the Word bulletin and the PowerPoint slides need a picture made on the
// server. jpFun draws the SVG in a worker thread (memory and time limits: server/lib/jianpu-check.ts inWorker); the lines
// of words for the stanzas and languages wanted, the part of the music for this slide, the colour, then resvg turns it
// into a PNG. jpFun writes its notes and words as text, so resvg needs fonts: the computer's own (Windows, Mac), or in
// Docker the Noto CJK and DejaVu fonts the image installs.
import { Resvg } from '@resvg/resvg-js';
import { cropSvg, partLines, recolorSvg, selectLyrics } from '../../shared/jianpu-prep.ts';
import { inWorker } from './jianpu-check.ts';

export interface MelodySelection { labels?: string[]; langs?: string[]; keepNames?: boolean; part?: number; parts?: number }
export interface MelodyImage {
  /** the SVG as drawn, cropped and coloured (Word shows it; the PNG is its fallback) */
  svg: string;
  png: Buffer;
  /** the drawing's size in its own units (an A4-wide page is 794 wide) */
  width: number;
  height: number;
}

/** What a computer calls its fonts for the words (Latin and Chinese in one) and for the numbers. */
const FONTS: Record<string, { sans: string; mono: string }> = {
  win32: { sans: 'Microsoft YaHei', mono: 'Consolas' },
  darwin: { sans: 'PingFang SC', mono: 'Menlo' },
};
const fonts = FONTS[process.platform] ?? { sans: 'Noto Sans CJK SC', mono: 'DejaVu Sans Mono' };

/** How resvg finds the fonts. On Linux its own search finds none (not even in Docker's /usr/share/fonts): name the
 *  folders. */
export const FONT_OPTIONS = {
  loadSystemFonts: true,
  ...(FONTS[process.platform] ? {} : { fontDirs: ['/usr/share/fonts', '/usr/local/share/fonts'] }),
  defaultFontFamily: fonts.sans, sansSerifFamily: fonts.sans, monospaceFamily: fonts.mono,
};

const DRAW_TIME_LIMIT_MS = 8000;

export interface DrawOptions {
  /** the ink (default black) */
  color?: string;
  /** the PNG's width in pixels */
  pixelWidth?: number;
  /** jpFun's page width (default its A4 width, 794): wider spaces the notes out */
  pageWidth?: number;
}

/** A melody as a picture, with no background. null when it can't be drawn (an error in the melody, too much, too slow). */
export async function melodyImage(source: string, sel: MelodySelection, o: DrawOptions = {}): Promise<MelodyImage | null> {
  let text = selectLyrics(source, sel);
  // a wider page spaces the notes out, so close words don't touch (jpFun places each under its note, however long);
  // a melody that sets its own page keeps it
  if (o.pageWidth && !/@page\s*\(/.test(text)) text = `@page(width=${o.pageWidth})\n${text}`;
  const r = await inWorker(text, DRAW_TIME_LIMIT_MS, true);
  const page = r.svgs[0];
  if (!page || r.problems.some((p) => p.error)) return null;
  const lines = r.lines ?? [];
  const [from, to] = partLines(lines.length, sel.part ?? 0, sel.parts ?? 1);
  const svg = recolorSvg(cropSvg(page, lines, from, to), o.color ?? '#000');
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg)?.[1].trim().split(/\s+/).map(Number) ?? [0, 0, 794, 200];
  try {
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: o.pixelWidth ?? 1600 },
      font: FONT_OPTIONS,
    }).render().asPng();
    return { svg, png: Buffer.from(png), width: vb[2], height: vb[3] };
  } catch (e) {
    console.warn(`melody: could not draw a picture: ${(e as Error).message}`);
    return null;
  }
}

/** One export's pictures, drawn once each (a song sung twice, or the same stanza on two slides). */
export function melodyImages() {
  const cache = new Map<string, Promise<MelodyImage | null>>();
  return (source: string, sel: MelodySelection, o: DrawOptions = {}) => {
    const key = JSON.stringify([source, sel, o]);
    let p = cache.get(key);
    if (!p) cache.set(key, (p = melodyImage(source, sel, o)));
    return p;
  };
}
