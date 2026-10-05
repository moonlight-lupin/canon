// Library check: differences between languages and likely duplicates — a read-only report for staff
// (Library → Check) and for AI agents (canon_search_library type "checks", the check_library playbook).
//  - songs: a verse that has words in one language but not another, or a different number of lines;
//  - liturgical texts: paragraphs or Leader / People / All lines that don't line up, parts missing a language;
//  - duplicates: songs or texts with the same title, a hymnal number used twice;
//  - Bibles: chapters where an installed version has fewer verses than another (a missing book, or different
//    verse numbering).
import type { L10n, Lang } from '../../shared/types.ts';
import { all } from '../db.ts';
import { getSettings } from './settings.ts';
import { BOOKS as BIBLE_BOOKS } from '../../shared/bible.ts';

export type CheckKind = 'song_verses' | 'song_lines' | 'text_paragraphs' | 'text_speakers' | 'text_parts' | 'duplicate_title' | 'duplicate_number' | 'bible_verses';
export interface CheckIssue {
  kind: CheckKind;
  /** "check" = probably needs fixing; "note" = may well be fine (e.g. a translation with an extra line) */
  level: 'check' | 'note';
  item: { type: 'song' | 'text' | 'bible'; id: number | string; title: string };
  detail: string;
  langs?: Lang[];
}

const title = (t: L10n | null | undefined) => (t ? [t.en, t.zh ?? t['zh-Hant']].filter(Boolean).join(' / ') || Object.values(t).find(Boolean) || '' : '');
const lines = (s: string | undefined) => (s ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
const paras = (s: string | undefined) => (s ?? '').replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
/** Who speaks, line by line: L = leader, C = the congregation ("All" counts as the congregation too). */
const speakers = (s: string | undefined) => lines(s).map((l) => /^([LCA]):/.exec(l)?.[1] ?? '').filter(Boolean).map((x) => (x === 'A' ? 'C' : x)).join('')
    // the order of speakers matters, not how many lines each takes: LLCCL → LCL
    .replace(/(.)\1+/g, '$1');
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
/** Chinese scripts are one language for these checks (Canon converts between them). */
const langsOf = (o: Record<string, string | undefined>, church: Lang[]) => {
  const have = church.filter((l) => o[l]?.trim());
  const zh = have.filter((l) => l === 'zh' || l === 'zh-Hant');
  return zh.length === 2 ? have.filter((l) => l !== 'zh-Hant') : have;
};

export function libraryChecks(opts: { bibles?: boolean } = {}): { issues: CheckIssue[]; counts: Record<string, number>; checked: Record<string, number> } {
  const church = getSettings().languages;
  const issues: CheckIssue[] = [];

  // ---- songs
  const songs = all<{ id: number; title: string; stanzas: string; public_domain: number }>('SELECT id, title, stanzas, public_domain FROM songs').map((s) => ({
    id: s.id, title: JSON.parse(s.title) as L10n, stanzas: JSON.parse(s.stanzas || '[]') as { label: string; text: L10n }[],
  }));
  for (const s of songs) {
    const used = [...new Set(s.stanzas.flatMap((st) => langsOf(st.text as Record<string, string>, church)))];
    if (used.length < 2) continue;
    for (const st of s.stanzas) {
      const have = langsOf(st.text as Record<string, string>, church);
      const missing = used.filter((l) => !have.includes(l));
      if (missing.length && have.length) {
        issues.push({ kind: 'song_verses', level: 'check', item: { type: 'song', id: s.id, title: title(s.title) }, detail: `verse ${st.label}: no words in ${missing.join(', ')} (has ${have.join(', ')})`, langs: missing });
      }
      if (have.length >= 2) {
        const counts = have.map((l) => lines(st.text[l]).length);
        if (Math.max(...counts) !== Math.min(...counts)) {
          issues.push({ kind: 'song_lines', level: 'note', item: { type: 'song', id: s.id, title: title(s.title) }, detail: `verse ${st.label}: ${have.map((l, i) => `${l} ${counts[i]} lines`).join(', ')}`, langs: have });
        }
      }
    }
  }

  // ---- liturgical texts
  const texts = all<{ id: number; title: string; body: string; parts: string | null }>('SELECT id, title, body, parts FROM texts').map((t) => ({
    id: t.id, title: JSON.parse(t.title) as L10n, body: JSON.parse(t.body || '{}') as L10n, parts: t.parts ? (JSON.parse(t.parts) as { label: string; body: L10n }[]) : null,
  }));
  for (const t of texts) {
    const have = langsOf(t.body as Record<string, string>, church);
    if (have.length >= 2) {
      const pc = have.map((l) => paras(t.body[l]).length);
      if (Math.max(...pc) !== Math.min(...pc)) {
        issues.push({ kind: 'text_paragraphs', level: 'check', item: { type: 'text', id: t.id, title: title(t.title) }, detail: have.map((l, i) => `${l} ${pc[i]} paragraphs`).join(', '), langs: have });
      }
      const sp = have.map((l) => speakers(t.body[l]));
      if (sp.some((x) => x !== sp[0]) && sp.some(Boolean)) {
        issues.push({ kind: 'text_speakers', level: 'check', item: { type: 'text', id: t.id, title: title(t.title) }, detail: `Leader / People / All lines differ: ${have.map((l, i) => `${l} ${sp[i] || '—'}`).join(' · ')}`, langs: have });
      }
    }
    if (t.parts?.length) {
      const partLangs = [...new Set(t.parts.flatMap((p) => langsOf(p.body as Record<string, string>, church)))];
      if (partLangs.length >= 2) {
        const short = t.parts.filter((p) => langsOf(p.body as Record<string, string>, church).length < partLangs.length);
        if (short.length) {
          const labels = short.slice(0, 12).map((p) => p.label).join(', ') + (short.length > 12 ? ` … (${short.length} in all)` : '');
          issues.push({ kind: 'text_parts', level: 'check', item: { type: 'text', id: t.id, title: title(t.title) }, detail: `parts missing a language: ${labels}`, langs: partLangs });
        }
      }
    }
  }

  // ---- duplicates
  const dupes = <T extends { id: number; title: L10n }>(rows: T[], type: 'song' | 'text') => {
    const seen = new Map<string, T>();
    for (const r of rows) {
      for (const v of Object.values(r.title)) {
        const k = v ? fold(v) : '';
        if (k.length < 3) continue;
        const prev = seen.get(k);
        if (prev && prev.id !== r.id) {
          issues.push({ kind: 'duplicate_title', level: 'check', item: { type, id: r.id, title: title(r.title) }, detail: `same title as ${type} ${prev.id} (${title(prev.title)})` });
          break;
        }
        seen.set(k, r);
      }
    }
  };
  dupes(songs, 'song');
  dupes(texts, 'text');
  for (const d of all<{ abbr: string; number: string; ids: string }>(
    `SELECT h.abbr, sh.number, GROUP_CONCAT(sh.song_id) AS ids FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id
     GROUP BY sh.hymnal_id, sh.number HAVING COUNT(*) > 1`,
  )) {
    const ids = d.ids.split(',').map(Number);
    const s = songs.find((x) => x.id === ids[1]);
    issues.push({ kind: 'duplicate_number', level: 'check', item: { type: 'song', id: ids[1], title: s ? title(s.title) : `#${ids[1]}` }, detail: `${d.abbr} ${d.number} is also song ${ids.filter((x) => x !== ids[1]).join(', ')}` });
  }

  // ---- Bibles: verse counts per chapter (heavier; on request)
  let bibleChapters = 0;
  if (opts.bibles !== false) {
    const rows = all<{ translation: string; book: number; chapter: number; n: number }>('SELECT translation, book, chapter, COUNT(*) AS n FROM bible_verses GROUP BY translation, book, chapter');
    const trs = [...new Set(rows.map((r) => r.translation))];
    if (trs.length >= 2) {
      const by = new Map<string, Map<string, number>>();
      for (const r of rows) {
        const k = `${r.book}:${r.chapter}`;
        if (!by.has(k)) by.set(k, new Map());
        by.get(k)!.set(r.translation, r.n);
      }
      bibleChapters = by.size;
      const missingBooks = new Map<string, Set<number>>();
      for (const [k, m] of by) {
        const most = Math.max(...m.values());
        const [book, chapter] = k.split(':').map(Number);
        for (const tr of trs) {
          const n = m.get(tr) ?? 0;
          if (n === 0) {
            (missingBooks.get(tr) ?? missingBooks.set(tr, new Set()).get(tr)!).add(book);
            continue;
          }
          if (n < most) {
            const name = BIBLE_BOOKS[book - 1]?.en ?? `book ${book}`;
            issues.push({ kind: 'bible_verses', level: 'note', item: { type: 'bible', id: tr, title: tr }, detail: `${name} ${chapter}: ${n} verses (another version has ${most}; numbering may differ)` });
          }
        }
      }
      for (const [tr, books] of missingBooks) {
        const names = [...books].map((b) => BIBLE_BOOKS[b - 1]?.en ?? `book ${b}`);
        issues.push({ kind: 'bible_verses', level: 'check', item: { type: 'bible', id: tr, title: tr }, detail: `missing in this version: ${names.slice(0, 10).join(', ')}${names.length > 10 ? ` … (${names.length} books or chapters)` : ''}` });
      }
    }
  }

  const counts: Record<string, number> = {};
  for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return { issues, counts, checked: { songs: songs.length, texts: texts.length, bible_chapters: bibleChapters } };
}
