// Licence warnings for the planner (0.13): a passage whose Bible version doesn't allow how this service uses it —
// printed in the bulletin, projected on the slides, or online on the share page or the attendees' bulletin link. Those outputs show the reference
// without the text (shared/bible-rights.ts); the warning says so before Sunday.
import type { BibleUse } from '../../shared/bible-rights.ts';
import type { L10n, Lang } from '../../shared/types.ts';
import { get } from '../db.ts';
import { renderService } from './render.ts';

export interface RightsWarning { item_id: number; ref: L10n; lang: Lang; translation: string; uses: BibleUse[] }

export function rightsWarnings(serviceId: number): RightsWarning[] {
  const r = renderService(serviceId);
  const s = get<{ t: string | null; a: string | null }>("SELECT share_token AS t, json_extract(attendee, '$.token') AS a FROM services WHERE id = ?", serviceId);
  const shared = !!(s?.t || s?.a);
  const out: RightsWarning[] = [];
  for (const it of r.items) {
    for (const [lang, p] of Object.entries(it.scripture?.passages ?? {})) {
      if (!p?.rights || !p.verses.length) continue;
      const uses = ([
        it.in_bulletin && 'print', it.on_slides && 'project', shared && 'online',
      ].filter(Boolean) as BibleUse[]).filter((u) => !p.rights![u]);
      if (uses.length) out.push({ item_id: it.id, ref: it.scripture!.ref, lang: lang as Lang, translation: p.translation, uses });
    }
  }
  return out;
}
