// What a church may do with a Bible version's text (0.13): print it (bulletins, Word files), project it (slides,
// presentation files) and put it online (the public share page). Public-domain versions allow everything; an uploaded,
// licensed version starts without "online" until an administrator records that its licence allows it.
import type { RenderedService } from './render-types.ts';

export const BIBLE_USES = ['print', 'project', 'online'] as const;
export type BibleUse = (typeof BIBLE_USES)[number];
export type BibleRights = Record<BibleUse, boolean>;

export const ALL_RIGHTS: BibleRights = { print: true, project: true, online: true };
/** a newly uploaded version: for the church's own printing and projection */
export const UPLOAD_RIGHTS: BibleRights = { print: true, project: true, online: false };

export function parseRights(v: unknown): BibleRights {
  let o: unknown = v;
  if (typeof v === 'string') {
    try {
      o = JSON.parse(v);
    } catch {
      o = null;
    }
  }
  const r = (o && typeof o === 'object' ? o : {}) as Partial<BibleRights>;
  return { print: r.print !== false, project: r.project !== false, online: r.online !== false };
}

/**
 * The service as it may be used for `use`: passages of a version whose licence doesn't allow it keep their reference
 * and lose their text (marked `withheld`). Renders made before rights existed have none and are left as they are.
 */
export function withRights<T extends RenderedService>(r: T, use: BibleUse): T {
  return {
    ...r,
    items: r.items.map((it) => {
      if (!it.scripture) return it;
      const passages = Object.fromEntries(Object.entries(it.scripture.passages).map(([l, p]) => [
        l, p && p.rights && p.rights[use] === false ? { ...p, verses: [], withheld: use } : p,
      ]));
      return { ...it, scripture: { ...it.scripture, passages } };
    }),
  };
}
