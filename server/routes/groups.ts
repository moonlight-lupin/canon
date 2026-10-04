// REST routes for groups (committees, fellowships, cell groups), team members. Mounted inside /api after authentication (see server/api.ts).
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import type { GroupKind } from '../../shared/types.ts';
import * as grp from '../repo/groups.ts';

export const groupRoutes = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
const id = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(`Bad ${name}`), { status: 400 });
  return n;
};
const flag = (v: unknown) => v === '1' || v === 'true';

// ---------------------------------------------------------------- groups

groupRoutes.get('/groups', h((req) => grp.listGroups({
  kind: req.query.kind ? (S.GroupKindSchema.parse(req.query.kind) as GroupKind) : undefined,
  inactive: flag(req.query.inactive),
})));
groupRoutes.get('/groups/committees', h(() => grp.committeesView()));
groupRoutes.get('/groups/:id', h((req) => grp.groupDetail(id(req))));
groupRoutes.post('/groups', h((req) => grp.createGroup(S.GroupInput.parse(req.body))));
groupRoutes.patch('/groups/:id', h((req) => grp.updateGroup(id(req), S.GroupInput.partial().parse(req.body))));
groupRoutes.delete('/groups/:id', h((req) => grp.deleteGroup(id(req))));

groupRoutes.get('/groups/:id/members', h((req) => grp.membersOf(id(req), req.query.current !== '1')));
groupRoutes.post('/groups/:id/members', h((req) => grp.addGroupMember(id(req), S.GroupMemberInput.parse(req.body))));
groupRoutes.patch('/group-members/:id', h((req) => grp.updateGroupMember(id(req), S.GroupMemberInput.omit({ person_id: true }).partial().parse(req.body))));
groupRoutes.delete('/group-members/:id', h((req) => grp.removeGroupMember(id(req))));

/** A person's groups and volunteer teams (for the person editor). */
groupRoutes.get('/people/:id/groups', h((req) => ({ groups: grp.personGroups(id(req)), teams: grp.personTeams(id(req)) })));

// ---------------------------------------------------------------- volunteer team members

groupRoutes.get('/teams/:id/members', h((req) => grp.teamMembers(id(req))));
groupRoutes.post('/teams/:id/members', h((req) => {
  const b = S.TeamMemberInput.parse(req.body);
  return grp.addTeamMember(id(req), b.person_id, b.is_leader);
}));
groupRoutes.patch('/teams/:id/members/:person', h((req) => {
  const b = z.object({ is_leader: z.boolean() }).parse(req.body);
  return grp.setTeamLeader(id(req), id(req, 'person'), b.is_leader);
}));
groupRoutes.delete('/teams/:id/members/:person', h((req) => grp.removeTeamMember(id(req), id(req, 'person'), flag(req.query.cascade))));
