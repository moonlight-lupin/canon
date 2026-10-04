// Song (hymn / psalm) and liturgical text library, hymnals (numbered hymnbooks) and long texts in parts.
import fs from 'node:fs';
import path from 'node:path';
import type { Hymnal, L10n, LiturgyText, Song, SongHymnalRef, TextCategory, TextPart } from '../../shared/types.ts';
import { compareHymnNumbers, parseHymnalQuery, partRuns, toRoman } from '../../shared/parts.ts';
import { LANG_CODE_RE } from '../../shared/languages.ts';
import { all, get, run, tx, type SqlValue } from '../db.ts';
import { config } from '../config.ts';
import { table, likeTerm, BadRequest } from '../lib/table.ts';
import { toSimplified } from '../lib/chinese.ts';

// ---------------------------------------------------------------- songs

const songTable = table<Song>({
  name: 'songs',
  cols: [
    'key', 'title', 'author', 'composer', 'tune', 'meter', 'year', 'category', 'psalm', 'public_domain', 'copyright',
    'ccli', 'tags', 'stanzas', 'refrain_after_each', 'notes',
  ],
  json: ['title', 'tags', 'stanzas'],
  bool: ['public_domain', 'refrain_after_each'],
});

/** Attach `hymnals` (where each song appears, in hymnal sort order) with a single query. */
export function withHymnals<T extends Song>(rows: T[]): T[] {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const refs = all<SongHymnalRef & { song_id: number }>(
    `SELECT sh.song_id, sh.hymnal_id, h.abbr, sh.number FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id
     ${ids.length <= 500 ? `WHERE sh.song_id IN (${ids.map(() => '?').join(',')})` : ''}
     ORDER BY h.sort, h.id`,
    ...(ids.length <= 500 ? ids : []),
  );
  const by = new Map<number, SongHymnalRef[]>();
  for (const { song_id, ...r } of refs) by.set(song_id, [...(by.get(song_id) ?? []), r]);
  for (const r of rows) r.hymnals = by.get(r.id) ?? [];
  return rows;
}

/** Songs table; list / get / find include `hymnals`. */
export const songs = {
  ...songTable,
  list(where = '', params: SqlValue[] = [], order = 'id'): Song[] {
    return withHymnals(songTable.list(where, params, order));
  },
  get(id: number): Song {
    return withHymnals([songTable.get(id)])[0];
  },
  find(id: number): Song | undefined {
    const s = songTable.find(id);
    return s ? withHymnals([s])[0] : undefined;
  },
};

export const texts = table<LiturgyText>({
  name: 'texts',
  cols: ['key', 'category', 'title', 'body', 'source', 'tags', 'public_domain', 'parts'],
  json: ['title', 'body', 'tags', 'parts'],
  bool: ['public_domain'],
});

const HYMNAL_MATCH = (abbr?: string) =>
  `id IN (SELECT sh.song_id FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id
          WHERE sh.number = ? COLLATE NOCASE${abbr ? ' AND h.abbr = ? COLLATE NOCASE' : ''})`;

/**
 * Search songs by words (title, author, tune, tags, lyrics, psalm number) or by hymnal number:
 * "HP 123", "#123" or "123". Hymnal matches come first.
 */
export function searchSongs(q = '', category?: string, limit = 5000) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  let order = `json_extract(title,'$.en') COLLATE NOCASE`;
  const orderParams: SqlValue[] = [];
  if (q) {
    // title + first lines + tune + tags; JSON text is searched as-is which covers every language
    const words = `(title || ' ' || IFNULL(author,'') || ' ' || IFNULL(tune,'') || ' ' || tags || ' ' || stanzas || ' ' || IFNULL(psalm,'')) LIKE ? ESCAPE '\\'`;
    const num = parseHymnalQuery(q);
    if (num) {
      const np = num.abbr ? [num.number, num.abbr] : [num.number];
      where.push(`(${HYMNAL_MATCH(num.abbr)} OR ${words})`);
      params.push(...np, likeTerm(q));
      order = `(${HYMNAL_MATCH(num.abbr)}) DESC, ${order}`;
      orderParams.push(...np);
    } else {
      where.push(words);
      params.push(likeTerm(q));
    }
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  return songs.list(where.join(' AND '), [...params, ...orderParams], `${order} LIMIT ${Number(limit)}`);
}

export function searchTexts(q = '', category?: string, limit = 5000) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q) {
    where.push(`(title || ' ' || body || ' ' || tags || ' ' || IFNULL(source,'') || ' ' || IFNULL(key,'') || ' ' || IFNULL(parts,'')) LIKE ? ESCAPE '\\'`);
    params.push(likeTerm(q));
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  return texts.list(where.join(' AND '), params, `category, json_extract(title,'$.en') COLLATE NOCASE LIMIT ${Number(limit)}`);
}

/** Expand a song's stanzas into singing order (refrain after each verse when flagged). */
export function singingOrder(song: Song, only?: string[] | null) {
  const refrain = song.stanzas.find((s) => s.label === 'R' || s.label === 'C');
  const verses = song.stanzas.filter((s) => s !== refrain && (!only || only.includes(s.label)));
  if (!song.refrain_after_each || !refrain) {
    return only ? song.stanzas.filter((s) => only.includes(s.label)) : song.stanzas;
  }
  return verses.flatMap((v) => [v, refrain]);
}

// ---------------------------------------------------------------- hymnals

export const hymnals = table<Hymnal>({
  name: 'hymnals',
  cols: ['name', 'abbr', 'publisher', 'year', 'notes', 'sort'],
  json: ['name'],
});

export function listHymnals(): (Hymnal & { song_count: number })[] {
  const rows = all<Record<string, unknown>>(
    'SELECT h.*, (SELECT COUNT(*) FROM song_hymnals sh WHERE sh.hymnal_id = h.id) AS song_count FROM hymnals h ORDER BY h.sort, h.id',
  );
  return rows.map((r) => ({ ...hymnals.decode(r)!, song_count: r.song_count as number }));
}

/** Replace all hymnal numbers of a song. */
export function setSongHymnals(songId: number, refs: { hymnal_id: number; number: string }[]): SongHymnalRef[] {
  songTable.get(songId);
  const seen = new Set<number>();
  for (const r of refs) {
    if (seen.has(r.hymnal_id)) throw new BadRequest(`hymnal ${r.hymnal_id} is listed twice — a song has one number per hymnal`);
    seen.add(r.hymnal_id);
    if (!hymnals.find(r.hymnal_id)) throw new BadRequest(`hymnal ${r.hymnal_id} not found`);
    if (!r.number.trim()) throw new BadRequest('number is required');
  }
  tx(() => {
    run('DELETE FROM song_hymnals WHERE song_id = ?', songId);
    for (const r of refs) run('INSERT INTO song_hymnals (song_id, hymnal_id, number) VALUES (?, ?, ?)', songId, r.hymnal_id, r.number.trim());
  });
  return songs.get(songId).hymnals ?? [];
}

/** Songs in a hymnal, ordered by number (2 < 10 < 10a). */
export function hymnalSongs(hymnalId: number): (Song & { number: string })[] {
  hymnals.get(hymnalId);
  const nums = new Map(all<{ song_id: number; number: string }>('SELECT song_id, number FROM song_hymnals WHERE hymnal_id = ?', hymnalId).map((r) => [r.song_id, r.number]));
  return songs
    .list('id IN (SELECT song_id FROM song_hymnals WHERE hymnal_id = ?)', [hymnalId])
    .map((s) => ({ ...s, number: nums.get(s.id)! }))
    .sort((a, b) => compareHymnNumbers(a.number, b.number));
}

/** Find songs by hymnal number, optionally limited to one hymnal abbreviation. */
export function findByNumber(number: string, abbr?: string) {
  const rows = all<{ song_id: number; abbr: string; number: string; hymnal_id: number }>(
    `SELECT sh.song_id, h.abbr, sh.number, h.id AS hymnal_id FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id
     WHERE sh.number = ? COLLATE NOCASE ${abbr ? 'AND h.abbr = ? COLLATE NOCASE' : ''} ORDER BY h.sort, h.id`,
    number.trim(), ...(abbr ? [abbr.trim()] : []),
  );
  const by = new Map(songs.list(`id IN (${rows.map(() => '?').join(',') || 'NULL'})`, rows.map((r) => r.song_id)).map((s) => [s.id, s]));
  return rows.map((r) => ({ ...r, song: by.get(r.song_id)! })).filter((r) => r.song);
}

// The hymnal index CSV import (numbers + titles) lives in server/csv/library.ts (entity hymnal_index).

// ---------------------------------------------------------------- long texts in parts

/** Many-part texts (catechisms, confessions) must be used with an explicit selection. */
export const MANY_PARTS = 12;

/** The parts a service item selects: `labels` in text order, or all parts when null. */
export function selectParts(t: LiturgyText, labels: string[] | null | undefined): TextPart[] {
  const parts = t.parts ?? [];
  if (!labels) return parts;
  const want = new Set(labels);
  return parts.filter((p) => want.has(p.label));
}

/** A text without its (possibly long) parts list: part count and label range instead. Used by MCP. */
export function textOverview(t: LiturgyText) {
  if (!t.parts?.length) return t;
  const labels = t.parts.map((p) => p.label);
  return {
    ...t,
    parts: undefined,
    part_count: t.parts.length,
    part_labels: partRuns(labels, labels).join(', '),
    hint: 'Read parts with canon_get_text_parts; select them in a service item with stanzas = labels.',
  };
}

// ---------------------------------------------------------------- Westminster Standards import

const STANDARDS_URL = 'https://raw.githubusercontent.com/NonlinearFruit/Creeds.json/master/creeds/';
export const STANDARDS_DIR = path.join(config.root, 'data', 'standards-src');
const SOURCE = 'Westminster Assembly (1647), via Creeds.json';

interface StandardDef {
  key: 'wsc' | 'wlc' | 'wcf';
  file: string;
  category: TextCategory;
  title: L10n;
  tags: string[];
}
export const STANDARDS: StandardDef[] = [
  {
    key: 'wsc', file: 'westminster_shorter_catechism.json', category: 'catechism',
    title: { en: 'Westminster Shorter Catechism', zh: '威斯敏斯德小要理问答' }, tags: ['catechism', 'westminster', 'responsive'],
  },
  {
    key: 'wlc', file: 'westminster_larger_catechism.json', category: 'catechism',
    title: { en: 'Westminster Larger Catechism', zh: '威斯敏斯德大要理问答' }, tags: ['catechism', 'westminster', 'responsive'],
  },
  {
    key: 'wcf', file: 'westminster_confession_of_faith.json', category: 'creed',
    title: { en: 'Westminster Confession of Faith', zh: '威斯敏斯德信条' }, tags: ['confession-of-faith', 'westminster'],
  },
];

type CreedsJson =
  | { Data: { Number: number; Question: string; Answer: string }[] }
  | { Data: { Chapter: string; Title: string; Sections: { Section: string; Content: string }[] }[] };

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Convert a Creeds.json file into text parts: Q&A as "L: question / C: answer", confession sections as "I.1". */
export function standardParts(json: CreedsJson): TextPart[] {
  const data = json.Data as Record<string, unknown>[];
  if (!Array.isArray(data) || !data.length) throw new Error('unexpected Creeds.json format (no Data)');
  if ('Question' in data[0]) {
    return (json.Data as { Number: number; Question: string; Answer: string }[]).map((q) => ({
      label: String(q.Number),
      body: { en: `L: ${clean(q.Question)}\nC: ${clean(q.Answer)}` },
    }));
  }
  if ('Sections' in data[0]) {
    return (json.Data as { Chapter: string; Title: string; Sections: { Section: string; Content: string }[] }[]).flatMap((ch) =>
      ch.Sections.map((s) => ({
        label: `${toRoman(Number(ch.Chapter))}.${s.Section}`,
        title: { en: clean(ch.Title) },
        body: { en: clean(s.Content) },
      })),
    );
  }
  throw new Error('unexpected Creeds.json format');
}

async function loadStandard(file: string, log: (s: string) => void): Promise<CreedsJson> {
  fs.mkdirSync(STANDARDS_DIR, { recursive: true });
  const dest = path.join(STANDARDS_DIR, file);
  if (!fs.existsSync(dest)) {
    log(`Downloading ${file} …`);
    const res = await fetch(STANDARDS_URL + file);
    if (!res.ok) throw new Error(`Download of ${file} failed (${res.status})`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(dest, 'utf8').replace(/^﻿/, '')) as CreedsJson;
}

/**
 * Import the Westminster Shorter / Larger Catechism and Confession of Faith (public domain, English) as
 * texts with parts, keys 'wsc', 'wlc', 'wcf'. Source files are cached in data/standards-src/.
 * Idempotent: an existing text is left alone (church edits kept) unless `force`, or unless it has no parts.
 */
export async function importStandards(opts: { force?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const result: { key: string; id: number; parts: number; action: 'added' | 'updated' | 'kept' }[] = [];
  for (const def of STANDARDS) {
    const parts = standardParts(await loadStandard(def.file, log));
    const row = { key: def.key, category: def.category, title: def.title, body: {}, source: SOURCE, tags: def.tags, public_domain: true, parts };
    const existing = get<{ id: number; parts: string | null }>('SELECT id, parts FROM texts WHERE key = ?', def.key);
    if (!existing) {
      const t = texts.insert(row);
      result.push({ key: def.key, id: t.id, parts: parts.length, action: 'added' });
    } else if (opts.force || !existing.parts || existing.parts === '[]' || existing.parts === 'null') {
      texts.update(existing.id, row);
      result.push({ key: def.key, id: existing.id, parts: parts.length, action: 'updated' });
    } else {
      result.push({ key: def.key, id: existing.id, parts: (JSON.parse(existing.parts) as unknown[]).length, action: 'kept' });
    }
    log(`${def.key}: ${parts.length} parts (${result[result.length - 1].action})`);
  }
  return result;
}

/** Which Westminster Standards are in the library. */
export function standardsStatus() {
  return STANDARDS.map((d) => ({ key: d.key, title: d.title, id: get<{ id: number }>('SELECT id FROM texts WHERE key = ?', d.key)?.id ?? null }));
}

