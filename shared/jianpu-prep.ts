// Before and after jpFun draws a melody (0.21.0, from an adversarial test of the melody editor). Shared by the browser
// (src/components/jianpu-worker.ts) and the server's check for AI assistants (server/lib/jianpu-worker.ts), so both say
// the same. Four things jpFun doesn't do for us:
//  1. Chinese-keyboard punctuation — a full-width comma "，" for an octave lower, "’" for higher, "－" or "—" for a held
//     beat, "｜" for a bar line, full-width digits — was silently dropped: wrong notes, no warning. In the notes (not the
//     words, not quoted text) it is turned into the notation's own characters, one for one.
//  2. A melody that asks for too much (e.g. @br(1000000), thousands of bars) froze the page or ran the server out of
//     memory. It is refused before jpFun sees it; the drawing also runs with a time limit (in a worker).
//  3. jpFun never starts a new line by itself: a hymn typed without @br() was one crushed line. With no @br() at all,
//     Canon starts a new line every 4 bars, and says so.
//  4. Words beyond the last note were dropped without a word. Canon counts what was placed and says what is left over.
// Problems Canon adds have codes starting C_ (their words are in shared/jianpu-messages.ts).

export interface PrepProblem { code: string; offset: number; error: boolean; vars?: Record<string, string> }

// ---------------------------------------------------------------- 1. Chinese-keyboard punctuation in the notes

/** One character for one, so positions in the text stay the same. */
const FULL_TO_NOTATION: Record<string, string> = {
  '，': ',', '、': ',', '’': "'", '‘': "'", '′': "'", '＇': "'", '｜': '|', '－': '-', '—': '-', '–': '-', '―': '-', 'ー': '-',
  '：': ':', '（': '(', '）': ')', '｛': '{', '｝': '}', '＃': '#', '＠': '@', '／': '/', '．': '.', '　': ' ', '＝': '=', '＂': '"',
};
for (let i = 0; i < 10; i++) FULL_TO_NOTATION[String.fromCharCode(0xff10 + i)] = String(i);

/** Is this source line a line of words (L:, L(name):, also with a full-width colon) or a heading (H.…:)? */
const WORDS_LINE = /^\s*(L(\([^)\n]*\))?\s*[:：]|H\.)/;

/**
 * Turn Chinese-keyboard punctuation in the notes into the notation's own characters (not in words or quoted text).
 * Returns the new text and the characters that were changed (each once, in order).
 */
export function normalizeJianpu(source: string): { text: string; changed: string[] } {
  const changed: string[] = [];
  const out = source.split('\n').map((line) => {
    if (WORDS_LINE.test(line)) {
      // only the label's colon: "L：" → "L:"
      return line.replace(/^(\s*L(\([^)\n]*\))?\s*)：/, (_m, a: string) => (changed.includes('：') || changed.push('：'), `${a}:`));
    }
    let quoted = false;
    let s = '';
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      const to = !quoted ? FULL_TO_NOTATION[ch] : undefined;
      if (to !== undefined) {
        if (!changed.includes(ch)) changed.push(ch);
        s += to;
      } else s += ch;
    }
    return s;
  });
  return { text: out.join('\n'), changed };
}

// ---------------------------------------------------------------- 2. what a hymn never needs

export const LIMITS = { brLines: 4, number: 2000, bars: 400, dashes: 3000, depth: 40, lines: 120 };

/** Strings in quotes are left out (text such as @text("…") is not notation). */
const unquoted = (s: string) => s.replace(/"[^"\n]*"/g, (m) => ' '.repeat(m.length));
const notesOnly = (source: string) => source.split('\n').map((l) => (WORDS_LINE.test(l) ? ' '.repeat(l.length) : unquoted(l))).join('\n');

/** Refuse what would take jpFun too long or too much memory, before it starts. */
export function guardJianpu(source: string): PrepProblem[] {
  const p: PrepProblem[] = [];
  const notes = notesOnly(source);
  for (const m of notes.matchAll(/@(br|pagebreak|pb)\s*\(\s*([^)]*)\)/g)) {
    const n = Number.parseFloat(m[2] || '1');
    if (m[1] === 'br' && (!Number.isFinite(n) || n > LIMITS.brLines)) p.push({ code: 'C_BR_TOO_MANY', offset: m.index!, error: true, vars: { value: m[2].trim(), max: String(LIMITS.brLines) } });
  }
  for (const m of notes.matchAll(/@[\w./$-]+\s*\(([^)]*)\)/g)) {
    // @br() has its own, clearer limit above
    if (/^@(br|pagebreak|pb)\s*\(/.test(m[0])) continue;
    for (const n of m[1].matchAll(/-?\d+(\.\d+)?(e\d+)?/gi)) {
      if (Math.abs(Number(n[0])) > LIMITS.number) {
        p.push({ code: 'C_NUMBER_TOO_LARGE', offset: m.index! + m[0].indexOf('(') + 1 + n.index!, error: true, vars: { value: n[0], max: String(LIMITS.number) } });
        break;
      }
    }
  }
  const bars = barTokens(notes).length;
  if (bars > LIMITS.bars) p.push({ code: 'C_TOO_MANY_BARS', offset: 0, error: true, vars: { value: String(bars), max: String(LIMITS.bars) } });
  const dashes = (notes.match(/(^|\s)-(?=\s|\||$)/gm) ?? []).length;
  if (dashes > LIMITS.dashes) p.push({ code: 'C_TOO_MANY_HELD', offset: 0, error: true, vars: { value: String(dashes), max: String(LIMITS.dashes) } });
  let depth = 0;
  let deepest = 0;
  for (const ch of notes) {
    if (ch === '{' || ch === '(') deepest = Math.max(deepest, ++depth);
    else if (ch === '}' || ch === ')') depth = Math.max(0, depth - 1);
  }
  if (deepest > LIMITS.depth) p.push({ code: 'C_TOO_DEEP', offset: 0, error: true, vars: { max: String(LIMITS.depth) } });
  return p;
}

/** Bar lines in the notes (|, ||, |||, |:, :|, :|:), with where they end. */
function barTokens(notes: string): { start: number; end: number }[] {
  return [...notes.matchAll(/:?\|+:?/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }));
}

// ---------------------------------------------------------------- 3. a new line every 4 bars when none is asked for

export const AUTO_BARS_PER_LINE = 4;

/**
 * jpFun puts everything on one line until it is told otherwise (@br()). When the melody has no @br(), no page break and
 * one part (one N:), and more than 6 bars, start a new line after every 4th bar line — not where a held note (-) carries
 * on, nor after the last. Returns the text to draw and where @br() went (offsets in the original).
 */
export function autoBreak(source: string): { text: string; at: number[] } {
  const notes = notesOnly(source);
  if (/@(br|pagebreak|pb)\b/.test(notes) || (notes.match(/(^|\n)\s*N(\([^)\n]*\))?\s*:/g) ?? []).length !== 1) return { text: source, at: [] };
  const bars = barTokens(notes);
  if (bars.length <= 6) return { text: source, at: [] };
  const at: number[] = [];
  let count = 0;
  for (let i = 0; i < bars.length - 1; i++) {
    count++;
    if (count < AUTO_BARS_PER_LINE) continue;
    // a held note going on past the bar line: wait for the next bar line
    if (/^\s*-/.test(notes.slice(bars[i].end, bars[i].end + 8))) continue;
    // a line of words never starts right here (the bar is inside the notes)
    at.push(bars[i].end);
    count = 0;
  }
  let text = '';
  let last = 0;
  for (const a of at) {
    text += source.slice(last, a) + ' @br()';
    last = a;
  }
  return { text: text + source.slice(last), at };
}

/** An offset in the text that was drawn → the same place in what the person typed. */
export function originalOffset(offset: number, at: number[]): number {
  let shift = 0;
  for (const a of at) {
    if (a + shift >= offset) break;
    shift += ' @br()'.length;
  }
  return Math.max(0, offset - shift);
}

// ---------------------------------------------------------------- 4. words left over

interface LyricLine { name: string; tokens: string[] }
interface Region { text?: string; y?: number; line?: number }

/**
 * Compare each line of words with what jpFun placed under the notes; a line with words left over gets a problem at its
 * L: line (offset in what was typed). `compiled` is jpFun's compileScore result (only the parts read here are typed).
 */
export function leftoverWords(compiled: unknown, source: string): PrepProblem[] {
  const r = compiled as { lowering?: { columns?: Record<string, Record<string, { ast?: { lyrics?: LyricLine[] } }>> }; layout?: { attachments?: { regions?: Region[] }[] } };
  const voices: LyricLine[][] = [];
  for (const col of Object.values(r.lowering?.columns ?? {})) {
    for (const n of Object.values(col ?? {})) if (n?.ast?.lyrics?.length) voices.push(n.ast.lyrics);
  }
  // only one part: with several, which words went where can't be told from here
  if (voices.length !== 1) return [];
  const rows = new Map<string, Region[]>();
  for (const a of r.layout?.attachments ?? []) {
    for (const g of a.regions ?? []) if (typeof g.text === 'string' && g.text.trim() && g.y != null) {
      const k = `${g.line ?? 0}`;
      rows.set(k, [...(rows.get(k) ?? []), g]);
    }
  }
  // within each line of music, the rows of words top to bottom are the L: lines in order
  const placed: number[] = [];
  for (const regions of rows.values()) {
    const ys = [...new Set(regions.map((g) => Math.round(g.y!)))].sort((a, b) => a - b);
    for (const g of regions) {
      const i = ys.indexOf(Math.round(g.y!));
      placed[i] = (placed[i] ?? 0) + 1;
    }
  }
  const lyricLines = [...source.matchAll(/^\s*L(\([^)\n]*\))?\s*:/gm)].map((m) => m.index! + m[0].indexOf('L'));
  const out: PrepProblem[] = [];
  voices[0].forEach((l, i) => {
    const words = l.tokens.map((t) => t.replace(/^\{(.*)\}$/, '$1')).filter((t) => t.trim());
    const got = placed[i] ?? 0;
    if (words.length > got) {
      out.push({ code: 'C_WORDS_LEFT_OVER', offset: lyricLines[i] ?? 0, error: false, vars: { count: String(words.length - got), first: words[got] ?? '' } });
    }
  });
  return out;
}

/** A drawn melody taller than this many lines is refused (a hymn has a handful). */
export const tooManyLines = (lineCount: number): PrepProblem | null =>
  lineCount > LIMITS.lines ? { code: 'C_TOO_MANY_LINES', offset: 0, error: true, vars: { value: String(lineCount), max: String(LIMITS.lines) } } : null;

// ---------------------------------------------------------------- all of it, around jpFun

/** What jpFun is asked for (the module, passed in so this file needs no import of it). */
export interface JpFunLike {
  compileScore: (source: string, options?: Record<string, unknown>) => { diagnostics: Diag[]; layout: { diagnostics: Diag[]; lineCount: number } };
  renderLayoutPagesToSvg: (layout: never, options?: Record<string, unknown>) => string[];
  ErrorDiagnostic: abstract new (...a: never[]) => unknown;
}
type Diag = { code?: string; message?: string; span?: { start: number } };

export interface MelodyProblem {
  code: string;
  error: boolean;
  line: number;
  column: number;
  /** jpFun's own message (Chinese); empty for Canon's own problems */
  message: string;
  /** the details for Canon's words (C_ codes; jpFun's are read from its message) */
  vars?: Record<string, string>;
}

export interface MelodyResult {
  /** SVG pages (only when asked to draw, and when it could be drawn) */
  svgs: string[];
  problems: MelodyProblem[];
  /** Chinese-keyboard characters that were read as notation (e.g. "，" as ",") */
  changed: string[];
  /** where Canon started new lines itself (no @br() in the melody) */
  autoBreaks: number;
  lineCount: number;
}

const lineCol = (source: string, offset: number) => {
  const before = source.slice(0, offset);
  const line = before.split('\n').length;
  return { line, column: offset - before.lastIndexOf('\n') };
};

/**
 * Check — and draw when `draw` — a melody, the same way everywhere: Chinese-keyboard punctuation read as notation, what
 * is too much refused, new lines every 4 bars when the melody has none, jpFun's problems de-duplicated, and words left
 * over found. Problem positions are in the text as typed.
 */
export function runJianpu(jp: JpFunLike, source: string, o: { draw: boolean; compileOptions?: Record<string, unknown>; svgOptions?: Record<string, unknown> }): MelodyResult {
  const { text: normal, changed } = normalizeJianpu(source);
  const at = (offset: number, code: string, error: boolean, message = '', vars?: Record<string, string>): MelodyProblem => ({ code, error, message, vars, ...lineCol(source, offset) });
  const guarded = guardJianpu(normal);
  if (guarded.length) return { svgs: [], problems: guarded.map((g) => at(g.offset, g.code, g.error, '', g.vars)), changed, autoBreaks: 0, lineCount: 0 };
  const wrapped = autoBreak(normal);
  const problems: MelodyProblem[] = [];
  if (wrapped.at.length) problems.push(at(0, 'C_AUTO_BREAKS', false, '', { bars: String(AUTO_BARS_PER_LINE) }));
  try {
    const r = jp.compileScore(wrapped.text, o.compileOptions ?? {});
    const seen = new Set<string>();
    for (const d of [...r.diagnostics, ...r.layout.diagnostics]) {
      const k = `${d.code} ${d.span?.start} ${d.message}`;
      if (seen.has(k)) continue;
      seen.add(k);
      problems.push(at(originalOffset(d.span?.start ?? 0, wrapped.at), d.code ?? 'E_UNKNOWN', d instanceof jp.ErrorDiagnostic, d.message ?? ''));
    }
    const tall = tooManyLines(r.layout.lineCount);
    if (tall) return { svgs: [], problems: [...problems, at(0, tall.code, true, '', tall.vars)], changed, autoBreaks: wrapped.at.length, lineCount: r.layout.lineCount };
    for (const w of leftoverWords(r, normal)) problems.push(at(w.offset, w.code, w.error, '', w.vars));
    const svgs = o.draw ? jp.renderLayoutPagesToSvg(r.layout as never, o.svgOptions ?? {}) : [];
    return { svgs, problems, changed, autoBreaks: wrapped.at.length, lineCount: r.layout.lineCount };
  } catch (e) {
    // jpFun stops at the first error it can't get past, and throws it
    const d = e as Diag;
    return { svgs: [], problems: [...problems, at(originalOffset(d.span?.start ?? 0, wrapped.at), d.code ?? 'E_UNKNOWN', true, d.message ?? String(e))], changed, autoBreaks: wrapped.at.length, lineCount: 0 };
  }
}
