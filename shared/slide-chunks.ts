// Lines per slide: how much text one projector slide holds, shared by the slides (src/outputs/slideModel.ts) and
// the FreeShow export (server/export/freeshow.ts). Pure functions, no DOM.
//
// A "line" is one lyric line in a song; in scripture, liturgy and other prose it is one SENTENCE (ending at . ? ! 。？！;
// ; and : only break a sentence that is too long). A sentence may span several source lines of a creed or prayer: they
// are counted as one and keep their line breaks on screen. A slide shows at
// most `max_lines_multi` lines per language when two or more languages are shown, `max_lines_single` for one.
// Languages are kept aligned: every slide holds the same portion of the text in each language.
import type { Lang } from './types.ts';
import type { Line } from './render-types.ts';
import { langInfo } from './languages.ts';

export interface LineLimits {
  /** lines (sentences) per language when the slide shows two or more languages */
  max_lines_multi: number;
  /** lines (sentences) when it shows one language */
  max_lines_single: number;
}
export const DEFAULT_LINE_LIMITS: LineLimits = { max_lines_multi: 2, max_lines_single: 3 };

/** The per-language limit for a slide that shows `nLangs` languages. */
export function lineLimit(nLangs: number, limits?: Partial<LineLimits> | null): number {
  const v = nLangs > 1 ? limits?.max_lines_multi ?? DEFAULT_LINE_LIMITS.max_lines_multi : limits?.max_lines_single ?? DEFAULT_LINE_LIMITS.max_lines_single;
  return Math.max(1, Math.round(v));
}

const cjkOf = (lang?: Lang) => (lang ? langInfo(lang).cjk : false);
const isWide = (ch: string) => (ch.codePointAt(0) ?? 0) > 0x2e7f;

// ---------------------------------------------------------------- sentences

const LATIN_END = '.?!';
const CJK_END = '。？！';
/** soft breaks: used (before commas) only to split an over-long sentence */
const SOFT_BREAK = ';；:：';
/** closing quotes / brackets that stay with the sentence they end */
const CLOSERS = '"”’」』）)]】》';
const OPEN_Q = '“「『';
const CLOSE_Q = '”」』';

/** Words that end with a full stop without ending the sentence (lower case, no dots). */
const ABBREV = new Set(
  (
    'mr mrs ms dr st sts rev revd fr sr jr prof gov capt lt sgt hon mt ' +
    'v vv ch chs cf eg ie viz vs pp ca approx vol ' +
    'ps pss gen exod lev deut josh judg kgs chr neh esth prov eccl isa jer ezek obad zeph zech ' +
    'matt mk lk jn rom cor gal eph phil col thess tim philem heb jas'
  ).split(/\s+/),
);

/** Longest sentence before it is softly split near the middle, at ; or : first, else a comma (characters). */
export const LONG_SENTENCE = { latin: 110, cjk: 45 };
/** Shorter pieces than this (characters) are joined to the next sentence ("Amen.", "1.", "阿们。"). */
const TINY = { latin: 12, cjk: 5 };

const charLen = (s: string) => [...s.trim()].length;

/** True when the full stop at `i` ends an abbreviation ("St.", "e.g.", "v.", "J.") or a list number ("1."). */
function abbreviationAt(s: string, start: number, i: number): boolean {
  const before = s.slice(start, i);
  const m = /([A-Za-z][A-Za-z.]*)$/.exec(before);
  if (m) {
    const word = m[1];
    if (/^[A-Z]$/.test(word)) return true; // an initial
    if (ABBREV.has(word.toLowerCase().replace(/\./g, ''))) return true;
    if (word.includes('.')) return true; // e.g. / i.e. / a.m.
    return false;
  }
  // "1." / "12." opening a numbered line
  return /^\s*\d{1,3}$/.test(before);
}

/** Cut at sentence ends. Outside `inQuotes` mode a sentence end inside “quotes” is not a cut. */
function cut(s: string, inQuotes: boolean): string[] {
  const out: string[] = [];
  let start = 0;
  let depth = 0;
  let dq = false; // inside straight "double quotes"
  const quoted = () => depth > 0 || dq;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (OPEN_Q.includes(c)) depth++;
    else if (CLOSE_Q.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === '"') dq = !dq;
    const latin = LATIN_END.includes(c);
    if (!latin && !CJK_END.includes(c)) continue;
    // a "." between digits is a number (3.5)
    if (c === '.' && /\d/.test(s[i - 1] ?? '') && /\d/.test(s[i + 1] ?? '')) continue;
    if (c === '.' && abbreviationAt(s, start, i)) continue;
    // take further end marks and closing quotes along ("?!", "…”", ".)")
    let j = i + 1;
    while (j < s.length && (LATIN_END.includes(s[j]) || CJK_END.includes(s[j]) || CLOSERS.includes(s[j]))) {
      if (CLOSE_Q.includes(s[j])) depth = Math.max(0, depth - 1);
      else if (s[j] === '"') dq = false;
      j++;
    }
    // Latin marks end a sentence only before a space (or the end, or a CJK character): not in "example.org"
    if (latin && !CJK_END.includes(s[j - 1]) && j < s.length && !/\s/.test(s[j]) && !isWide(s[j])) {
      i = j - 1;
      continue;
    }
    if (!quoted() || inQuotes) {
      out.push(s.slice(start, j));
      start = j;
    }
    i = j - 1;
  }
  if (start < s.length) out.push(s.slice(start));
  return out.filter((p) => p.trim());
}

const wideText = (s: string, lang?: Lang) => cjkOf(lang) || [...s].filter(isWide).length > charLen(s) / 2;

/** Can a soft break (; ； : ：) at `i` split the text? Not in a reference (3:16), a web address, or before a quotation. */
function softBreakAt(chars: string[], i: number): boolean {
  const c = chars[i];
  if (!SOFT_BREAK.includes(c)) return false;
  const next = chars[i + 1] ?? '';
  if (/\d/.test(chars[i - 1] ?? '') && /\d/.test(next)) return false;
  if ((c === ';' || c === ':') && next && !/\s/.test(next) && !isWide(next)) return false;
  // a colon introducing a quotation (他说：“…” / he said: "…") stays with it
  if ((c === ':' || c === '：') && /^\s*[“「『"‘]/.test(chars.slice(i + 1, i + 4).join(''))) return false;
  return true;
}

/**
 * Cut a piece in two near its middle: at a ; or : if there is one, else at a comma (Latin text may fall back to a
 * space); null when there is no such place.
 */
export function halveAtComma(s: string, lang?: Lang, spaces = true): [string, string] | null {
  const cjk = wideText(s, lang);
  const chars = [...s];
  const mid = chars.length / 2;
  const lo = chars.length * 0.2;
  const hi = chars.length * 0.8;
  let best = -1;
  const consider = (ok: (i: number) => boolean) => {
    for (let i = 0; i < chars.length - 1; i++) {
      if (i < lo || i > hi || !ok(i)) continue;
      if (best < 0 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
  };
  consider((i) => softBreakAt(chars, i));
  // a comma, or a line break of the source (a sentence that spans several lines of a creed or prayer)
  if (best < 0) consider((i) => /[，,、—–\n]/.test(chars[i]));
  if (best < 0 && !cjk && spaces) consider((i) => /\s/.test(chars[i]));
  if (best < 0) return null;
  return [chars.slice(0, best + 1).join(''), chars.slice(best + 1).join('')];
}

/** Split a very long sentence near its middle (recursively): at ; or : first, else a comma, else (Latin) a space. */
export function softSplit(s: string, lang?: Lang): string[] {
  const limit = wideText(s, lang) ? LONG_SENTENCE.cjk : LONG_SENTENCE.latin;
  if (charLen(s) <= limit) return [s];
  const h = halveAtComma(s, lang);
  return h ? [...softSplit(h[0], lang), ...softSplit(h[1], lang)] : [s];
}

/**
 * When a unit is spread over `k` slides and a language has fewer than `k` pieces, halve its longest pieces at a
 * comma (never mid-phrase) so that every slide holds some of it in each language, instead of one running out early.
 */
export function fillPieces(pieces: string[], k: number, lang?: Lang): string[] {
  const out = [...pieces];
  while (out.length && out.length < k) {
    let longest = 0;
    out.forEach((p, i) => {
      if (charLen(p) > charLen(out[longest])) longest = i;
    });
    const h = halveAtComma(out[longest], lang, false);
    if (!h) break;
    out.splice(longest, 1, ...h);
  }
  return out;
}

/**
 * Sentences of a text, keeping their punctuation (and the spaces between them, so joining the pieces gives the text
 * back). Splits at . ? ! 。？！ (with a closing quote or bracket) but not inside quotes, after abbreviations (St.,
 * Mr., v.) or in a number; a very long sentence is split softly near the middle, at ; ： or : first (never in a verse
 * reference such as 3:16), else at a comma.
 */
export function splitSentences(text: string, lang?: Lang): string[] {
  const s = tidy(text);
  if (!s) return [];
  const cjk = cjkOf(lang);
  const long = cjk ? LONG_SENTENCE.cjk : LONG_SENTENCE.latin;
  // a quotation that is too long on its own may be cut at its own sentence ends
  let pieces = cut(s, false).flatMap((p) => (charLen(p) > long ? cut(p, true) : [p]));
  // tiny pieces join the next sentence (or the previous one at the end)
  const tiny = cjk ? TINY.cjk : TINY.latin;
  const merged: string[] = [];
  let carry = '';
  for (const p of pieces) {
    const cur = carry + p;
    if (charLen(cur) < tiny) carry = cur;
    else {
      merged.push(cur);
      carry = '';
    }
  }
  if (carry) {
    if (merged.length) merged[merged.length - 1] += carry;
    else merged.push(carry);
  }
  pieces = merged.flatMap((p) => softSplit(p, lang));
  return pieces;
}

/** Collapse spaces but keep the line breaks of a sentence that spans several source lines. */
const tidy = (t: string) => t.replace(/[^\S\n]+/g, ' ').replace(/ *\n\s*/g, '\n').trim();

/** Join pieces made by splitSentences / softSplit back into display text (line breaks kept). */
export const joinPieces = (pieces: string[]) => tidy(pieces.join(''));

/** A line that ends a sentence: . ? ! 。？！ perhaps followed by a closing quote or bracket. */
const SENTENCE_END = /[.?!。？！]["'”’」』）)\]】》]*\s*$/;

/**
 * Join consecutive source lines that form one sentence: the same speaker, and the line before does not end a sentence
 * (a tiny line such as "Amen." also joins). Speaker changes always start a new sentence. The lines are joined with
 * line breaks, which are kept on screen. When every language has the same number of lines the decision is shared,
 * so the languages stay line-aligned.
 */
export function joinSentenceLines(perLang: Line[][], langs: Lang[]): Line[][] {
  const joins = (lines: Line[], i: number, lang?: Lang) => {
    const prev = lines[i - 1];
    const cur = lines[i];
    if (!prev || prev.who !== cur.who) return false;
    return !SENTENCE_END.test(prev.text) || charLen(cur.text) < (cjkOf(lang) ? TINY.cjk : TINY.latin);
  };
  const same = perLang.every((p) => p.length === perLang[0]?.length);
  return perLang.map((lines, li) => {
    const out: Line[] = [];
    lines.forEach((ln, i) => {
      const j = i > 0 && (same ? perLang.every((p, l) => joins(p, i, langs[l])) : joins(lines, i, langs[li]));
      if (j && out.length) out[out.length - 1] = { ...out[out.length - 1], text: `${out[out.length - 1].text.trim()}\n${ln.text.trim()}` };
      else out.push({ ...ln, text: ln.text.trim() });
    });
    return out;
  });
}

// ---------------------------------------------------------------- chunks

/** Sizes of `k` near-equal parts of `n` (larger parts first): 5 in 2 → [3, 2]; 4 in 2 → [2, 2]. */
export function balancedSizes(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Cut a list into `k` near-equal contiguous parts. */
export function splitEven<T>(xs: T[], k: number): T[][] {
  let at = 0;
  return balancedSizes(xs.length, k).map((n) => xs.slice(at, (at += n)));
}

/** How many slides a set of languages needs: the most any language needs at `max` lines a slide. */
export const chunkCount = (counts: number[], max: number) => Math.max(1, ...counts.map((n) => Math.ceil(n / max)));

/**
 * Lines of each language spread over the same number of slides, proportionally, so all languages finish on the
 * same slide. Balanced: 4 lines at 3 a slide give 2 + 2. Returns [slide][language] → lines.
 */
export function alignChunks<T>(perLang: T[][], max: number): T[][][] {
  const k = chunkCount(perLang.map((p) => p.length), max);
  const parts = perLang.map((p) => splitEven(p, k));
  return Array.from({ length: k }, (_, j) => parts.map((p) => p[j]));
}

/** One unit (a verse, or a line of liturgy) cut into sentences per language. */
export type Unit = string[][];

/** A piece of a unit on a slide: `part` > 0 means it continues the unit from the slide before. */
export interface UnitPiece {
  unit: number;
  part: number;
  /** sentences per language */
  sentences: string[][];
}

/**
 * Group whole units (verses, sentences of liturgy) onto slides while every language stays within `max` sentences.
 * A unit longer than that on its own is cut into parts with the same share of the unit in every language; two parts
 * of one unit never share a slide, but a part may share a slide with the units before or after it.
 */
export function groupUnits(units: Unit[], max: number, langs?: Lang[]): UnitPiece[][] {
  const pieces: UnitPiece[] = [];
  units.forEach((u, ui) => {
    const c = u.map((s) => s.length);
    if (!c.some((n) => n > max)) {
      pieces.push({ unit: ui, part: 0, sentences: u });
      return;
    }
    const k = chunkCount(c, max);
    const filled = u.map((ss, li) => (ss.length && ss.length < k ? fillPieces(ss, k, langs?.[li]) : ss));
    alignChunks(filled, max).forEach((sentences, part) => pieces.push({ unit: ui, part, sentences }));
  });
  const out: UnitPiece[][] = [];
  let cur: UnitPiece[] = [];
  let counts: number[] = [];
  for (const p of pieces) {
    const c = p.sentences.map((s) => s.length);
    if (cur.length && (c.some((n, i) => (counts[i] ?? 0) + n > max) || cur.some((q) => q.unit === p.unit))) {
      out.push(cur);
      cur = [];
      counts = [];
    }
    cur.push(p);
    counts = c.map((n, i) => (counts[i] ?? 0) + n);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** A line on a slide; `cont` = it continues a line from the slide before (its speaker label is repeated). */
export interface ChunkLine extends Line {
  cont?: boolean;
}

/**
 * One paragraph of liturgy / prose in several languages, cut into slides of at most `max` sentences per language.
 * When every language has the same number of lines they are kept line-aligned (whole lines grouped, an over-long
 * line split proportionally); otherwise the sentences are spread proportionally. Returns [slide][language] → lines.
 */
export function chunkParagraph(source: Line[][], langs: Lang[], max: number): ChunkLine[][][] {
  if (!source.length) return [];
  // lines of one sentence count as one (and keep their line breaks)
  const perLang = joinSentenceLines(source, langs);
  const sentences = perLang.map((lines, li) => lines.map((ln) => splitSentences(ln.text, langs[li])));
  const sameShape = perLang.every((p) => p.length === perLang[0].length);
  if (sameShape) {
    const units: Unit[] = perLang[0].map((_, i) => sentences.map((s) => s[i]));
    return groupUnits(units, max, langs).map((pieces) =>
      perLang.map((lines, li) =>
        pieces
          .filter((p) => p.sentences[li].length)
          .map((p) => ({ who: lines[p.unit].who, text: joinPieces(p.sentences[li]), ...(p.part > 0 ? { cont: true } : {}) })),
      ),
    );
  }
  // different line counts: spread sentence units proportionally, then join units of the same line again
  type U = { line: number; first: boolean; text: string };
  const units: U[][] = sentences.map((perLine) => perLine.flatMap((ss, line) => ss.map((text, si) => ({ line, first: si === 0, text }))));
  return alignChunks(units, max).map((perL) =>
    perL.map((us, li) => {
      const out: ChunkLine[] = [];
      let prev = -1;
      let buf: U[] = [];
      const push = () => {
        if (buf.length) out.push({ who: perLang[li][buf[0].line].who, text: joinPieces(buf.map((b) => b.text)), ...(!buf[0].first ? { cont: true } : {}) });
        buf = [];
      };
      for (const u of us) {
        if (u.line !== prev) push();
        buf.push(u);
        prev = u.line;
      }
      push();
      return out;
    }),
  );
}
