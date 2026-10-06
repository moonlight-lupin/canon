// MCP tool for songs' sheet music (0.15.3): only when the administrator shares it (Settings → AI / MCP → Library →
// Sheet music, off by default — the pages become copies at the AI provider). Lists a service's songs in order with
// their pages, or one song's, and can return the pictures (scans / photos) for the assistant to read. PDFs are not
// sent: the assistant gets the page in Canon where musicians open them.
import { z } from 'zod';
import { InputError } from './common.ts';
import { Id, RO, WRITE, WithImages, canRead, type ToolDef } from './common.ts';
import { addressForOthers } from '../lib/lan.ts';
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
  {
    name: 'canon_sheet_music_upload_link', module: 'library', access: 'write', title: 'Sheet music upload link', annotations: WRITE,
    description: 'A short-lived link (default 24 hours, max 72) to add a song’s sheet music from a phone or computer without signing in: the person opens it, takes photos or picks scans / PDFs, and they are added to that song in page order. You cannot upload files yourself through this connector — give the user this link instead. Name the song by song_id or hymnal number (e.g. "HP 178"; a bare number uses the first hymnal that has it). Give the link only to the user who asked. Example: {"number":"HP 178"}.',
    input: {
      song_id: Id.optional(),
      number: z.string().max(30).optional(),
      hours: z.number().int().min(1).max(sc.MAX_LINK_HOURS).default(24),
    },
    handler: (a, ctx) => {
      let songId = a.song_id as number | undefined;
      if (!songId && a.number) {
        const m = String(a.number).trim().match(/^([A-Za-z一-鿿]*)\s*#?\s*(\w+)$/);
        if (!m) throw new InputError('Give the number like "HP 178" or "178".');
        const all = sc.songsByNumber();
        const hit = all.find((x) => x.number.toLowerCase() === m[2].toLowerCase() && (!m[1] || x.abbr.toLowerCase() === m[1].toLowerCase()));
        if (!hit) throw new InputError(`No song has the number ${a.number}.`);
        songId = hit.song_id;
      }
      if (!songId) throw new InputError('Give song_id or number.');
      const l = sc.createUploadLink(songId, a.hours, ctx.auth.user.id);
      const info = sc.uploadLinkInfo(l.token);
      return {
        song: { id: songId, title: info.title, numbers: info.numbers, pages_now: info.pages },
        url: `${addressForOthers(ctx.base)}/upload/${l.token}`,
        expires_at: l.expires_at,
        up_to_pages: info.left,
        note: 'Anyone with this link can add pages to this song until it expires; share it only with the user.',
      };
    },
  },
];
