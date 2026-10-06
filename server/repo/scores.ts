// Sheet music (0.15.2): scanned pages or photos of a song's music, kept with the song in the Library (PNG, JPEG, WebP
// or PDF, up to 10 MB each, in the order they were added). The files are in the assets table (key 'score-<id>'), so
// backups include them. They are for the church's musicians inside Canon: never on share pages, slides or AI tools.
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
