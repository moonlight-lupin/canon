// Melodies (0.21.0): a song's melody in numbered notation (jianpu), typed by the church's musicians in jpFun's notation
// (https://github.com/madderscientist/jpFun) and drawn in the browser — in the song's editor and on Outputs → Sheet
// music. Only the source text is kept here. Like sheet music it is for the musicians inside Canon: it is not a column
// of songs, so canon_save_song / canon_get_library_item never see it; AI assistants read and write it only through
// canon_melody / canon_save_melody, when the administrator shares melodies (server/mcp-tools/melodies.ts).
import type { L10n } from '../../shared/types.ts';
import { all, get, run } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { logChange } from './changelog.ts';

export const MAX_MELODY_CHARS = 50_000;

export const melodyFor = (songId: number): string | null =>
  get<{ source: string }>('SELECT source FROM song_melodies WHERE song_id = ?', songId)?.source ?? null;

/** Save a song's melody; an empty one removes it. Returns what is kept. */
export function setMelody(songId: number, source: string): string | null {
  const song = get<{ title: string }>('SELECT title FROM songs WHERE id = ?', songId);
  if (!song) throw new NotFound('That song does not exist.');
  const text = source.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (text.length > MAX_MELODY_CHARS) throw new BadRequest(`A melody can be up to ${MAX_MELODY_CHARS.toLocaleString('en')} characters.`);
  const before = melodyFor(songId);
  if (text === (before ?? '')) return before;
  if (text) {
    run(`INSERT INTO song_melodies (song_id, source) VALUES (?, ?)
         ON CONFLICT (song_id) DO UPDATE SET source = excluded.source, updated_at = datetime('now')`, songId, text);
  } else {
    run('DELETE FROM song_melodies WHERE song_id = ?', songId);
  }
  const title = JSON.parse(song.title || '{}') as L10n;
  logChange({ entity: 'songs', entity_id: songId, action: 'update', before: { title, melody: before ?? '' }, after: { title, melody: text } });
  return text || null;
}

/** The songs that have a melody (for the Library list). */
export const melodySongIds = (): number[] => all<{ song_id: number }>('SELECT song_id FROM song_melodies ORDER BY song_id').map((r) => r.song_id);
