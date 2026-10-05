// Edit conflicts: a screen that edits a record for a while sends the version it started from (its updated_at) in
// the X-Base-Version header. If the record changed since, the save is refused with who changed it and when, instead
// of silently overwriting their work. Screens that do not send the header are not checked.
import type { Request } from 'express';
import { get } from '../db.ts';
import { Conflict } from './table.ts';

export function assertFresh(req: Request, current: { updated_at?: string | null }, entity: string, id: number) {
  const base = req.get('x-base-version');
  if (!base || !current.updated_at || base === current.updated_at) return;
  const last = get<{ user_name: string | null; at: string }>(
    'SELECT user_name, at FROM change_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1', entity, id,
  );
  const who = last?.user_name ? ` by ${last.user_name}` : '';
  const when = last?.at ? ` at ${last.at.slice(11, 16)} (UTC) on ${last.at.slice(0, 10)}` : '';
  throw new Conflict(`Someone else changed this${who}${when} after you opened it. Your changes were not saved: reload to see theirs, then make your changes again.`);
}
