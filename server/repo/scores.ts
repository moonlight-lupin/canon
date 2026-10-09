// Sheet music (0.15.2): scanned pages or photos of a song's music, kept with the song in the Library (PNG, JPEG, WebP
// or PDF, up to 10 MB each, in the order they were added). The files are in the assets table (key 'score-<id>'), so
// backups include them. They are for the church's musicians inside Canon: never on share pages, slides or AI tools.
import crypto from 'node:crypto';
import type { L10n } from '../../shared/types.ts';
import { all, get, run, tx } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { renderService } from './render.ts';

export interface SongScore { id: number; song_id: number; name: string; mime: string; size: number; sort: number; created_at: string }

export const MAX_SCORE_BYTES = 10 * 1024 * 1024;
/** Files are taken for what their first bytes say, whatever their name. */
const MIME: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/webp': (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP',
  'application/pdf': (b) => b.subarray(0, 5).toString() === '%PDF-',
};

export const scoresFor = (songId: number) =>
  all<SongScore>('SELECT * FROM song_scores WHERE song_id = ? ORDER BY sort, id', songId);

export function addScore(songId: number, f: { name: string; mime: string; data: Buffer }): SongScore[] {
  if (!get('SELECT 1 FROM songs WHERE id = ?', songId)) throw new NotFound('That song does not exist.');
  const check = MIME[f.mime];
  if (!check) throw new BadRequest('Scans and photos (PNG, JPEG, WebP) and PDF files only.');
  if (f.data.length > MAX_SCORE_BYTES) throw Object.assign(new Error('The file is larger than 10 MB.'), { status: 413 });
  if (!check(f.data)) throw new BadRequest('The file is not what its name says.');
  const name = (f.name || 'sheet music').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  tx(() => {
    const sort = (get<{ n: number | null }>('SELECT MAX(sort) AS n FROM song_scores WHERE song_id = ?', songId)?.n ?? -1) + 1;
    const r = get<{ id: number }>('INSERT INTO song_scores (song_id, name, mime, size, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', songId, name, f.mime, f.data.length, sort)!;
    run("INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))", `score-${r.id}`, f.mime, f.data);
  });
  return scoresFor(songId);
}

export function scoreData(id: number) {
  const s = get<SongScore>('SELECT * FROM song_scores WHERE id = ?', id);
  const a = s && get<{ data: Uint8Array }>('SELECT data FROM assets WHERE key = ?', `score-${id}`);
  if (!s || !a) throw new NotFound('That sheet music is not there any more.');
  return { score: s, data: Buffer.from(a.data) };
}

/** Move a page up or down among the song's sheet music. */
export function moveScore(id: number, by: -1 | 1): SongScore[] {
  const s = get<SongScore>('SELECT * FROM song_scores WHERE id = ?', id);
  if (!s) throw new NotFound('That sheet music is not there any more.');
  const list = scoresFor(s.song_id);
  const i = list.findIndex((x) => x.id === id);
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  tx(() => list.forEach((x, k) => run('UPDATE song_scores SET sort = ? WHERE id = ?', k, x.id)));
  return scoresFor(s.song_id);
}

export function removeScore(id: number): SongScore[] {
  const s = get<SongScore>('SELECT * FROM song_scores WHERE id = ?', id);
  if (!s) throw new NotFound('That sheet music is not there any more.');
  // the trigger on song_scores removes the file from assets as well
  run('DELETE FROM song_scores WHERE id = ?', id);
  return scoresFor(s.song_id);
}

/** How many sheet-music files each song has (for the Library list). */
export const scoreCounts = () => Object.fromEntries(all<{ song_id: number; n: number }>('SELECT song_id, COUNT(*) AS n FROM song_scores GROUP BY song_id').map((r) => [r.song_id, r.n]));

/** The songs of a service in order, each with its sheet music (none = the musicians know to bring their own). */
export function serviceScores(serviceId: number) {
  const r = renderService(serviceId);
  return {
    service: { id: r.id, date: r.date, title: r.title, languages: r.languages, status: r.status },
    songs: r.items.filter((it) => it.song).map((it) => ({
      item_id: it.id,
      start: it.start,
      title: it.title as L10n,
      subtitle: it.subtitle as L10n,
      song: { id: it.song!.id, title: it.song!.title as L10n },
      // the stanzas sung (as numbered in the hymnal), refrains left out
      stanzas: [...new Set(it.song!.stanzas.map((s) => s.label).filter((l) => /^\d+$/.test(l)))],
      scores: scoresFor(it.song!.id),
    })),
  };
}

// ---------------------------------------------------------------- upload links (0.15.5)

/** Pages one link may add, and how long links last (hours). */
export const MAX_LINK_UPLOADS = 30;
export const MAX_LINK_HOURS = 72;

const songTitle = (songId: number) => {
  const r = get<{ title: string }>('SELECT title FROM songs WHERE id = ?', songId);
  if (!r) throw new NotFound('That song does not exist.');
  return JSON.parse(r.title || '{}') as L10n;
};
const songNumbers = (songId: number) =>
  all<{ abbr: string; number: string }>('SELECT h.abbr, sh.number FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id WHERE sh.song_id = ? ORDER BY h.sort, h.id', songId).map((r) => `${r.abbr} ${r.number}`);

/** A link to add a song's sheet music from a phone, without signing in, for `hours` hours. */
export function createUploadLink(songId: number, hours = 24, userId: number | null = null) {
  songTitle(songId);
  if (!(hours >= 1 && hours <= MAX_LINK_HOURS)) throw new BadRequest(`Links last 1 to ${MAX_LINK_HOURS} hours.`);
  run("DELETE FROM upload_links WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  const token = crypto.randomBytes(18).toString('base64url');
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  run('INSERT INTO upload_links (token, song_id, user_id, expires_at) VALUES (?, ?, ?, ?)', token, songId, userId, expires);
  return { token, expires_at: expires };
}

function linkRow(token: string) {
  const r = /^[\w-]{10,60}$/.test(token) ? get<{ song_id: number; expires_at: string; uploads: number }>('SELECT song_id, expires_at, uploads FROM upload_links WHERE token = ?', token) : undefined;
  if (!r || r.expires_at < new Date().toISOString()) throw new NotFound('This upload link has expired or does not exist. Ask for a new one.');
  return r;
}

/** What the upload page shows: the song, its numbers, the pages it has, and how many more this link takes. */
export function uploadLinkInfo(token: string) {
  const r = linkRow(token);
  return { title: songTitle(r.song_id), numbers: songNumbers(r.song_id), pages: scoresFor(r.song_id).length, expires_at: r.expires_at, left: MAX_LINK_UPLOADS - r.uploads };
}

/** Add one page through a link (appended after the song's pages). */
export function uploadViaLink(token: string, f: { name: string; mime: string; data: Buffer }) {
  const r = linkRow(token);
  if (r.uploads >= MAX_LINK_UPLOADS) throw Object.assign(new Error(`This link has taken its ${MAX_LINK_UPLOADS} pages. Ask for a new one.`), { status: 409 });
  const list = addScore(r.song_id, f);
  run('UPDATE upload_links SET uploads = uploads + 1 WHERE token = ?', token);
  return { pages: list.length, left: MAX_LINK_UPLOADS - r.uploads - 1 };
}

/** Songs by hymnal number ("HP 178", "178"), for the bulk upload and AI assistants. */
export function songsByNumber(): { song_id: number; abbr: string; number: string }[] {
  return all<{ song_id: number; abbr: string; number: string }>('SELECT sh.song_id, h.abbr, sh.number FROM song_hymnals sh JOIN hymnals h ON h.id = sh.hymnal_id ORDER BY h.sort, h.id');
}
