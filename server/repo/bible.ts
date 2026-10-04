import fs from 'node:fs';
import path from 'node:path';
import * as OpenCC from 'opencc-js';
import type { Lang } from '../../shared/types.ts';
import { BOOKS, bookName, formatRef, parseRef, type RefSegment } from '../../shared/bible.ts';
import { BIBLE_SOURCES, isChinese, langInfo } from '../../shared/languages.ts';
import { all, db, get, tx } from '../db.ts';
import { config } from '../config.ts';
import { bibleFor } from './settings.ts';
import { toSimplified, toTraditional } from '../lib/chinese.ts';

export interface Verse {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

export interface Passage {
  ref: string; // normalised, in the passage language
  translation: string;
  lang: Lang;
  verses: Verse[];
}

export function translations() {
  return all<{ code: string; lang: string; name: string; license: string; source: 'catalog' | 'upload'; notes: string | null; created_at: string | null; verses: number }>(
    `SELECT t.*, (SELECT COUNT(*) FROM bible_verses v WHERE v.translation = t.code) AS verses FROM bible_translations t ORDER BY lang, code`,
  );
}

const hasTranslation = (code: string) => !!get('SELECT 1 FROM bible_verses WHERE translation = ? LIMIT 1', code);
const translationLang = (code: string) => get<{ lang: string }>('SELECT lang FROM bible_translations WHERE code = ?', code)?.lang;

/** Can a translation be used for a language? Same language, or the other Chinese script (converted). */
export const compatible = (translationLang: string, lang: Lang) =>
  translationLang === lang || (isChinese(translationLang) && isChinese(lang));

/** Is the translation installed and in a language compatible with `lang`? */
function usableFor(code: string, lang: Lang) {
  const tl = translationLang(code);
  return !!tl && compatible(tl, lang) && hasTranslation(code);
}

/** The first of the chosen versions (reading, then service) that is installed and fits the language; else the church default. */
export function pickTranslation(lang: Lang, ...choices: (string | null | undefined)[]): string | undefined {
  return choices.find((c): c is string => !!c && usableFor(c, lang)) ?? defaultTranslation(lang);
}

/** Validate an explicitly requested version (REST / MCP): installed, and for this language. */
export function checkTranslation(code: string, lang: Lang) {
  const tl = translationLang(code);
  if (!tl || !hasTranslation(code)) {
    throw Object.assign(new Error(`Bible version "${code}" is not installed. Installed: ${translations().map((t) => t.code).join(', ') || 'none'}.`), { status: 404 });
  }
  if (!compatible(tl, lang)) {
    throw Object.assign(new Error(`${code} is a ${langInfo(tl).name} Bible; it cannot be used for ${langInfo(lang).name} (lang=${lang}).`), { status: 400 });
  }
}

export function defaultTranslation(lang: Lang): string | undefined {
  return bibleFor(lang);
}

function segmentVerses(translation: string, s: RefSegment): Verse[] {
  // Encode (chapter, verse) as chapter*1000+verse to express ranges spanning chapters.
  const lo = s.startCh * 1000 + (s.startV ?? 0);
  const hi = s.endCh * 1000 + (s.endV ?? 999);
  return all<Verse>(
    `SELECT book, chapter, verse, text FROM bible_verses
     WHERE translation = ? AND book = ? AND chapter * 1000 + verse BETWEEN ? AND ?
     ORDER BY chapter, verse`,
    translation, s.book, lo, hi,
  );
}

/**
 * Look up a passage. Throws RefError on an unparseable reference.
 * If the language's Bible isn't imported but the other Chinese script is, the text is converted.
 */
export function passage(ref: string, lang: Lang, translation = defaultTranslation(lang)): Passage {
  const segs = parseRef(ref);
  // A chosen version that has been deleted, or belongs to another language, falls back to the church default.
  let code = translation && translation !== defaultTranslation(lang) && !usableFor(translation, lang) ? defaultTranslation(lang) : translation;
  let convert: ((s: string) => string) | null = null;
  const tLang = code ? translationLang(code) : undefined;
  if (code && tLang && tLang !== lang && isChinese(lang) && isChinese(tLang) && hasTranslation(code)) {
    convert = lang === 'zh' ? toSimplified : toTraditional;
  }
  if ((!code || !hasTranslation(code)) && isChinese(lang)) {
    const other = lang === 'zh' ? bibleFor('zh-Hant') : bibleFor('zh');
    if (other && hasTranslation(other)) {
      code = other;
      convert = lang === 'zh' ? toSimplified : toTraditional;
    }
  }
  if (!code) return { ref: formatRef(segs, lang), translation: '', lang, verses: [] };
  let verses = segs.flatMap((s) => segmentVerses(code!, s));
  if (convert) verses = verses.map((v) => ({ ...v, text: convert!(v.text) }));
  return { ref: formatRef(segs, lang), translation: code, lang, verses };
}

/** LIKE search within one translation, canonical order. */
export function searchBible(q: string, translation: string, limit = 50) {
  return all<Verse>(
    `SELECT book, chapter, verse, text FROM bible_verses WHERE translation = ? AND text LIKE ? ORDER BY book, chapter, verse LIMIT ?`,
    translation, `%${q}%`, limit,
  ).map((v) => ({ ...v, ref: `${BOOKS[v.book - 1].en} ${v.chapter}:${v.verse}` }));
}

export { bookName };

// ---------------------------------------------------------------- import

interface SrcBible { translation: string; books: { name: string; chapters: { chapter: number; verses: { verse: number; text: string }[] }[] }[] }

export const BIBLE_SRC_DIR = path.join(config.root, 'data', 'bible-src');
const SOURCE_URL = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/';

const CJK = '\\u3000-\\u303f\\u4e00-\\u9fff\\uff00-\\uffef「」『』';
const cleanCjk = (s: string) =>
  s.replace(/\s+/g, ' ').replace(new RegExp(` (?=[${CJK}])`, 'g'), '').replace(new RegExp(`(?<=[${CJK}]) `, 'g'), '').trim();
let t2s: ((s: string) => string) | null = null;

const TRANSFORMS: Record<string, (s: string) => string> = {
  none: (s) => s.replace(/\s+/g, ' ').trim(),
  cjk: cleanCjk,
  'cjk-s': (s) => {
    t2s ??= OpenCC.Converter({ from: 'tw', to: 'cn' });
    return t2s(cleanCjk(s)).replace(/「/g, '“').replace(/」/g, '”').replace(/『/g, '‘').replace(/』/g, '’');
  },
};

/**
 * Import a catalogued public-domain Bible (see shared/languages.ts). Downloads the source file from
 * scrollmapper/bible_databases into data/bible-src on first use. Returns the number of verses.
 */
export async function importBible(code: string, log: (s: string) => void = console.log): Promise<number> {
  const src = BIBLE_SOURCES[code];
  if (!src) throw Object.assign(new Error(`Unknown Bible translation ${code}`), { status: 400 });
  fs.mkdirSync(BIBLE_SRC_DIR, { recursive: true });
  const file = path.join(BIBLE_SRC_DIR, src.file);
  if (!fs.existsSync(file)) {
    log(`Downloading ${src.file} …`);
    const res = await fetch(SOURCE_URL + src.file);
    if (!res.ok) throw new Error(`Download of ${src.file} failed (${res.status})`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) as SrcBible;
  if (data.books.length < 66) throw new Error(`${src.file}: expected 66 books, got ${data.books.length}`);
  const clean = TRANSFORMS[src.transform ?? 'none'];
  let count = 0;
  tx(() => {
    db.prepare('DELETE FROM bible_verses WHERE translation = ?').run(code);
    db.prepare('INSERT OR REPLACE INTO bible_translations (code, lang, name, license, source, created_at) VALUES (?,?,?,?,?,?)').run(
      code, src.lang, `${src.name}${src.year ? ` (${src.year})` : ''}`, 'Public domain', 'catalog', new Date().toISOString(),
    );
    const ins = db.prepare('INSERT OR REPLACE INTO bible_verses (translation, book, chapter, verse, text) VALUES (?,?,?,?,?)');
    data.books.slice(0, 66).forEach((b, bi) => {
      for (const c of b.chapters) for (const v of c.verses) {
        ins.run(code, bi + 1, c.chapter, v.verse, clean(v.text));
        count++;
      }
    });
  });
  log(`${code}: ${count} verses imported`);
  return count;
}

// Background import jobs started from the web UI (one at a time per translation).
export const importJobs = new Map<string, { status: 'running' | 'done' | 'error'; message: string }>();

export function startImport(code: string) {
  const cur = importJobs.get(code);
  if (cur?.status === 'running') return cur;
  const job = { status: 'running' as 'running' | 'done' | 'error', message: 'Starting…' };
  importJobs.set(code, job);
  importBible(code, (m) => (job.message = m))
    .then((n) => Object.assign(job, { status: 'done', message: `${n} verses` }))
    .catch((e: Error) => Object.assign(job, { status: 'error', message: e.message }));
  return job;
}
