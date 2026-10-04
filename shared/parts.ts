// Helpers for hymnal numbers and numbered text parts (catechism questions, confession sections).
// Shared by the server (search, render, MCP) and the web client (planner selector, library search).

// ---------------------------------------------------------------- hymnal numbers

/**
 * Recognise a hymnal-number search: "HP 123", "HP123", "TH #45", "#123" or "123" (an optional letter
 * suffix such as "10a" is allowed). Returns null for anything else.
 */
export function parseHymnalQuery(q: string): { abbr?: string; number: string } | null {
  const s = q.trim();
  let m = s.match(/^#?\s*(\d{1,4}[a-z]?)$/i);
  if (m) return { number: m[1] };
  m = s.match(/^([A-Za-z一-鿿][A-Za-z0-9一-鿿-]{0,11}?)\s*#?\s*(\d{1,4}[a-z]?)$/i);
  if (m) return { abbr: m[1], number: m[2] };
  return null;
}

/** Does a search such as "HP 123" / "#123" / "123" match one of a song's hymnal numbers? */
export function matchesHymnNumber(refs: { abbr: string; number: string }[] | undefined, q: string): boolean {
  const n = parseHymnalQuery(q);
  if (!n || !refs?.length) return false;
  const num = n.number.toLowerCase();
  const abbr = n.abbr?.toLowerCase();
  return refs.some((h) => h.number.toLowerCase() === num && (!abbr || h.abbr.toLowerCase() === abbr));
}

/** Numeric-aware comparison of hymn numbers: 2 < 10 < 10a < 11; non-numeric numbers ("S12") sort last. */
export function compareHymnNumbers(a: string, b: string): number {
  const ma = a.match(/^(\d+)(.*)$/);
  const mb = b.match(/^(\d+)(.*)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]) || ma[2].localeCompare(mb[2]);
  if (ma) return -1;
  if (mb) return 1;
  return a.localeCompare(b, undefined, { numeric: true });
}

// ---------------------------------------------------------------- text parts

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
export function toRoman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

/** Chapter prefix of a label such as "I.1" → "I." (empty for plain numbers). */
const prefixOf = (label: string) => label.match(/^(.*[.:])[^.:]+$/)?.[1] ?? '';

/**
 * Parse a selection such as "1-3", "1,4,7-9", "Q1-3", "Q.1–3", "第1-3问", "I.1-3", "I" (a whole chapter)
 * or "1.2" (= "I.2") against a text's part labels. Returns the matched labels in text order, plus the
 * tokens that matched nothing.
 */
export function parsePartSelection(input: string, labels: string[]): { labels: string[]; unknown: string[] } {
  const lower = labels.map((l) => l.toLowerCase());
  const find = (tok: string): number => {
    let i = lower.indexOf(tok.toLowerCase());
    if (i < 0) {
      // "1.2" for "I.2"
      const m = tok.match(/^(\d+)([.:])(.+)$/);
      if (m) i = lower.indexOf(`${toRoman(Number(m[1]))}${m[2]}${m[3]}`.toLowerCase());
    }
    return i;
  };
  const chapter = (tok: string): number[] => {
    const heads = [tok, /^\d+$/.test(tok) ? toRoman(Number(tok)) : ''].filter(Boolean).map((h) => h.toLowerCase() + '.');
    return lower.map((l, i) => (heads.some((h) => l.startsWith(h)) ? i : -1)).filter((i) => i >= 0);
  };
  const picked = new Set<number>();
  const unknown: string[] = [];
  const norm = input
    .replace(/\s*[-–—~～至到]\s*/g, '-')
    .split(/[,，、;；\s]+/)
    .map((t) => t.trim().replace(/^(?:q(?:uestion)?s?\.?|§|第)\s*/i, '').replace(/[问問.]$/, ''))
    .filter(Boolean);
  for (const tok of norm) {
    const range = tok.match(/^(.+?)-(?:q\.?|第)?(.+)$/i);
    if (range) {
      const ia = find(range[1]);
      let ib = find(range[2]);
      if (ib < 0 && ia >= 0) ib = find(prefixOf(labels[ia]) + range[2]);
      if (ia >= 0 && ib >= ia) {
        for (let i = ia; i <= ib; i++) picked.add(i);
        continue;
      }
      unknown.push(tok);
      continue;
    }
    const i = find(tok);
    if (i >= 0) {
      picked.add(i);
      continue;
    }
    const ch = chapter(tok);
    if (ch.length) ch.forEach((x) => picked.add(x));
    else unknown.push(tok);
  }
  return { labels: [...picked].sort((a, b) => a - b).map((i) => labels[i]), unknown };
}

/**
 * Compress selected labels into runs in text order, e.g. ["1","2","3","5"] → ["1–3","5"],
 * ["I.1","I.2","I.3"] → ["I.1–3"].
 */
export function partRuns(selected: string[], labels: string[]): string[] {
  const idx = [...new Set(selected.map((l) => labels.indexOf(l)).filter((i) => i >= 0))].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const from = labels[idx[k]];
    const to = labels[idx[j]];
    if (j === k) runs.push(from);
    else {
      const p = prefixOf(from);
      runs.push(p && prefixOf(to) === p ? `${from}–${to.slice(p.length)}` : `${from}–${to}`);
    }
    k = j + 1;
  }
  return runs;
}

/** The next / previous block of `size` parts after (or before) the current selection. */
export function shiftBlock(selected: string[], labels: string[], dir: 1 | -1, size?: number): string[] {
  const idx = selected.map((l) => labels.indexOf(l)).filter((i) => i >= 0).sort((a, b) => a - b);
  const n = size ?? Math.max(1, idx.length || 1);
  if (!labels.length) return [];
  let start = !idx.length ? 0 : dir > 0 ? idx[idx.length - 1] + 1 : idx[0] - n;
  start = Math.max(0, Math.min(start, labels.length - n));
  return labels.slice(start, start + n);
}
