// REST routes for members and households (and what a member page needs). Mounted inside /api after authentication.
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { legacyExport, legacyImport, rawBody } from './csv.ts';
import { requireAdmin } from '../auth.ts';
import { all, run } from '../db.ts';
import { logChange } from '../repo/changelog.ts';
import * as reg from '../repo/registers.ts';
import * as vol from '../repo/volunteers.ts';
import { assertFresh } from '../lib/versions.ts';
import { cleanFieldDefs, type MemberField } from '../../shared/member-fields.ts';
import * as sec from '../repo/security.ts';
import * as grp from '../repo/groups.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { h, id, sendCsv, str } from './helpers.ts';
import { seesMemberDetails } from '../lib/permissions.ts';
import { inWall } from '../lib/walls.ts';

export const peopleRoutes = express.Router();

// ---------------------------------------------------------------- people & households

peopleRoutes.get('/people', h((req) => reg.listPeople({
  q: str(req.query.q), status: str(req.query.status),
  // read-only accounts search names only (searching by phone or e-mail would reveal them)
  names_only: !seesMemberDetails(req.user),
  household_id: Number(req.query.household_id) || undefined,
  congregation_id: Number(req.query.congregation) || undefined,
  limit: Number(req.query.limit) || undefined, offset: Number(req.query.offset) || undefined,
})));
// CSV import/export now goes through the CSV framework (server/routes/csv.ts); these older URLs remain as aliases.
peopleRoutes.get('/people/export.csv', h((req, res) => legacyExport('members', req, res)));
peopleRoutes.post('/people/import', rawBody, h((req) => legacyImport('members', req)));
peopleRoutes.get('/people/:id', h((req) => {
  const p = reg.people.get(id(req));
  sec.logMemberView({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, person_id: p.id, via: 'web' });
  return {
    ...p,
    coworker: reg.coworkers.list('person_id = ?', [p.id]),
    roles: all<{ role_id: number }>('SELECT role_id FROM role_members WHERE person_id = ?', p.id).map((r) => r.role_id),
    schedule: vol.personSchedule(p.id),
    unavailability: vol.unavailability.list('person_id = ?', [p.id], 'start_date'),
  };
}));
peopleRoutes.post('/people', h((req) => {
  const b = S.PersonInput.parse(req.body);
  return reg.people.insert(inWall({ ...b, custom: reg.customFor({}, b.custom) ?? {} }));
}));
peopleRoutes.patch('/people/:id', h((req) => {
  const pid = id(req);
  assertFresh(req, reg.people.get(pid), 'people', pid);
  const b = S.PersonInput.partial().parse(req.body);
  const custom = reg.customFor(reg.people.get(pid).custom, b.custom);
  return reg.people.update(pid, { ...b, ...(custom ? { custom } : {}) });
}));
// Settings → Security & privacy (administrators): the checklist, what was confirmed, who viewed member records; storage
peopleRoutes.get('/security', requireAdmin, h(() => ({ checklist: sec.securityChecklist(), security: getSettings().security })));
peopleRoutes.put('/security', requireAdmin, h((req) => updateSettings({ security: z.object({ disk_encryption: z.boolean() }).parse(req.body) }).security));
const viewQuery = (q: Record<string, string | undefined>) => ({
  person_id: Number(q.person) || undefined, user_id: Number(q.user) || undefined, via: q.via || undefined,
  from: q.from, to: q.to, q: q.q, page: Number(q.page) || 1, size: Number(q.size) || 50,
});
peopleRoutes.get('/member-views', requireAdmin, h((req) => sec.listMemberViews(viewQuery(req.query as Record<string, string | undefined>))));
peopleRoutes.get('/member-views.csv', requireAdmin, h((req, res) => {
  const r = sec.listMemberViews({ ...viewQuery(req.query as Record<string, string | undefined>), all: true });
  const HOW: Record<string, string> = { web: 'Member page', mcp: 'AI agent', export: 'CSV export' };
  sendCsv(res, `canon-member-views-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'Who', 'How', 'Member', 'Detail'],
    ...r.rows.map((v) => [v.at, v.user_name, HOW[v.via] ?? v.via, v.person_name, v.detail]),
  ]);
}));
peopleRoutes.get('/storage', requireAdmin, h(() => sec.storageReport()));
/** Settings → Member fields (administrators): the church's own fields on the member register. */
peopleRoutes.put('/member-fields', requireAdmin, h((req) => {
  const b = z.array(z.object({
    key: z.string().max(40).optional(), label: S.L10nSchema, type: z.enum(['text', 'date', 'yesno', 'choice']),
    options: z.array(S.L10nSchema).max(30).optional(), sensitive: z.boolean().optional(),
  })).max(30).parse(req.body);
  return updateSettings({ member_fields: cleanFieldDefs(b as MemberField[], getSettings().member_fields ?? []) }).member_fields;
}));
peopleRoutes.delete('/people/:id', h((req) => reg.people.remove(id(req))));
peopleRoutes.put('/people/:id/roles', h((req) => {
  const pid = id(req);
  const roleIds = z.array(z.number().int()).parse(req.body.role_ids);
  const held = all<{ role_id: number }>('SELECT role_id FROM role_members WHERE person_id = ? ORDER BY role_id', pid).map((r) => r.role_id);
  const roleName = (rid: number) => vol.roles.find(rid)?.name.en ?? `#${rid}`;
  const next = [...new Set(roleIds)].sort((a, b) => a - b);
  if (JSON.stringify(held) !== JSON.stringify(next)) {
    logChange({ entity: 'people', entity_id: pid, action: 'update', before: { ...reg.people.get(pid), roles: held.map(roleName) }, after: { ...reg.people.get(pid), roles: next.map(roleName) } });
  }
  run('DELETE FROM role_members WHERE person_id = ?', pid);
  for (const r of new Set(roleIds)) {
    run('INSERT INTO role_members (role_id, person_id) VALUES (?, ?)', r, pid);
    // qualifying for a role puts the person on that role's team roster
    grp.ensureOnRoleTeam(r, pid);
  }
}));

peopleRoutes.get('/households', h(() => reg.householdsWithMembers()));
peopleRoutes.post('/households', h((req) => reg.households.insert(S.HouseholdInput.parse(req.body))));
peopleRoutes.patch('/households/:id', h((req) => reg.households.update(id(req), S.HouseholdInput.partial().parse(req.body))));
peopleRoutes.delete('/households/:id', h((req) => reg.households.remove(id(req))));

peopleRoutes.get('/coworkers', h((req) => reg.listCoworkers({ active: req.query.active === '1' })));
peopleRoutes.post('/coworkers', h((req) => reg.coworkers.insert(S.CoworkerInput.parse(req.body))));
peopleRoutes.patch('/coworkers/:id', h((req) => reg.coworkers.update(id(req), S.CoworkerInput.partial().parse(req.body))));
peopleRoutes.delete('/coworkers/:id', h((req) => reg.coworkers.remove(id(req))));
