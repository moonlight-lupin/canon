// MCP tools for groups: committees, fellowships, cell groups, ministries.
// Groups are part of the people registers: names and roles only; contact details only when the admin exposes PII.
// (server/mcp.ts audits 'groups' calls with argument keys only, like members / co-workers.)
// Volunteer team rosters live in ./volunteers.ts (canon_update_team_members).
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import type { GroupKind } from '../../shared/types.ts';
import { get } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import * as grp from '../repo/groups.ts';
import { DESTRUCTIVE, DateStr, Id, L10N_MERGE_NOTE, RO, WRITE, mergeL10nFields, need, runBatch, type ToolDef } from './common.ts';

const KIND_TEXT = 'kind: committee (Session 堂会, Board of Deacons 执事会, missions committee…) | fellowship 团契 | cell_group 小组 | ministry | other';
const ROLE_TEXT = 'role is free text, e.g. Moderator, Chair 主席, Secretary 书记, Clerk, Treasurer 财务, Leader 组长, Member 组员';

const groupSummary = (g: ReturnType<typeof grp.listGroups>[number]) => ({
  id: g.id,
  name: g.name,
  kind: g.kind,
  meeting: g.meeting,
  active: g.active,
  member_count: g.member_count,
  leaders: g.leaders.map((l) => ({ person_id: l.person_id, name: l.name, role: l.role })),
});

const memberLine = (m: grp.MemberRow, pii: boolean) => ({
  member_id: m.id,
  person_id: m.person_id,
  name: m.name,
  role: m.role,
  start_date: m.start_date,
  end_date: m.end_date,
  current: m.current,
  ...(pii ? { phone: m.phone, email: m.email } : {}),
});

const MemberOp = z.object({
  op: z.enum(['add', 'update', 'remove']),
  person_id: Id.optional().describe('add; or identifies the membership for update / remove'),
  member_id: Id.optional().describe('update / remove'),
  role: z.string().max(100).nullable().optional(),
  start_date: DateStr.nullable().optional(),
  end_date: DateStr.nullable().optional(),
});
type MemberOp = z.infer<typeof MemberOp>;

function membershipId(groupId: number, o: MemberOp) {
  if (o.member_id) {
    const m = grp.groupMembers.get(o.member_id);
    if (m.group_id !== groupId) throw new BadRequest(`membership ${o.member_id} is not in group ${groupId}`);
    return m.id;
  }
  const pid = need(o.person_id, 'member_id or person_id', o.op);
  const r = get<{ id: number }>('SELECT id FROM group_members WHERE group_id = ? AND person_id = ?', groupId, pid);
  if (!r) throw new NotFound(`person ${pid} is not in group ${groupId}`);
  return r.id;
}

/** Only the fields actually given (undefined = keep, null = clear). */
const termPatch = (o: MemberOp) =>
  Object.fromEntries((['role', 'start_date', 'end_date'] as const).filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

function applyMemberOp(groupId: number, o: MemberOp) {
  switch (o.op) {
    case 'add': {
      const m = grp.addGroupMember(groupId, { person_id: need(o.person_id, 'person_id', 'add'), role: o.role, start_date: o.start_date, end_date: o.end_date });
      return { op: o.op, member_id: m.id, person_id: m.person_id };
    }
    case 'update': {
      const id = membershipId(groupId, o);
      const m = grp.updateGroupMember(id, termPatch(o));
      return { op: o.op, member_id: id, person_id: m.person_id, role: m.role, start_date: m.start_date, end_date: m.end_date };
    }
    case 'remove': {
      const id = membershipId(groupId, o);
      const m = grp.groupMembers.get(id);
      grp.removeGroupMember(id);
      return { op: o.op, member_id: id, person_id: m.person_id };
    }
  }
}

function groupDetail(id: number, pii: boolean) {
  const g = grp.groupDetail(id);
  return {
    id: g.id, name: g.name, kind: g.kind, description: g.description, meeting: g.meeting, active: g.active, color: g.color,
    members: g.members.map((m) => memberLine(m, pii)),
  };
}

export const GROUP_TOOLS: ToolDef[] = [
  {
    name: 'canon_find_groups', module: 'groups', access: 'read', title: 'Find groups', annotations: RO,
    description: `Committees, fellowships, cell groups and ministries. Without id: each with its current member count and leaders (names only), filtered by ${KIND_TEXT}; inactive groups only with include_inactive. With id: that group with all members (member_id, person_id, name, role, term dates; current=false for ended terms). Example: {"kind":"committee"}.`,
    input: { id: Id.optional(), kind: S.GroupKindSchema.optional(), include_inactive: z.boolean().optional() },
    handler: (a, ctx) => (a.id
      ? groupDetail(a.id, ctx.pii)
      : grp.listGroups({ kind: a.kind as GroupKind | undefined, inactive: !!a.include_inactive }).map(groupSummary)),
  },
  {
    name: 'canon_save_group', module: 'groups', access: 'write', title: 'Save a group', annotations: { ...WRITE, idempotentHint: true },
    description: `Create a group (no id; fields.name and kind required) or update one (id; only the given fields change; active=false retires a group without deleting it). name is L10n {"en":"Session","zh":"堂会"} (${L10N_MERGE_NOTE}); ${KIND_TEXT}; meeting is free text such as "Fridays 8pm, church hall". Returns the group.`,
    input: { id: Id.optional(), fields: S.GroupInput.partial().default({}) },
    handler: (a) => (a.id ? grp.updateGroup(a.id, mergeL10nFields(grp.groups.get(a.id), a.fields, ['name'])) : grp.createGroup(S.GroupInput.parse(a.fields))),
  },
  {
    name: 'canon_update_group_members', module: 'groups', access: 'write', title: 'Update group members', annotations: DESTRUCTIVE,
    description: `Change a group's membership in one transaction: add {person_id, role?, start_date?, end_date?}; update {member_id or person_id, role / start_date / end_date — null clears}; remove {member_id or person_id}. ${ROLE_TEXT}. To end a term keep the history: update end_date rather than remove (ask the user before removing). All or nothing, with per-op errors. Returns the group with its members. Example: {"group_id":3,"ops":[{"op":"add","person_id":45,"role":"Clerk","start_date":"2026-01-01"},{"op":"update","person_id":31,"end_date":"2025-12-31"}]}.`,
    input: { group_id: Id, ops: z.array(MemberOp).min(1).max(50) },
    handler: (a, ctx) => {
      grp.groups.get(a.group_id);
      const results = runBatch(a.ops as MemberOp[], (o) => applyMemberOp(a.group_id, o));
      return { results, group: groupDetail(a.group_id, ctx.pii) };
    },
  },
];
