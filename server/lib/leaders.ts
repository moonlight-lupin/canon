// Meeting leaders (0.12): a read-only account linked to a member (users.person_id) may record the meetings that
// member leads — a meeting they lead themselves (services.leader_id), or a meeting of a group they lead
// (group_members.leads, while their term runs). Everything else stays read-only for them.
//
// The check runs where read-only accounts are stopped (auth.requireUser), against a short list of requests, so a
// route can't forget it: the record (save, sign, finish, verify), the meeting's details, its next meeting, and a
// new meeting of a group they lead. The meeting's record is then returned in full to them (offerings, visitors'
// contact details for the follow-up).
import { all, get } from '../db.ts';

const today = () => new Date().toISOString().slice(0, 10);

/** The groups a member leads now. */
export function ledGroups(personId: number | null | undefined): number[] {
  if (!personId) return [];
  return all<{ group_id: number }>(
    'SELECT group_id FROM group_members WHERE person_id = ? AND leads = 1 AND (end_date IS NULL OR end_date >= ?)', personId, today(),
  ).map((r) => r.group_id);
}

/** Whether this member leads this meeting (itself, or its group). Services never qualify. */
export function leadsMeeting(personId: number | null | undefined, serviceId: number): boolean {
  if (!personId) return false;
  const m = get<{ kind: string; group_id: number | null; leader_id: number | null }>('SELECT kind, group_id, leader_id FROM services WHERE id = ?', serviceId);
  if (!m || m.kind !== 'meeting') return false;
  return m.leader_id === personId || (m.group_id != null && ledGroups(personId).includes(m.group_id));
}

type Req = { method: string; path: string; body?: unknown };

const RECORD = /^\/services\/(\d+)\/record$/;
const RECORD_ACTION = /^\/services\/(\d+)\/record\/(sign|approve|finish|unsign|verify)$/;
const DETAILS = /^\/services\/(\d+)$/;
const NEXT = /^\/services\/(\d+)\/duplicate$/;

/**
 * May this read-only account make this change? Only the listed requests, only for meetings its member leads.
 * (Administrators and editors are not asked: they may change anything their role allows.)
 */
export function leaderMayWrite(personId: number | null | undefined, req: Req): boolean {
  if (!personId) return false;
  const body = (req.body ?? {}) as Record<string, unknown>;
  let m: RegExpExecArray | null;
  if (req.method === 'PUT' && (m = RECORD.exec(req.path))) return leadsMeeting(personId, Number(m[1]));
  if (req.method === 'POST' && (m = RECORD_ACTION.exec(req.path))) {
    // verifying, yes; reopening a verified count stays with administrators
    if (m[2] === 'verify' && body.verified !== true) return false;
    return leadsMeeting(personId, Number(m[1]));
  }
  if (req.method === 'PATCH' && (m = DETAILS.exec(req.path))) {
    const id = Number(m[1]);
    if (!leadsMeeting(personId, id)) return false;
    // the details of their meeting, but not who it belongs to or who leads it
    const cur = get<{ group_id: number | null; leader_id: number | null }>('SELECT group_id, leader_id FROM services WHERE id = ?', id)!;
    if ('kind' in body) return false;
    if ('group_id' in body && body.group_id !== cur.group_id) return false;
    if ('leader_id' in body && body.leader_id !== cur.leader_id) return false;
    return true;
  }
  if (req.method === 'POST' && (m = NEXT.exec(req.path))) return leadsMeeting(personId, Number(m[1]));
  if (req.method === 'POST' && req.path === '/meetings') return typeof body.group_id === 'number' && ledGroups(personId).includes(body.group_id);
  return false;
}

/** A meeting record (or one of its actions) that this account's member leads: returned in full, not scrubbed. */
export function leaderOwnsPath(personId: number | null | undefined, path: string): boolean {
  const m = RECORD.exec(path) ?? RECORD_ACTION.exec(path);
  return !!m && leadsMeeting(personId, Number(m[1]));
}
