// Edit conflicts: a screen that edits a record for a while sends the revision it started from in the X-Base-Version
// header (0 when it saw no record yet). Every save adds one to the record's revision, so two saves within the same
// second are still told apart. If the record changed since, the save is refused with who changed it and when,
// instead of silently overwriting their work. The check and the save run in one synchronous step (node:sqlite is
// synchronous and nothing is awaited in between), so no other request can save in between.
// Screens that do not send the header (AI agents, CSV import) are not checked.
import type { Request } from 'express';
import { get } from '../db.ts';
import { Conflict } from './table.ts';

export function assertFresh(req: Request, current: { revision?: number | null; updated_at?: string | null }, entity: string, id: number) {
  const base = req.get('x-base-version');
  if (!base) return;
  // a screen opened before 0.11.1 still sends the time the record was last saved
  const same = /^\d+$/.test(base) ? Number(base) === (current.revision ?? 0) : base === current.updated_at;
  if (same) return;
  const last = get<{ user_name: string | null; at: string }>(
    'SELECT user_name, at FROM change_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1', entity, id,
  );
  const who = last?.user_name ? ` by ${last.user_name}` : '';
  const when = last?.at ? ` at ${last.at.slice(11, 16)} (UTC) on ${last.at.slice(0, 10)}` : '';
  throw new Conflict(`Someone else changed this${who}${when} after you opened it. Your changes were not saved: reload to see theirs, then make your changes again.`);
}
