// MCP tools for songs' melodies in numbered notation (0.21.0): only when the administrator shares them (Settings → AI /
// MCP → Library → Melodies: public-domain songs, or every song when the church's licence lets it copy or arrange the
// music). The melody is jpFun source text (notation: docs/JIANPU-NOTATION.md, the resource canon://guide/jianpu);
// it is checked here before it is saved, and a melody a musician typed is replaced only when asked to.
import { z } from 'zod';
import { get } from '../db.ts';
import { checkJianpu } from '../lib/jianpu-check.ts';
import { MAX_MELODY_CHARS, melodyFor, setMelody } from '../repo/melodies.ts';
import { Id, InputError, RO, WRITE, type Ctx, type ToolDef } from './common.ts';

const Source = z.string().max(MAX_MELODY_CHARS);

/** The song, if this connection may read and write its melody (else a clear refusal). */
function allowedSong(songId: number, ctx: Ctx) {
  const s = get<{ title: string; public_domain: number }>('SELECT title, public_domain FROM songs WHERE id = ?', songId);
  if (!s) throw new InputError(`song ${songId} not found`);
  const mode = ctx.melodies ?? 'off';
  if (mode === 'off') throw new InputError('Melodies are not shared on this connection.');
  if (mode === 'public_domain' && !s.public_domain) {
    throw new InputError('This song is not marked public domain, and the administrator shares only public-domain songs’ melodies (Settings → AI / MCP → Library → Melodies). Leave this one to the church’s musicians.');
  }
  return { title: JSON.parse(s.title || '{}') as Record<string, string>, public_domain: !!s.public_domain };
}

export const MELODY_TOOLS: ToolDef[] = [
  {
    name: 'canon_melody', module: 'library', access: 'read', requiresMelodies: true, title: 'Melody (numbered notation)', annotations: RO,
    description: 'A song\'s melody in numbered notation (jianpu), as jpFun text (notation: resource canon://guide/jianpu). With song_id: the song\'s melody (null when it has none) and its check. With source: checks jianpu text without saving — errors and warnings by line and column, in plain English (jpfun_message is jpFun\'s own, in Chinese), and a summary (key, time signature, lines, lines of words). Check every melody before canon_save_melody. Example: {"source":"@1(G4)\\n@meter(4, 4)\\nN: { 1 2 3 1 | 5 - - - | }"}.',
    input: {
      song_id: Id.optional(),
      source: Source.optional(),
    },
    handler: async (a, ctx) => {
      if (!a.song_id === (a.source == null)) throw new InputError('Give song_id or source.');
      if (a.source != null) return { check: await checkJianpu(a.source) };
      const song = allowedSong(a.song_id, ctx);
      const source = melodyFor(a.song_id);
      return { song_id: a.song_id, title: song.title, public_domain: song.public_domain, source, ...(source ? { check: await checkJianpu(source) } : {}) };
    },
  },
  {
    name: 'canon_save_melody', module: 'library', access: 'write', requiresMelodies: true, title: 'Save a melody', annotations: WRITE,
    description: 'Save a song\'s melody in numbered notation (jianpu, jpFun text; notation: resource canon://guide/jianpu). Check it first with canon_melody {source}: a melody with errors is refused (the errors come back). A song that already has a melody (a musician\'s work) is replaced only with replace: true — ask the user first. Only songs the administrator allows (public domain, or all songs under the church\'s licence). Write one L: line of words per stanza and language. Afterwards ask the user to look at it in Library → the song → Melody in numbered notation. Example: {"song_id":12,"source":"@1(G4)\\n@meter(4, 4)\\nN: { 1 2 3 1 | 5 - - - | }"}.',
    input: {
      song_id: Id,
      source: Source,
      replace: z.boolean().default(false),
    },
    handler: async (a, ctx) => {
      const song = allowedSong(a.song_id, ctx);
      if (!a.source.trim()) throw new InputError('The melody is empty. (To remove a melody, a person clears it in the song’s editor.)');
      const check = await checkJianpu(a.source);
      if (!check.ok) throw new InputError(`The melody has errors and was not saved: ${check.problems.filter((p) => p.level === 'error').map((p) => `line ${p.line}, column ${p.column}: ${p.message}`).join('; ')}`);
      const had = melodyFor(a.song_id);
      if (had && !a.replace) throw new InputError('This song already has a melody (typed by the church’s musicians or saved before). Show the user what would change; save with replace: true only if they agree.');
      const saved = setMelody(a.song_id, a.source);
      return { song_id: a.song_id, title: song.title, saved: true, replaced: !!had, warnings: check.problems, summary: check.summary, chars: saved?.length ?? 0 };
    },
  },
];
