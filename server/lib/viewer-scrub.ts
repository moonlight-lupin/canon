// What read-only (viewer) accounts receive about people. They can see who is who — names, households, groups,
// teams and the rota — but not how to reach someone or what was written about them:
//  - member routes (people, households, co-workers, groups, teams, rota, away dates, dashboard): no phone, e-mail,
//    address, notes or reasons for absence; a birth date becomes just the birthday (day and month, no year, no age);
//  - service routes: no contact details (service and item notes stay — viewers may read the service);
//  - custom member fields marked sensitive (Settings → Member fields) are left out.
// Applied to every JSON response of those routes for viewers, so a field added later is covered by its name.

import { visibleCustom } from '../../shared/member-fields.ts';
import { getSettings } from '../repo/settings.ts';
import { leaderOwnsPath } from './leaders.ts';

const CONTACT = new Set(['phone', 'email', 'address']);
const PRIVATE = new Set(['notes', 'reason']);

/** A copy of `value` without the fields read-only accounts may not see. `member` = a member route. */
export function scrubForViewer<T>(value: T, member: boolean): T {
  if (Array.isArray(value)) return value.map((v) => scrubForViewer(v, member)) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (CONTACT.has(k)) continue;
    if (member && PRIVATE.has(k)) continue;
    if (member && k === 'custom') {
      // also when a route sends the stored JSON text: never pass it through as it is
      let values: unknown = v;
      if (typeof v === 'string') {
        try {
          values = JSON.parse(v);
        } catch {
          values = {};
        }
      }
      out.custom = values && typeof values === 'object' && !Array.isArray(values) ? visibleCustom(values as Record<string, unknown>, getSettings().member_fields ?? [], false) : {};
      continue;
    }
    if (member && k === 'birth_date') {
      out.birth_date = null;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) out.birthday = v.slice(5, 10);
      continue;
    }
    out[k] = scrubForViewer(v, member);
  }
  return out as T;
}

const MEMBER_ROUTE = /^\/(people|households|coworkers|groups|teams|rota|unavailability|dashboard)(\/|$)/;
const SERVICE_ROUTE = /^\/(services|share)(\/|$)/;

/** Express middleware (after sign-in): filter viewers' responses on member and service routes. */
export function viewerScrub(req: { user?: { role: string; person_id?: number | null } | null; path: string }, res: { json: (b: unknown) => unknown }, next: () => void) {
  // a meeting leader's own meeting record comes in full (lib/leaders.ts)
  if (req.user?.role === 'viewer' && !leaderOwnsPath(req.user.person_id, req.path)) {
    const member = MEMBER_ROUTE.test(req.path);
    if (member || SERVICE_ROUTE.test(req.path)) {
      const json = res.json.bind(res);
      res.json = (body: unknown) => json(scrubForViewer(body, member));
    }
  }
  next();
}
