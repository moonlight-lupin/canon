// Church-uploaded Bibles: any translation the church has permission to use (ESV, NIV, 和合本修订版, 新译本,
// Alkitab, Tamil …) imported from a CSV file (book,chapter,verse,text or reference,text) or a
// scrollmapper/bible_databases JSON file. Upload is two-step: a dry run reports what was found (books,
// verse count, duplicates, unreadable rows, sample verses) and writes nothing; the import replaces the
// translation in one transaction with prepared statements (~31k verses in well under a second).
import type { Lang } from '../../shared/types.ts';
import { BOOKS, bookName, findBook, parseRef } from '../../shared/bible.ts';
import { BIBLE_SOURCES, LANGUAGE_CATALOG, LANG_CODE_RE, langInfo } from '../../shared/languages.ts';
import { all, db, get, tx } from '../db.ts';
import { decodeCsv, detectDelimiter, matchHeaders, parseRecords, readCell, writeCsv } from '../lib/csv.ts';
import { M, say, type Msg } from '../csv/engine.ts';
import { getSettings } from './settings.ts';
import { UPLOAD_RIGHTS } from '../../shared/bible-rights.ts';

/** 2–12 characters: capital letters, digits and hyphens, e.g. ESV, CUNP, RCUV-S, TB2. */
export const BIBLE_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

export interface UploadMeta {
  code: string;
  name: string;
  lang: Lang;
  notes: string;
  permission: boolean;
}

interface ParsedVerse {
  row: number;
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

interface Parsed {
  format: 'csv' | 'json';
  encoding: string;
  delimiter: string | null;
  notes: Msg[];
  fatal: Msg | null;
  verses: ParsedVerse[];
  errors: { row: number; msg: Msg }[];
  duplicates: { row: number; first: number; ref: string }[];
}

const err = (status: number, m: Msg, lang: Lang) => Object.assign(new Error(say(m, lang)), { status });

// ---------------------------------------------------------------- parsing helpers

// USFM / Paratext book codes that the English-name matcher in shared/bible.ts does not already resolve.
const EXTRA_BOOK_CODES: Record<string, number> = { sng: 22, jol: 29, nam: 34 };

function bookResolver() {
  const cache = new Map<string, number | null>();
  return (raw: string): number | null => {
    const s = raw.normalize('NFKC').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n >= 1 && n <= 66 ? n : null;
    }
    if (cache.has(s)) return cache.get(s)!;
    const n = EXTRA_BOOK_CODES[s.toLowerCase()] ?? findBook(s)?.n ?? null;
    cache.set(s, n);
    return n;
  };
}

const intIn = (s: string, max: number): number | null => {
  const t = (s ?? '').normalize('NFKC').trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= max ? n : null;
};

/** Verse text: line breaks inside a cell become spaces; other spacing is kept as the publisher wrote it. */
const cleanText = (s: string) => s.replace(/[ \t]*[\r\n]+[ \t]*/g, ' ').replace(/^\s+|\s+$/g, '');

const refOf = (b: number, c: number, v: number) => `${BOOKS[b - 1].en} ${c}:${v}`;

const CSV_COLS = [
  { key: 'book', aliases: ['book_name', 'bookname', 'book_number', 'book_no', 'book_id', 'b', '书卷', '書卷', '卷', '书', '書', '卷名'] },
  { key: 'chapter', aliases: ['ch', 'chap', 'c', '章'] },
  { key: 'verse', aliases: ['v', 'vs', 'verse_number', 'verse_no', '节', '節'] },
  { key: 'text', aliases: ['verse_text', 'content', 'scripture', 't', '经文', '經文', '内容', '內容'] },
  { key: 'reference', aliases: ['ref', 'passage', '经节', '經節', '出处', '出處'] },
];

class Collector {
  verses: ParsedVerse[] = [];
  errors: { row: number; msg: Msg }[] = [];
  duplicates: { row: number; first: number; ref: string }[] = [];
  private seen = new Map<number, number>();
  book = bookResolver();

  add(row: number, book: number, chapter: number, verse: number, text: string) {
    const k = book * 1_000_000 + chapter * 1000 + verse;
    const first = this.seen.get(k);
    if (first !== undefined) {
      this.duplicates.push({ row, first, ref: refOf(book, chapter, verse) });
      return;
    }
    this.seen.set(k, row);
    this.verses.push({ row, book, chapter, verse, text });
  }

  /** One verse given as separate book / chapter / verse values. */
  parts(row: number, bookRaw: string, chRaw: string, vRaw: string, textRaw: string) {
    const problems: Msg[] = [];
    const b = this.book(bookRaw);
    if (!bookRaw.trim()) problems.push(M('book is empty', '书卷是空的'));
    else if (!b) problems.push(M(`unknown book "${bookRaw.trim()}"`, `无法识别的书卷「${bookRaw.trim()}」`));
    const c = intIn(chRaw, 200);
    if (!c) problems.push(M(`chapter "${chRaw ?? ''}" is not a number`, `章「${chRaw ?? ''}」不是数字`));
    const v = intIn(vRaw, 200);
    if (!v) problems.push(M(`verse "${vRaw ?? ''}" is not a number`, `节「${vRaw ?? ''}」不是数字`));
    const text = cleanText(textRaw ?? '');
    if (!text) problems.push(M('the text is empty', '经文是空的'));
    if (problems.length) {
      this.errors.push({ row, msg: M(problems.map((p) => p.en).join('; '), problems.map((p) => p.zh).join('；')) });
      return;
    }
    this.add(row, b!, c!, v!, text);
  }

  /** One verse given as a reference such as "John 3:16" or "约3:16". */
  reference(row: number, refRaw: string, textRaw: string) {
    const ref = (refRaw ?? '').trim();
    const text = cleanText(textRaw ?? '');
    let seg;
    try {
      const segs = parseRef(ref);
      if (segs.length === 1 && segs[0].startV !== null && segs[0].startCh === segs[0].endCh && segs[0].startV === segs[0].endV) seg = segs[0];
    } catch {
      /* reported below */
    }
    if (!seg) {
      this.errors.push({ row, msg: M(`"${ref}" is not a single verse reference such as John 3:16`, `「${ref}」不是单节经文出处（例如 约翰福音 3:16）`) });
      return;
    }
    if (!text) {
      this.errors.push({ row, msg: M('the text is empty', '经文是空的') });
      return;
    }
    this.add(row, seg.book, seg.startCh, seg.startV!, text);
  }
}

function parseCsvBible(text: string, out: Parsed) {
  const delimiter = detectDelimiter(text);
  out.delimiter = delimiter;
  if (delimiter === ';') out.notes.push(M('Columns were separated by semicolons (;) — read correctly.', '栏位以分号（;）分隔，已正确读取。'));
  if (delimiter === '\t') out.notes.push(M('Columns were separated by tabs — read correctly.', '栏位以 Tab 分隔，已正确读取。'));
  const records = parseRecords(text, delimiter);
  if (!records.length) {
    out.fatal = M('The file is empty.', '文件是空的。');
    return;
  }
  const c = new Collector();
  let mapped = matchHeaders(records[0].cells, CSV_COLS);
  let data = records.slice(1);
  const has = (k: string) => mapped.includes(k);
  if (!has('text') || !(has('reference') || (has('book') && has('chapter') && has('verse')))) {
    // No recognisable heading row: accept a headerless file of book,chapter,verse,text or reference,text.
    const first = records[0].cells;
    if (first.length >= 4 && c.book(first[0]) && intIn(first[1], 200) && intIn(first[2], 200)) {
      mapped = ['book', 'chapter', 'verse', 'text'];
      data = records;
      out.notes.push(M('The file has no heading row; columns were read as book, chapter, verse, text.', '文件没有标题行；栏位按 book、chapter、verse、text 读取。'));
    } else if (first.length >= 2 && /\d+\s*[:：]\s*\d+/.test(first[0])) {
      mapped = ['reference', 'text'];
      data = records;
      out.notes.push(M('The file has no heading row; columns were read as reference, text.', '文件没有标题行；栏位按 reference、text 读取。'));
    } else {
      out.fatal = M(
        'The columns were not recognised. The first row must be the headings book,chapter,verse,text (or reference,text) — download the template to see an example.',
        '无法识别栏位。第一行必须是标题 book,chapter,verse,text（或 reference,text）——可下载模板查看示例。',
      );
      return;
    }
  }
  const at = (k: string) => mapped.indexOf(k);
  const iB = at('book'), iC = at('chapter'), iV = at('verse'), iT = at('text'), iR = at('reference');
  const useParts = iB >= 0 && iC >= 0 && iV >= 0;
  for (const r of data) {
    const cell = (i: number) => (i >= 0 ? r.cells[i] ?? '' : '');
    if (useParts && (cell(iB).trim() || iR < 0)) c.parts(r.row, readCell(cell(iB)), cell(iC), cell(iV), readCell(cell(iT)));
    else c.reference(r.row, readCell(cell(iR)), readCell(cell(iT)));
  }
  Object.assign(out, { verses: c.verses, errors: c.errors, duplicates: c.duplicates });
}

interface JsonVerse { book?: unknown; book_name?: unknown; b?: unknown; chapter?: unknown; c?: unknown; verse?: unknown; v?: unknown; text?: unknown; t?: unknown }
interface JsonBook { name?: unknown; chapters?: { chapter?: unknown; verses?: { verse?: unknown; text?: unknown }[] }[] }

function parseJsonBible(text: string, out: Parsed) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    out.fatal = M('This is not a valid JSON file.', '这不是有效的 JSON 文件。');
    return;
  }
  const c = new Collector();
  const s = (x: unknown) => (x === null || x === undefined ? '' : String(x));
  const obj = data as { books?: JsonBook[]; verses?: JsonVerse[] };
  if (obj && Array.isArray(obj.books)) {
    // scrollmapper/bible_databases: {translation, books:[{name, chapters:[{chapter, verses:[{verse, text}]}]}]}
    const books = obj.books;
    let row = 0;
    books.forEach((bk, bi) => {
      const name = s(bk?.name);
      // names first; a full 66-book file whose names are unusual falls back to its book order
      const n = c.book(name) ?? (books.length === 66 ? bi + 1 : null);
      for (const ch of bk?.chapters ?? []) {
        for (const v of ch?.verses ?? []) {
          row++;
          if (!n) {
            c.errors.push({ row, msg: M(`unknown book "${name}"`, `无法识别的书卷「${name}」`) });
            continue;
          }
          c.parts(row, String(n), s(ch.chapter), s(v?.verse), s(v?.text));
        }
      }
    });
  } else {
    const list = Array.isArray(data) ? (data as JsonVerse[]) : Array.isArray(obj?.verses) ? obj.verses : null;
    if (!list) {
      out.fatal = M(
        'Unknown JSON layout. Use a scrollmapper/bible_databases JSON file, or a list of {book, chapter, verse, text}.',
        '无法识别的 JSON 结构。请使用 scrollmapper/bible_databases 的 JSON 文件，或 {book, chapter, verse, text} 列表。',
      );
      return;
    }
    list.forEach((v, i) => c.parts(i + 1, s(v?.book_name ?? v?.book ?? v?.b), s(v?.chapter ?? v?.c), s(v?.verse ?? v?.v), s(v?.text ?? v?.t)));
  }
  Object.assign(out, { verses: c.verses, errors: c.errors, duplicates: c.duplicates });
}

/** Read an uploaded Bible file (CSV in any of the usual encodings, or JSON). Writes nothing. */
export function parseBibleFile(buf: Uint8Array): Parsed {
  const { text, encoding } = decodeCsv(buf);
  const out: Parsed = { format: 'csv', encoding, delimiter: null, notes: [], fatal: null, verses: [], errors: [], duplicates: [] };
  if (encoding === 'gb18030' || encoding === 'big5') {
    const name = encoding === 'big5' ? 'Big5' : 'GBK';
    out.notes.push(M(
      `This file was saved in a Chinese (${name}) encoding; it was converted automatically. Next time choose "CSV UTF-8".`,
      `此文件以中文（${name}）编码保存，已自动转换。下次请选择「CSV UTF-8」格式。`,
    ));
  }
  if (/^\s*[[{]/.test(text)) {
    out.format = 'json';
    parseJsonBible(text, out);
  } else {
    parseCsvBible(text, out);
  }
  if (!out.fatal && !out.verses.length) out.fatal = M('No verses were found in the file.', '文件中没有找到任何经文。');
  return out;
}

// ---------------------------------------------------------------- metadata & usage

export interface TranslationRow { code: string; lang: string; name: string; license: string; source: string; notes: string | null; created_at: string | null }

export const translationRow = (code: string) => get<TranslationRow>('SELECT * FROM bible_translations WHERE code = ?', code);

/** Languages a Bible may be uploaded for: the church's languages and every language in the catalog. */
export const uploadLangs = (): string[] => [...new Set([...getSettings().languages, ...LANGUAGE_CATALOG.map((l) => l.code)])];

export function readMeta(q: Record<string, string | undefined>): UploadMeta {
  return {
    code: (q.code ?? '').trim().toUpperCase(),
    name: (q.name ?? '').trim(),
    // `lang` is the language of the messages (as in the CSV framework); `language` is the Bible's language
    lang: (q.language ?? '').trim(),
    notes: (q.notes ?? '').trim(),
    permission: q.permission === '1' || q.permission === 'true',
  };
}

function metaProblems(m: UploadMeta): Msg[] {
  const out: Msg[] = [];
  if (!BIBLE_CODE_RE.test(m.code)) {
    out.push(M('Code: use 2–12 capital letters, digits or hyphens (e.g. ESV, CUNP, TB2).', '代号：请用 2–12 个大写字母、数字或连字符（例如 ESV、CUNP、TB2）。'));
  }
  if (!m.name) out.push(M('Name is empty — e.g. English Standard Version, 和合本修订版.', '名称是空的——例如 English Standard Version、和合本修订版。'));
  if (m.name.length > 100) out.push(M('Name is too long (at most 100 characters).', '名称太长（最多 100 个字）。'));
  if (m.notes.length > 1000) out.push(M('Copyright note is too long (at most 1000 characters).', '版权说明太长（最多 1000 个字）。'));
  if (!LANG_CODE_RE.test(m.lang) || !uploadLangs().includes(m.lang)) {
    out.push(M('Choose the language of this Bible.', '请选择此圣经译本的语言。'));
  }
  const cat = BIBLE_SOURCES[m.code];
  if (cat && m.lang && cat.lang !== m.lang) {
    out.push(M(
      `${m.code} is the code of the ${langInfo(cat.lang).name} ${cat.name}; choose another code.`,
      `${m.code} 是 ${langInfo(cat.lang).native}《${cat.name}》的代号，请换一个代号。`,
    ));
  }
  return out;
}

/** Where a translation is used: as a church default and in services / readings. */
export function translationUsage(code: string) {
  const bibles = getSettings().bibles;
  const default_for = Object.keys(bibles).filter((l) => bibles[l] === code);
  const services = get<{ n: number }>(
    `SELECT COUNT(DISTINCT s.id) n FROM services s
     WHERE EXISTS (SELECT 1 FROM json_each(s.bibles) WHERE value = ?)
        OR EXISTS (SELECT 1 FROM service_items i, json_each(i.bibles) j WHERE i.service_id = s.id AND j.value = ?)`,
    // two plain placeholders (a repeated ?1 with one value was refused by older node:sqlite)
    code, code,
  )!.n;
  return { default_for, services };
}

// ---------------------------------------------------------------- upload

export interface UploadPreview {
  dry_run: boolean;
  applied: boolean;
  format: 'csv' | 'json';
  encoding: string;
  delimiter: string | null;
  notes: string[];
  fatal: string | null;
  meta: { code: string; name: string; lang: string; notes: string };
  meta_errors: string[];
  /** an installed translation with this code would be replaced */
  existing: { name: string; lang: string; source: string; verses: number; default_for: string[]; services: number } | null;
  verses: number;
  chapters: number;
  books: { found: { n: number; name: string; chapters: number; verses: number }[]; missing: { n: number; name: string }[] };
  duplicates: { count: number; rows: { row: number; first: number; ref: string }[] };
  errors: { count: number; rows: { row: number; message: string }[] };
  samples: { ref: string; text: string }[];
}

const SAMPLE_REFS: [number, number, number][] = [[1, 1, 1], [19, 23, 1], [43, 3, 16]];

/**
 * Check (dryRun) or import an uploaded Bible. The import is all-or-nothing: rows that cannot be read block it
 * unless skipErrors; an existing translation with the same code is only replaced when `replace` is set.
 */
export function uploadBible(
  buf: Uint8Array,
  meta: UploadMeta,
  opts: { dryRun: boolean; replace?: boolean; skipErrors?: boolean; lang: Lang },
): UploadPreview {
  const l = opts.lang;
  const p = parseBibleFile(buf);
  const problems = metaProblems(meta);
  const row = BIBLE_CODE_RE.test(meta.code) ? translationRow(meta.code) : undefined;
  const existingVerses = row ? get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses WHERE translation = ?', row.code)!.n : 0;

  const byBook = new Map<number, { chapters: Set<number>; verses: number }>();
  for (const v of p.verses) {
    const b = byBook.get(v.book) ?? { chapters: new Set<number>(), verses: 0 };
    b.chapters.add(v.chapter);
    b.verses++;
    byBook.set(v.book, b);
  }
  const nameIn = (n: number) => bookName(BOOKS[n - 1], l === 'zh' || l === 'zh-Hant' ? l : 'en');
  const index = new Map(p.verses.map((v) => [v.book * 1_000_000 + v.chapter * 1000 + v.verse, v]));
  let samples = SAMPLE_REFS.map(([b, c, v]) => index.get(b * 1_000_000 + c * 1000 + v)).filter((v): v is ParsedVerse => !!v);
  if (!samples.length) samples = [...p.verses].sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse).slice(0, 3);

  const preview: UploadPreview = {
    dry_run: opts.dryRun,
    applied: false,
    format: p.format,
    encoding: p.encoding,
    delimiter: p.delimiter,
    notes: p.notes.map((m) => say(m, l)),
    fatal: p.fatal ? say(p.fatal, l) : null,
    meta: { code: meta.code, name: meta.name, lang: meta.lang, notes: meta.notes },
    meta_errors: problems.map((m) => say(m, l)),
    existing: row ? { name: row.name, lang: row.lang, source: row.source, verses: existingVerses, ...translationUsage(row.code) } : null,
    verses: p.verses.length,
    chapters: [...byBook.values()].reduce((n, b) => n + b.chapters.size, 0),
    books: {
      found: [...byBook.entries()].sort((a, b) => a[0] - b[0]).map(([n, b]) => ({ n, name: nameIn(n), chapters: b.chapters.size, verses: b.verses })),
      missing: BOOKS.filter((b) => !byBook.has(b.n)).map((b) => ({ n: b.n, name: nameIn(b.n) })),
    },
    duplicates: { count: p.duplicates.length, rows: p.duplicates.slice(0, 50) },
    errors: { count: p.errors.length, rows: p.errors.slice(0, 100).map((e) => ({ row: e.row, message: say(e.msg, l) })) },
    samples: samples.map((v) => ({ ref: `${nameIn(v.book)} ${v.chapter}:${v.verse}`, text: v.text.length > 240 ? v.text.slice(0, 237) + '…' : v.text })),
  };
  if (opts.dryRun) return preview;

  // ---- import
  if (p.fatal) throw err(400, p.fatal, l);
  if (problems.length) throw err(400, problems[0], l);
  if (!meta.permission) {
    throw err(400, M(
      'Tick "We have permission to use this translation in our church" before importing.',
      '导入前请勾选「本教会已获准使用此译本（版权）」。',
    ), l);
  }
  if (p.errors.length && !opts.skipErrors) {
    throw err(422, M(
      `Nothing was imported: ${p.errors.length} row(s) could not be read. Fix them, or import the readable verses and skip the others.`,
      `未导入任何经文：有 ${p.errors.length} 行无法读取。请先修正，或只导入可读取的经文并跳过其他行。`,
    ), l);
  }
  if (row && !opts.replace) {
    throw err(409, M(
      `${meta.code} is already installed (${row.name}, ${existingVerses} verses). Confirm to replace it.`,
      `${meta.code} 已安装（${row.name}，${existingVerses} 节）。请确认是否替换。`,
    ), l);
  }
  const license = (meta.notes.split(/\r?\n/)[0] || 'Used with permission').slice(0, 200);
  const before = db.prepare('SELECT edition, rights FROM bible_translations WHERE code = ?').get(meta.code) as { edition: string | null; rights: string } | undefined;
  tx(() => {
    db.prepare('DELETE FROM bible_verses WHERE translation = ?').run(meta.code);
    db.prepare('INSERT OR REPLACE INTO bible_translations (code, lang, name, license, source, notes, created_at, edition, rights) VALUES (?,?,?,?,?,?,?,?,?)').run(
      meta.code, meta.lang, meta.name, license, 'upload', meta.notes || null, new Date().toISOString(), before?.edition ?? null, before?.rights ?? JSON.stringify(UPLOAD_RIGHTS),
    );
    const ins = db.prepare('INSERT INTO bible_verses (translation, book, chapter, verse, text) VALUES (?,?,?,?,?)');
    for (const v of p.verses) ins.run(meta.code, v.book, v.chapter, v.verse, v.text);
  });
  return { ...preview, applied: true };
}

// ---------------------------------------------------------------- delete, export, template

/** Remove a translation (catalog Bibles can be downloaded again). Stale references fall back to the defaults. */
export function deleteTranslation(code: string, lang: Lang) {
  const row = translationRow(code);
  const verses = get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses WHERE translation = ?', code)!.n;
  if (!row && !verses) throw err(404, M(`Bible version ${code} is not installed.`, `圣经译本 ${code} 未安装。`), lang);
  const usage = translationUsage(code);
  tx(() => {
    db.prepare('DELETE FROM bible_verses WHERE translation = ?').run(code);
    db.prepare('DELETE FROM bible_translations WHERE code = ?').run(code);
  });
  return { ok: true, code, verses, ...usage };
}

const EXPORT_COLS = ['book', 'chapter', 'verse', 'text'];

/** The whole translation as book,chapter,verse,text (English book names), ready to re-import. */
export function exportTranslationCsv(code: string, lang: Lang): string {
  if (!translationRow(code)) throw err(404, M(`Bible version ${code} is not installed.`, `圣经译本 ${code} 未安装。`), lang);
  const rows = all<{ book: number; chapter: number; verse: number; text: string }>(
    'SELECT book, chapter, verse, text FROM bible_verses WHERE translation = ? ORDER BY book, chapter, verse', code,
  );
  return writeCsv([EXPORT_COLS, ...rows.map((v) => [BOOKS[v.book - 1].en, v.chapter, v.verse, v.text])]);
}

/** Template: the heading row, Genesis 1:1–3 (KJV) and 创世记 1:1 (和合本) as examples. */
export function bibleTemplateCsv(): string {
  return writeCsv([
    EXPORT_COLS,
    ['Genesis', 1, 1, 'In the beginning God created the heaven and the earth.'],
    ['Gen', 1, 2, 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.'],
    [1, 1, 3, 'And God said, Let there be light: and there was light.'],
    ['创世记', 1, 1, '起初，神创造天地。'],
  ]);
}

