// Seeding on every start: the default volunteer teams / roles and the built-in slide and bulletin designs.
// Canon's bundled public-domain library (hymns, liturgical texts, service templates) is optional: the first
// administrator chooses it while setting up (or later, Library → Canon's library), installLibrary() adds it, and
// later starts add only the items an update brings to the parts the church chose.
// Library items are matched by `key` and never overwrite the church's edits. Each key is offered once (meta
// seed_offered), so an item the church deletes stays deleted unless it asks for it back (restore).
import type { L10n } from '../../shared/types.ts';
import { get, run, tx } from '../db.ts';
import { songs, texts } from '../repo/library.ts';
import { templates } from '../repo/services.ts';
import { roles } from '../repo/volunteers.ts';
import { createTeam } from '../repo/groups.ts';
import { getMeta, setMeta } from '../repo/settings.ts';

const DEFAULT_TEAMS: { name: L10n; color: string; roles: { name: L10n; needed: number }[] }[] = [
  {
    name: { en: 'Pulpit & Liturgy', zh: '讲台与礼仪' },
    color: '#7c3aed',
    roles: [
      { name: { en: 'Preacher', zh: '讲员' }, needed: 1 },
      { name: { en: 'Liturgist', zh: '主领' }, needed: 1 },
      { name: { en: 'Scripture Reader', zh: '读经' }, needed: 1 },
      { name: { en: 'Prayer Leader', zh: '代祷' }, needed: 1 },
      { name: { en: 'Elder on Duty', zh: '当值长老' }, needed: 1 },
    ],
  },
  {
    name: { en: 'Music', zh: '音乐' },
    color: '#0891b2',
    roles: [
      { name: { en: 'Musician', zh: '司琴' }, needed: 1 },
      { name: { en: 'Song Leader / Choir', zh: '领唱 / 诗班' }, needed: 0 },
    ],
  },
  {
    name: { en: 'AV & Media', zh: '影音' },
    color: '#ea580c',
    roles: [
      { name: { en: 'AV / Slides', zh: '投影' }, needed: 1 },
      { name: { en: 'Sound', zh: '音响' }, needed: 1 },
      { name: { en: 'Interpreter', zh: '翻译' }, needed: 0 },
    ],
  },
  {
    name: { en: 'Hospitality', zh: '招待' },
    color: '#16a34a',
    roles: [
      { name: { en: 'Ushers', zh: '招待员' }, needed: 2 },
      { name: { en: 'Welcome', zh: '迎新' }, needed: 1 },
      { name: { en: 'Communion Servers', zh: '襄礼' }, needed: 0 },
    ],
  },
];

export async function seed() {
  if (!get('SELECT 1 FROM teams LIMIT 1')) {
    tx(() => {
      DEFAULT_TEAMS.forEach((t, i) => {
        const teamId = createTeam({ name: t.name, color: t.color, sort: i });
        t.roles.forEach((r, j) => roles.insert({ team_id: teamId, name: r.name, needed: r.needed, sort: j }));
      });
    });
  }

  // Canons from before 0.14.2 had the whole library added on every start: they keep all of it.
  if (getMeta('library') == null) setMeta('library', JSON.stringify(Object.fromEntries(LIBRARY_PARTS.map((p) => [p, !!getMeta('seeded_at')]))));
  const chosen = LIBRARY_PARTS.filter((p) => libraryChoice()[p]);
  const counts = chosen.length ? await addBundled(chosen, false) : { songs: 0, texts: 0, templates: 0 };
  (await import('./presentation.ts')).seedPresentation(); // built-in slide themes & bulletin templates
  setMeta('seeded_at', new Date().toISOString());
  return counts;
}

export type LibraryPart = 'songs' | 'texts' | 'templates';
export const LIBRARY_PARTS: LibraryPart[] = ['songs', 'texts', 'templates'];
type Row = Record<string, unknown> & { key: string };

/** The parts of Canon's bundled library this church chose. */
export function libraryChoice(): Record<LibraryPart, boolean> {
  let v: Partial<Record<LibraryPart, boolean>> = {};
  try {
    v = JSON.parse(getMeta('library') ?? '{}') as Partial<Record<LibraryPart, boolean>>;
  } catch { /* none chosen */ }
  return { songs: !!v.songs, texts: !!v.texts, templates: !!v.templates };
}

/** The bundled items (written separately; may not exist on very early checkouts). */
async function bundled(): Promise<Record<LibraryPart, Row[]>> {
  const load = async (file: string, name: string): Promise<Row[]> => {
    try {
      return ((await import(file)) as Record<string, Row[]>)[name] ?? [];
    } catch (e) {
      console.warn(`seed: could not load ${file}: ${(e as Error).message}`);
      return [];
    }
  };
  return { songs: await load('./songs.ts', 'SEED_SONGS'), texts: await load('./texts.ts', 'SEED_TEXTS'), templates: await load('./templates.ts', 'SEED_TEMPLATES') };
}

const TABLE = { songs, texts, templates } as const;

function offeredKeys(): Partial<Record<LibraryPart, string[]>> {
  try {
    return JSON.parse(getMeta('seed_offered') ?? '{}') as Partial<Record<LibraryPart, string[]>>;
  } catch {
    return {};
  }
}

/** Add the parts' items this library has never been offered (restore: also the ones it deleted). */
async function addBundled(parts: LibraryPart[], restore: boolean) {
  const rows = await bundled();
  const offered = offeredKeys();
  const counts: Record<LibraryPart, number> = { songs: 0, texts: 0, templates: 0 };
  tx(() => {
    for (const part of parts) {
      const seen = new Set(offered[part] ?? []);
      for (const r of rows[part]) {
        if (!get(`SELECT 1 FROM ${part} WHERE key = ?`, r.key) && (restore || !seen.has(r.key))) {
          TABLE[part].insert(r);
          counts[part]++;
        }
        seen.add(r.key);
      }
      offered[part] = [...seen];
    }
    setMeta('seed_offered', JSON.stringify(offered));
  });
  if (counts.songs + counts.texts + counts.templates > 0) {
    console.log(`seed: added ${counts.songs} songs, ${counts.texts} texts, ${counts.templates} templates`);
  }
  return counts;
}

/** Add parts of the bundled library (chosen from now on, so updates add their new items too). */
export async function installLibrary(parts: LibraryPart[], opts: { restore?: boolean } = {}) {
  const choice = libraryChoice();
  for (const p of parts) choice[p] = true;
  setMeta('library', JSON.stringify(choice));
  return addBundled(parts, !!opts.restore);
}

/** For each part: whether it is chosen, how many items Canon bundles and how many of them this library has. */
export async function libraryStatus() {
  const rows = await bundled();
  const choice = libraryChoice();
  return Object.fromEntries(LIBRARY_PARTS.map((p) => {
    const present = rows[p].filter((r) => get(`SELECT 1 FROM ${p} WHERE key = ?`, r.key)).length;
    return [p, { chosen: choice[p], bundled: rows[p].length, in_library: present }];
  })) as Record<LibraryPart, { chosen: boolean; bundled: number; in_library: number }>;
}

export const lastSeeded = () => getMeta('seeded_at');
export const resetSeedFlag = () => run(`DELETE FROM settings WHERE key = '_seeded_at'`);
