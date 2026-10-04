// First-run seeding: default volunteer teams/roles and the bundled public-domain library.
// Library items are upserted by `key`, so re-running only adds new items and never
// overwrites items the church has edited (unless force = true).
import type { L10n } from '../../shared/types.ts';
import { get, run, tx } from '../db.ts';
import { songs, texts } from '../repo/library.ts';
import { templates } from '../repo/services.ts';
import { teams, roles } from '../repo/volunteers.ts';
import { getMeta, setMeta } from '../repo/settings.ts';

const DEFAULT_TEAMS: { name: L10n; color: string; roles: { name: L10n; needed: number }[] }[] = [
  {
    name: { en: 'Pulpit & Liturgy', zh: '讲台与礼仪' },
    color: '#7c3aed',
    roles: [
      { name: { en: 'Preacher', zh: '讲员' }, needed: 1 },
      { name: { en: 'Worship Leader', zh: '主领' }, needed: 1 },
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

export async function seed(force = false) {
  if (!get('SELECT 1 FROM teams LIMIT 1')) {
    tx(() => {
      DEFAULT_TEAMS.forEach((t, i) => {
        const team = teams.insert({ name: t.name, color: t.color, sort: i });
        t.roles.forEach((r, j) => roles.insert({ team_id: team.id, name: r.name, needed: r.needed, sort: j }));
      });
    });
  }

  // Seed content is written separately and may not exist on very early checkouts.
  const load = async <T>(file: string, name: string): Promise<T[]> => {
    try {
      return ((await import(file)) as Record<string, T[]>)[name] ?? [];
    } catch (e) {
      console.warn(`seed: could not load ${file}: ${(e as Error).message}`);
      return [];
    }
  };
  const SONGS = await load<Record<string, unknown> & { key: string }>('./songs.ts', 'SEED_SONGS');
  const TEXTS = await load<Record<string, unknown> & { key: string }>('./texts.ts', 'SEED_TEXTS');
  const TEMPLATES = await load<Record<string, unknown> & { key: string }>('./templates.ts', 'SEED_TEMPLATES');

  const upsert = (tbl: typeof songs | typeof texts | typeof templates, name: string, rows: (Record<string, unknown> & { key: string })[]) => {
    let added = 0;
    for (const r of rows) {
      const existing = get<{ id: number }>(`SELECT id FROM ${name} WHERE key = ?`, r.key);
      if (!existing) {
        tbl.insert(r);
        added++;
      } else if (force) tbl.update(existing.id, r);
    }
    return added;
  };
  const counts = tx(() => ({
    songs: upsert(songs, 'songs', SONGS),
    texts: upsert(texts, 'texts', TEXTS),
    templates: upsert(templates, 'templates', TEMPLATES),
  }));
  if (counts.songs + counts.texts + counts.templates > 0) {
    console.log(`seed: added ${counts.songs} songs, ${counts.texts} texts, ${counts.templates} templates`);
  }
  (await import('./presentation.ts')).seedPresentation(); // built-in slide themes & bulletin templates
  setMeta('seeded_at', new Date().toISOString());
  return counts;
}

export const lastSeeded = () => getMeta('seeded_at');
export const resetSeedFlag = () => run(`DELETE FROM settings WHERE key = '_seeded_at'`);
