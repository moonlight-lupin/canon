// REST routes for members and households (and what a member page needs). Mounted inside /api after authentication.
import { APPROVER_EMAIL_LOCKED, approverEmailLocked } from '../repo/bk-claims.ts';
import { openLoanCount } from '../repo/lending.ts';
import express from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { legacyExport, legacyImport, rawBody, uiLang } from './csv.ts';
import { requireAdmin } from '../auth.ts';
import { all, run, tx } from '../db.ts';
import { logChange } from '../repo/changelog.ts';
import * as reg from '../repo/registers.ts';
import * as vol from '../repo/volunteers.ts';
import { assertFresh } from '../lib/versions.ts';
import { cleanFieldDefs, type MemberField } from '../../shared/member-fields.ts';
import * as sec from '../repo/security.ts';
import * as pdpa from '../repo/pdpa.ts';
import * as grp from '../repo/groups.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { h, id, str } from './helpers.ts';
import { localTime, sendXlsx } from '../lib/xlsx-export.ts';
import { seesMemberDetails, seesSensitiveFields } from '../lib/permissions.ts';
import { inWall } from '../lib/walls.ts';
import { BadRequest } from '../lib/table.ts';
import { churchToday } from '../lib/dates.ts';

export const peopleRoutes = express.Router();

// ---------------------------------------------------------------- people & households

peopleRoutes.get('/people', h((req) => reg.listPeople({
  q: str(req.query.q), status: str(req.query.status),
  // read-only accounts search names only (searching by phone or e-mail would reveal them)
  names_only: !seesMemberDetails(req.user),
  household_id: Number(req.query.household_id) || undefined,
  congregation_id: Number(req.query.congregation) || undefined,
  custom: fieldFilter(req),
  limit: Number(req.query.limit) || undefined, offset: Number(req.query.offset) || undefined,
})));
/** ?field=key=value: one of the church's own fields, and one this account may see (a sensitive one only if it sees those). */
function fieldFilter(req: express.Request): { key: string; value: string } | undefined {
  const f = str(req.query.field);
  if (!f) return undefined;
  const [key, ...rest] = f.split('=');
  const def = (getSettings().member_fields ?? []).find((d) => d.key === key);
  if (!def || (def.sensitive && !seesSensitiveFields(req.user))) throw new BadRequest('Not a member field you can filter by.');
  return { key, value: rest.join('=') };
}
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
  return reg.people.insert(inWall({ ...b, custom: reg.customFor({}, b.custom, seesSensitiveFields(req.user)) ?? {} }));
}));
peopleRoutes.patch('/people/:id', h((req) => {
  const pid = id(req);
  if (reg.people.get(pid).erased_at) throw Object.assign(new Error('This member’s personal data was erased: the record can’t be edited.'), { status: 400 });
  assertFresh(req, reg.people.get(pid), 'people', pid);
  const b = S.PersonInput.partial().parse(req.body);
  if (approverEmailLocked(pid, b.email)) throw Object.assign(new Error(APPROVER_EMAIL_LOCKED), { status: 403 });
  const custom = reg.customFor(reg.people.get(pid).custom, b.custom, seesSensitiveFields(req.user));
  return reg.people.update(pid, { ...b, ...(custom ? { custom } : {}) });
}));
// Settings → Security & privacy (administrators): the checklist, what was confirmed, who viewed member records; storage
peopleRoutes.get('/security', requireAdmin, h(() => ({ checklist: sec.securityChecklist(), security: getSettings().security })));
peopleRoutes.put('/security', requireAdmin, h((req) => {
  const b = z.object({ disk_encryption: z.boolean().optional(), require_admin_2fa: z.boolean().optional(), require_all_2fa: z.boolean().optional() }).parse(req.body);
  // requiring it is only possible for an administrator who uses it (else they would lock themselves out)
  if ((b.require_admin_2fa || b.require_all_2fa) && !req.user?.totp_enabled) throw Object.assign(new Error('Turn on two-step sign-in for your own account first (Settings → My profile).'), { status: 400 });
  return updateSettings({ security: { ...getSettings().security, ...b } }).security;
}));
const viewQuery = (q: Record<string, string | undefined>) => ({
  person_id: Number(q.person) || undefined, user_id: Number(q.user) || undefined, via: q.via || undefined,
  from: q.from, to: q.to, q: q.q, page: Number(q.page) || 1, size: Number(q.size) || 50,
});
peopleRoutes.get('/member-views', requireAdmin, h((req) => sec.listMemberViews(viewQuery(req.query as Record<string, string | undefined>))));
peopleRoutes.get('/member-views.xlsx', requireAdmin, h((req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const r = sec.listMemberViews({ ...viewQuery(q), all: true });
  const HOW: Record<string, string> = { web: 'Member page', mcp: 'AI agent', export: 'Export' };
  sendXlsx(req, res, uiLang(req), {
    file: `canon-member-views-${churchToday()}`, title: 'Who viewed member records', pii: true,
    period: q.from || q.to ? `${q.from ?? '…'} – ${q.to ?? '…'}` : null,
    header: ['Time', 'Who', 'How', 'Member', 'Detail'],
    rows: r.rows.map((v) => [localTime(v.at), v.user_name, HOW[v.via] ?? v.via, v.person_name, v.detail]),
  });
}));
peopleRoutes.get('/storage', requireAdmin, h(() => sec.storageReport()));
/** Settings → Member fields (administrators): the church's own fields on the member register. */
peopleRoutes.put('/member-fields', requireAdmin, h((req) => {
  const b = z.array(z.object({
    key: z.string().max(40).optional(), label: S.L10nSchema, type: z.enum(['text', 'date', 'yesno', 'choice']),
    options: z.array(S.L10nSchema).max(30).optional(), sensitive: z.boolean().optional(),
  })).max(30).parse(req.body);
  const current = getSettings().member_fields ?? [];
  const retired = getSettings().member_fields_retired ?? [];
  const next = cleanFieldDefs(b as MemberField[], current, retired, reg.storedCustomKeys());
  // a field with values keeps its type: the values wouldn't fit another (a member then couldn't be saved)
  for (const f of next.fields) {
    const was = [...current, ...retired].find((c) => c.key === f.key);
    const n = was && was.type !== f.type ? reg.customValueCount(f.key) : 0;
    if (n) {
      const name = f.label.en || Object.values(f.label).find(Boolean) || f.key;
      throw Object.assign(new Error(`${n} member${n === 1 ? ' has' : 's have'} a value in “${name}”, so its type can’t change. Add a new field instead (and remove this one), or clear those values first.`), { status: 409 });
    }
  }
  return updateSettings({ member_fields: next.fields, member_fields_retired: next.retired }).member_fields;
}));
peopleRoutes.delete('/people/:id', h((req) => {
  const n = openLoanCount(id(req));
  if (n) throw Object.assign(new Error(`This member has ${n} item(s) from the lending library on loan: take them back first.`), { status: 400 });
  return reg.people.remove(id(req));
}));
// PDPA (administrators): everything held about a member, as a file for them; erasing it
peopleRoutes.get('/people/:id/personal-data', requireAdmin, h((req, res) => {
  const pid = id(req);
  const data = pdpa.personalData(pid);
  sec.logMemberView({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, person_id: pid, via: 'export', detail: 'Personal data export (PDPA)' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Disposition', `attachment; filename="canon-personal-data-${pid}-${churchToday()}.json"`);
  return data;
}));
peopleRoutes.post('/people/:id/erase', requireAdmin, h((req) => pdpa.erasePerson(id(req), z.object({ confirm: z.string().max(300) }).parse(req.body).confirm)));
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
/** A family new to the church (0.19.7): the household and its people, saved together (all or nothing). */
peopleRoutes.post('/households/family', h((req) => {
  const b = z.object({ household: S.HouseholdInput, people: z.array(S.PersonInput.omit({ household_id: true })).min(1).max(20) }).parse(req.body);
  return tx(() => {
    const household = reg.households.insert(b.household) as { id: number };
    const people = b.people.map((p) => reg.people.insert(inWall({
      ...p, household_id: household.id, household_role: p.household_role ?? 'other',
      custom: reg.customFor({}, p.custom, seesSensitiveFields(req.user)) ?? {},
    })));
    return { household, people };
  });
}));
peopleRoutes.patch('/households/:id', h((req) => reg.households.update(id(req), S.HouseholdInput.partial().parse(req.body))));
peopleRoutes.delete('/households/:id', h((req) => reg.households.remove(id(req))));

peopleRoutes.get('/coworkers', h((req) => reg.listCoworkers({ active: req.query.active === '1' })));
peopleRoutes.post('/coworkers', h((req) => reg.coworkers.insert(S.CoworkerInput.parse(req.body))));
peopleRoutes.patch('/coworkers/:id', h((req) => reg.coworkers.update(id(req), S.CoworkerInput.partial().parse(req.body))));
peopleRoutes.delete('/coworkers/:id', h((req) => reg.coworkers.remove(id(req))));
