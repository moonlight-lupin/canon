// The library as one file (0.15.6, Settings → Export data): hymnals, songs with their words, hymnal numbers and sheet
// music, liturgical texts, QR codes & notes, slide backgrounds and (when chosen) the Bibles the church uploaded — or
// one section of it (0.15.7: one hymnal's songs, the texts, one Bible, the QR codes & notes, the backgrounds) — gzip-compressed JSON
// (".canonlib"). Another Canon imports it and adds what it doesn't have yet: songs and texts match by key, else by
// title; hymnals by abbreviation; blocks by name; Bibles by code. Nothing already there is changed, except that an
// existing song gains hymnal numbers and sheet music it doesn't have.
import zlib from 'node:zlib';
import type { L10n, Song } from '../../shared/types.ts';
import { blockImageKey } from '../../shared/presentation.ts';
import { all, db, get, tx } from '../db.ts';
import { BadRequest } from '../lib/table.ts';
import * as lib from './library.ts';
import { addScore, scoreData, scoresFor } from './scores.ts';
import { createBlock, listBlocks, setBlockImage } from './presentation.ts';
import { backgroundKey, backgroundByName, backgrounds as bgTable, saveBackground } from './backgrounds.ts';

export const LIBRARY_FORMAT = 'canon-library';
const VERSION = 1;

interface FileBlob { mime: string; data: string }
interface LibraryFile {
  format: string;
  version: number;
  exported_at: string;
  hymnals: { abbr: string; name: L10n; publisher: string | null; year: number | null; notes: string | null; sort: number }[];
  songs: (Omit<Song, 'id' | 'hymnals'> & { numbers: { abbr: string; number: string }[]; scores?: (FileBlob & { name: string })[] })[];
  texts: Record<string, unknown>[];
  blocks?: { name: string; kind: string; data: Record<string, unknown>; image?: FileBlob }[];
  backgrounds?: { name: string; image: FileBlob }[];
  bibles?: { code: string; lang: string; name: string; license: string; notes: string | null; edition: string | null; rights: string; verses: [number, number, number, string][] }[];
}

export type LibrarySection = 'songs' | 'texts' | 'blocks' | 'backgrounds' | 'bibles';
export interface ExportOptions {
  scores?: boolean;
  blocks?: boolean;
  bibles?: boolean;
  backgrounds?: boolean;
  /** only these sections (default: the whole library, as the flags above say) */
  sections?: LibrarySection[];
  /** songs: only one hymnal's (an id), or 'none' = the songs in no hymnal */
  hymnal?: number | 'none';
  /** bibles: only this uploaded Bible */
  bible?: string;
}

/** The library file (gzip-compressed JSON). */
export function exportLibrary(o: ExportOptions = {}): Buffer {
  const want = (s: LibrarySection, dflt: boolean) => (o.sections ? o.sections.includes(s) : dflt);
  const hymnalRows = lib.hymnals.list('', [], 'sort, id');
  const abbrOf = new Map(hymnalRows.map((h) => [h.id, h.abbr]));
  // songs: all, one hymnal's, or those in no hymnal
  const songRows = want('songs', true)
    ? lib.songs.list('', [], 'id').filter((s) => o.hymnal == null ? true : o.hymnal === 'none' ? !(s.hymnals ?? []).length : (s.hymnals ?? []).some((r) => r.hymnal_id === o.hymnal))
    : [];
  const usedHymnals = new Set(songRows.flatMap((s) => (s.hymnals ?? []).map((r) => r.hymnal_id)));
  const file: LibraryFile = {
    format: LIBRARY_FORMAT,
    version: VERSION,
    exported_at: new Date().toISOString(),
    hymnals: hymnalRows.filter((h) => o.hymnal == null && !o.sections ? true : usedHymnals.has(h.id) || h.id === o.hymnal)
      .map((h) => ({ abbr: h.abbr, name: h.name, publisher: h.publisher ?? null, year: h.year ?? null, notes: h.notes ?? null, sort: h.sort })),
    songs: songRows.map((s) => {
      const { id, hymnals, ...rest } = s;
      return {
        ...rest,
        numbers: (hymnals ?? []).map((r) => ({ abbr: abbrOf.get(r.hymnal_id) ?? r.abbr, number: r.number })),
        ...(o.scores !== false ? { scores: scoresFor(id).map((f) => ({ name: f.name, mime: f.mime, data: scoreData(f.id).data.toString('base64') })) } : {}),
      };
    }),
    texts: want('texts', true) ? lib.texts.list('', [], 'id').map(({ id: _id, ...t }) => t as Record<string, unknown>) : [],
  };
  if (want('blocks', o.blocks !== false)) {
    file.blocks = listBlocks().map((b) => {
      const img = b.kind === 'image' ? get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', blockImageKey(b.id)) : undefined;
      const { image: _v, ...data } = b.data as Record<string, unknown>;
      return { name: b.name, kind: b.kind, data, ...(img ? { image: { mime: img.mime, data: Buffer.from(img.data).toString('base64') } } : {}) };
    });
  }
  if (want('backgrounds', o.backgrounds !== false)) {
    file.backgrounds = bgTable.list('', [], 'name COLLATE NOCASE, id').map((b) => {
      const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', backgroundKey(b.id));
      return a ? { name: b.name, image: { mime: a.mime, data: Buffer.from(a.data).toString('base64') } } : null;
    }).filter((x): x is NonNullable<typeof x> => !!x);
  }
  if (want('bibles', !!o.bibles)) {
    file.bibles = all<{ code: string; lang: string; name: string; license: string; notes: string | null; edition: string | null; rights: string }>(
      `SELECT code, lang, name, license, notes, edition, rights FROM bible_translations WHERE source = 'upload'${o.bible ? ' AND code = ?' : ''} ORDER BY code`,
      ...(o.bible ? [o.bible] : []),
    ).map((b) => ({
      ...b,
      verses: all<{ book: number; chapter: number; verse: number; text: string }>('SELECT book, chapter, verse, text FROM bible_verses WHERE translation = ? ORDER BY book, chapter, verse', b.code)
        .map((v) => [v.book, v.chapter, v.verse, v.text] as [number, number, number, string]),
    }));
  }
  return zlib.gzipSync(Buffer.from(JSON.stringify(file), 'utf8'));
}

function readFile(buf: Buffer): LibraryFile {
  let json: string;
  try {
    // a library file unpacks to a few MB; a file that would unpack to more than 200 MB is not one (a "zip bomb")
    json = (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf, { maxOutputLength: 200 * 1024 * 1024 }) : buf).toString('utf8');
  } catch {
    throw new BadRequest('This is not a Canon library file.');
  }
  let f: LibraryFile;
  try {
    f = JSON.parse(json) as LibraryFile;
  } catch {
    throw new BadRequest('This is not a Canon library file.');
  }
  if (f?.format !== LIBRARY_FORMAT || !Array.isArray(f.songs ?? []) || !Array.isArray(f.texts ?? [])) throw new BadRequest('This is not a Canon library file.');
  if (f.version > VERSION) throw new BadRequest('This library file comes from a newer Canon. Update Canon first.');
  return f;
}

export interface ImportSummary {
  hymnals: { added: number; existing: number };
  songs: { added: number; existing: number; numbers_added: number; sheet_music_added: number };
  texts: { added: number; existing: number };
  blocks: { added: number; existing: number };
  backgrounds: { added: number; existing: number };
  bibles: { added: number; existing: number; skipped: number };
  problems: string[];
}

const titleKey = (t: L10n | undefined) => [t?.en, t?.zh, ...Object.values(t ?? {})].map((x) => x?.trim().toLowerCase()).find(Boolean) ?? '';

/**
 * Add what this Canon doesn't have from a library file. `dryRun` counts without saving. Bibles are added only with
 * `biblePermission` (the church may use them: the same confirmation as uploading one).
 */
export function importLibrary(buf: Buffer, o: { dryRun?: boolean; biblePermission?: boolean } = {}): ImportSummary {
  const f = readFile(buf);
  const sum: ImportSummary = {
    hymnals: { added: 0, existing: 0 }, songs: { added: 0, existing: 0, numbers_added: 0, sheet_music_added: 0 },
    texts: { added: 0, existing: 0 }, blocks: { added: 0, existing: 0 }, backgrounds: { added: 0, existing: 0 }, bibles: { added: 0, existing: 0, skipped: 0 }, problems: [],
  };
  const run = () => {
    // hymnals by abbreviation
    const hymnalId = new Map<string, number>();
    for (const h of lib.hymnals.list()) hymnalId.set(h.abbr.toUpperCase(), h.id);
    for (const h of f.hymnals ?? []) {
      const k = String(h.abbr ?? '').toUpperCase();
      if (!k) continue;
      if (hymnalId.has(k)) sum.hymnals.existing++;
      else {
        hymnalId.set(k, o.dryRun ? -1 : lib.hymnals.insert({ name: h.name ?? { en: h.abbr }, abbr: h.abbr, publisher: h.publisher ?? null, year: h.year ?? null, notes: h.notes ?? null, sort: h.sort ?? 0 } as never).id);
        sum.hymnals.added++;
      }
    }
    // songs by key, else by title
    const existing = lib.songs.list('', [], 'id');
    const byKey = new Map(existing.filter((s) => s.key).map((s) => [s.key!, s]));
    const byTitle = new Map(existing.map((s) => [titleKey(s.title), s]));
    for (const s of f.songs ?? []) {
      const { numbers, scores, ...fields } = s;
      const cur = (s.key && byKey.get(s.key)) || byTitle.get(titleKey(s.title));
      let songId: number;
      let hadScores = false;
      if (cur) {
        sum.songs.existing++;
        songId = cur.id;
        hadScores = scoresFor(cur.id).length > 0;
      } else {
        sum.songs.added++;
        if (o.dryRun) continue;
        songId = lib.songs.insert(fields as never).id;
      }
      // hymnal numbers it doesn't have yet (one per hymnal)
      const have = cur?.hymnals ?? [];
      const add = (numbers ?? []).map((n) => ({ hymnal_id: hymnalId.get(String(n.abbr).toUpperCase()), number: n.number }))
        .filter((n): n is { hymnal_id: number; number: string } => !!n.hymnal_id && !have.some((h) => h.hymnal_id === n.hymnal_id));
      if (add.length) {
        sum.songs.numbers_added += add.length;
        if (!o.dryRun) lib.setSongHymnals(songId, [...have.map((h) => ({ hymnal_id: h.hymnal_id, number: h.number })), ...add]);
      }
      // sheet music, when the song has none here
      if (scores?.length && !hadScores) {
        sum.songs.sheet_music_added += scores.length;
        if (!o.dryRun) {
          for (const p of scores) {
            try {
              addScore(songId, { name: p.name, mime: p.mime, data: Buffer.from(p.data, 'base64') });
            } catch (e) {
              sum.problems.push(`${titleKey(s.title)}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
    // texts by key, else by title
    const texts = lib.texts.list('', [], 'id');
    const tKey = new Set(texts.map((t) => t.key).filter(Boolean));
    const tTitle = new Set(texts.map((t) => titleKey(t.title)));
    for (const t of f.texts ?? []) {
      if ((t.key && tKey.has(t.key as string)) || tTitle.has(titleKey(t.title as L10n))) sum.texts.existing++;
      else {
        sum.texts.added++;
        if (!o.dryRun) lib.texts.insert(t as never);
      }
    }
    // QR codes, pictures and notes by name
    const blockNames = new Set(listBlocks().map((b) => b.name));
    for (const b of f.blocks ?? []) {
      if (blockNames.has(b.name)) sum.blocks.existing++;
      else {
        sum.blocks.added++;
        if (o.dryRun) continue;
        try {
          const made = createBlock({ name: b.name, kind: b.kind, data: b.data } as never);
          if (b.image) setBlockImage(made.id, b.image.mime, Buffer.from(b.image.data, 'base64'));
        } catch (e) {
          sum.problems.push(`${b.name}: ${(e as Error).message}`);
        }
      }
    }
    // slide backgrounds by name
    for (const b of f.backgrounds ?? []) {
      if (backgroundByName(b.name)) sum.backgrounds.existing++;
      else {
        sum.backgrounds.added++;
        if (o.dryRun) continue;
        try {
          saveBackground(null, b.name, b.image.mime, Buffer.from(b.image.data, 'base64'));
        } catch (e) {
          sum.problems.push(`${b.name}: ${(e as Error).message}`);
        }
      }
    }
    // uploaded Bibles by code, only with the church's confirmation that it may use them
    for (const b of f.bibles ?? []) {
      if (get('SELECT 1 FROM bible_translations WHERE code = ?', b.code)) sum.bibles.existing++;
      else if (!o.biblePermission) sum.bibles.skipped++;
      else {
        sum.bibles.added++;
        if (o.dryRun) continue;
        db.prepare('INSERT INTO bible_translations (code, lang, name, license, source, notes, created_at, edition, rights) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(b.code, b.lang, b.name, b.license, 'upload', b.notes ?? null, new Date().toISOString(), b.edition ?? null, b.rights);
        const ins = db.prepare('INSERT INTO bible_verses (translation, book, chapter, verse, text) VALUES (?,?,?,?,?)');
        for (const [book, chapter, verse, text] of b.verses) ins.run(b.code, book, chapter, verse, text);
      }
    }
  };
  if (o.dryRun) run();
  else tx(run);
  return sum;
}
