// MCP tool for songs' sheet music (0.15.3): only when the administrator shares it (Settings → AI / MCP → Library →
// Sheet music, off by default — the pages become copies at the AI provider). Lists a service's songs in order with
// their pages, or one song's, and can return the pictures (scans / photos) for the assistant to read. PDFs are not
// sent: the assistant gets the page in Canon where musicians open them.
import { z } from 'zod';
import { InputError } from './common.ts';
import { Id, RO, WithImages, canRead, type ToolDef } from './common.ts';
import * as sc from '../repo/scores.ts';
import { get } from '../db.ts';

/** Pictures larger than this are not sent (the assistant gets the page in Canon instead). */
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_IMAGES = 6;

export const SCORE_TOOLS: ToolDef[] = [
  {
    name: 'canon_sheet_music', module: 'library', access: 'read', requiresScores: true, title: 'Sheet music', annotations: RO,
    description: 'Songs\' sheet music (scans or photos kept with each song in the Library). With service_id: the service\'s songs in order, the stanzas sung and each song\'s pages; with song_id: that song\'s pages. pictures: true also returns the image pages (at most 6; PDFs and very large scans are listed with a link to open them in Canon) so you can read the music: key, range, time signature, tune. Never copy or retype the music for anyone. Example: {"service_id":12,"pictures":true}.',
    input: {
      service_id: Id.optional(),
      song_id: Id.optional(),
      pictures: z.boolean().default(false),
    },
    handler: (a, ctx) => {
      if (!a.service_id === !a.song_id) throw new InputError('Give service_id or song_id.');
      const pageOf = (f: sc.SongScore, i: number) => ({ id: f.id, page: i + 1, name: f.name, type: f.mime === 'application/pdf' ? 'pdf' : 'image', size_kb: Math.round(f.size / 1024) });
      let songs: { song_id: number; title: unknown; start?: string; stanzas?: string[]; pages: ReturnType<typeof pageOf>[] }[];
      let open: string | undefined;
      if (a.service_id) {
        if (!canRead(ctx, 'services')) throw new InputError('Services are not shared on this connection.');
        const r = sc.serviceScores(a.service_id);
        songs = r.songs.map((s) => ({ song_id: s.song.id, title: s.title, start: s.start, stanzas: s.stanzas, pages: s.scores.map(pageOf) }));
        open = ctx.base ? `${ctx.base}/services/${a.service_id}/sheet-music` : undefined;
      } else {
        const title = get<{ title: string }>('SELECT title FROM songs WHERE id = ?', a.song_id);
        if (!title) throw new InputError(`song ${a.song_id} not found`);
        songs = [{ song_id: a.song_id, title: JSON.parse(title.title), pages: sc.scoresFor(a.song_id).map(pageOf) }];
      }
      const data = { songs, ...(open ? { open_in_canon: open } : {}), without_sheet_music: songs.filter((s) => !s.pages.length).length };
      if (!a.pictures) return data;
      const images: { mime: string; base64: string }[] = [];
      const sent: number[] = [];
      for (const s of songs) {
        for (const p of s.pages) {
          if (p.type !== 'image' || images.length >= MAX_IMAGES || p.size_kb * 1024 > MAX_IMAGE_BYTES) continue;
          const { score, data: buf } = sc.scoreData(p.id);
          images.push({ mime: score.mime, base64: buf.toString('base64') });
          sent.push(p.id);
        }
      }
      return new WithImages({ ...data, pictures: sent.length ? `${sent.length} picture(s) follow, in the order of the pages listed (ids ${sent.join(', ')})` : 'no pictures to send (only PDFs or very large scans: open them in Canon)' }, images);
    },
  },
];
