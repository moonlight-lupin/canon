// Word export: page geometry, fonts per language, and the small building blocks (runs, rules, columns).
import { dropRepeatedPrefix } from '../../shared/labels.ts';
import { AlignmentType, BorderStyle, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType } from 'docx';
import type { IRunOptions, ParagraphChild } from 'docx';
import type { L10n, Lang } from '../../shared/types.ts';
import { langInfo } from '../../shared/languages.ts';

export const MM = 56.7;

export const PAGE_W = Math.round(148 * MM); // A5 portrait

export const PAGE_H = Math.round(210 * MM);

export const MARGIN = Math.round(12 * MM);

export const CONTENT_W = PAGE_W - 2 * MARGIN;

// ---------------------------------------------------------------- typography

export const SERIF = 'Georgia';

/** East Asian fonts per script (body serif / heading sans) and Word language tags. Windows system fonts. */
export const EAST_ASIA: Record<string, { body: string; head: string; tag: string }> = {
  sc: { body: 'SimSun', head: 'Microsoft YaHei', tag: 'zh-CN' }, // 宋体 pairs with a serif Latin face
  tc: { body: 'PMingLiU', head: 'Microsoft JhengHei', tag: 'zh-TW' },
  ko: { body: 'Batang', head: 'Malgun Gothic', tag: 'ko-KR' },
  ja: { body: 'MS Mincho', head: 'Yu Gothic', tag: 'ja-JP' },
};

/** Tamil is a complex script in Word: it is drawn with the `cs` font (Nirmala UI; Latha on older Windows). */
export const TAMIL = 'Nirmala UI';

export type Fonts = { ascii: string; hAnsi: string; cs: string; eastAsia: string };

/** Fonts and language tags for a set of languages; the first CJK language decides the East Asian font. */
export function fontsFor(langs: Lang[]) {
  const ea = EAST_ASIA[langs.map((l) => langInfo(l).font).find((f) => f in EAST_ASIA) ?? 'sc'];
  const cs = langs.some((l) => langInfo(l).font === 'ta') ? TAMIL : SERIF;
  const latin = langs.find((l) => !langInfo(l).cjk && langInfo(l).font === 'latin');
  return {
    body: { ascii: SERIF, hAnsi: SERIF, cs, eastAsia: ea.body } as Fonts,
    head: { ascii: SERIF, hAnsi: SERIF, cs, eastAsia: ea.head } as Fonts,
    language: { value: latin === 'en' || !latin ? 'en-GB' : langInfo(latin).htmlLang, eastAsia: ea.tag, ...(cs === TAMIL ? { bidirectional: 'ta-IN' } : {}) },
  };
}

/** Document-wide fonts, set by serviceDocx() before the document is built (construction is synchronous). */
export let DOC = fontsFor(['en']);

/** Fonts for text in one specific language (e.g. a Traditional Chinese stanza in an en+zh+zh-Hant service). */
export const bodyFor = (lang?: Lang): Fonts => (lang ? { ...DOC.body, ...pickEa(lang, 'body') } : DOC.body);

export const headFor = (lang?: Lang): Fonts => (lang ? { ...DOC.head, ...pickEa(lang, 'head') } : DOC.head);

export function pickEa(lang: Lang, kind: 'body' | 'head'): Partial<Fonts> {
  const f = langInfo(lang).font;
  if (f in EAST_ASIA) return { eastAsia: EAST_ASIA[f][kind] };
  if (f === 'ta') return { cs: TAMIL };
  return {};
}

// half-points
export const SZ = { body: 18, small: 15, tiny: 13, label: 13, item: 19, section: 19, title: 28, church: 20 };

export const GREY = '666666';

export const RULE = 'A0A0A0';

/** Section heading colour: ink, or the liturgical season colour when season colours are on (set per document). */
export let ACCENT = '1E2430';

/** Set the fonts and accent colour of the document being built (one document is built at a time). */
export function setDocStyle(fonts: ReturnType<typeof fontsFor>, accent: string) {
  DOC = fonts;
  ACCENT = accent;
}

/** Columns for parallel text on the A5 page: two read well, three are too narrow, so three languages are stacked. */
export const MAX_COLUMNS = 2;

export type RunOpts = Omit<IRunOptions, 'text' | 'children'>;

export const run = (text: string, o: RunOpts = {}) => new TextRun({ font: DOC.body, language: DOC.language, size: SZ.body, ...o, text });

// ---------------------------------------------------------------- language helpers

export const pick = (x: L10n | null | undefined, lang: Lang) => (x?.[lang] ?? '').trim();

/** All requested languages joined, e.g. "Call to Worship 宣召"; falls back to any language present. */
export function bi(x: L10n | null | undefined, langs: Lang[], sep = ' '): string {
  if (!x) return '';
  const parts = dropRepeatedPrefix([...new Set(langs.map((l) => pick(x, l)).filter(Boolean))]);
  if (parts.length) return parts.join(sep);
  return (Object.values(x).find((v) => v?.trim()) ?? '').trim();
}

export const has = (x: L10n | null | undefined, langs: Lang[]) => !!bi(x, langs);

// Speaker, refrain and stanza labels: shared/labels.ts and shared/output-labels.ts. Dates: dateIn / formatDate.

// ---------------------------------------------------------------- building blocks

export const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

export const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

export function centered(children: ParagraphChild[], after = 0, before = 0) {
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before, after }, children });
}

export function rule(before = 60, after = 60) {
  return new Paragraph({
    spacing: { before, after },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 1 } },
    children: [],
  });
}

/** Lines → runs separated by line breaks. */
export function lineRuns(lines: string[], o: RunOpts = {}): TextRun[] {
  return lines.map((t, i) => run(t, { ...o, break: i ? 1 : undefined }));
}

/** A borderless table of equal columns, one cell per language. */
export function columns(cells: Paragraph[][], keepTogether = true): Table {
  const n = cells.length;
  const gap = 140;
  const w = Math.floor(CONTENT_W / n);
  return new Table({
    width: { size: w * n, type: WidthType.DXA },
    columnWidths: Array(n).fill(w),
    layout: TableLayoutType.FIXED,
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: keepTogether,
        children: cells.map(
          (children, i) =>
            new TableCell({
              width: { size: w, type: WidthType.DXA },
              margins: { top: 0, bottom: 0, left: i ? gap / 2 : 0, right: i < n - 1 ? gap / 2 : 0 },
              children: children.length ? children : [new Paragraph({ children: [] })],
            }),
        ),
      }),
    ],
  });
}

export const splitLines = (s: string | undefined) => (s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());

// ---------------------------------------------------------------- content: songs

export const isCjk = (l: Lang) => langInfo(l).cjk;

export const joinPeople = (people: L10n[], langs: Lang[]) =>
  bi(Object.fromEntries(langs.map((l) => [l, people.map((p) => p[l] ?? Object.values(p).find(Boolean) ?? '').filter(Boolean).join(isCjk(l) ? '、' : ', ')])), langs, ' / ');

export const hex = (c: string) => c.replace('#', '').toUpperCase();

/** Pixel size of an image box (docx images are sized in pixels at 96 dpi). */
export const PX = (mm: number) => Math.round((mm * 96) / 25.4);

/** A Word page break: an empty paragraph that starts a new page. */
export const pageBreak = () => new Paragraph({ pageBreakBefore: true, children: [] });

// ---------------------------------------------------------------- document
