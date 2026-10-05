import fs from 'node:fs';
import path from 'node:path';
// REST API for the web app. All business logic lives in ./repo; this file wires HTTP to it.
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import * as S from '../shared/schemas.ts';
import type { Lang } from '../shared/types.ts';
import { RefError } from '../shared/bible.ts';
import { BIBLE_SOURCES, MAX_SERVICE_LANGS, langInfo } from '../shared/languages.ts';
import { libraryRoutes } from './routes/library.ts';
import { groupRoutes } from './routes/groups.ts';
import { emailRoutes } from './routes/email.ts';
import { backupRoutes } from './routes/backups.ts';
import { designRoutes, publicDesignRoutes } from './routes/design.ts';
import { presentationRoutes } from './routes/presentation.ts';
import { csvRoutes, legacyExport, legacyImport, rawBody } from './routes/csv.ts';
import { bibleRoutes } from './routes/bible.ts';
import {
  authenticate, createUser, endSession, getUser, hashPassword, listUsers, loginFailed, loginOk, loginThrottle,
  requireAdmin, requireUser, sessionUser, startSession, userCount, verifyPassword,
} from './auth.ts';
import { all, get, run } from './db.ts';
import { config } from './config.ts';
import { normalisePublicUrl, publicUrl } from './lib/public-url.ts';
import { asActor } from './lib/actor.ts';
import { viewerScrub } from './lib/viewer-scrub.ts';
import { ENTITY_LABEL, changeLogUsers, listAudit, listChanges, logChange } from './repo/changelog.ts';
import * as reg from './repo/registers.ts';
import * as vol from './repo/volunteers.ts';
import * as lib from './repo/library.ts';
import * as bible from './repo/bible.ts';
import * as svc from './repo/services.ts';
import * as cong from './repo/congregations.ts';
import * as rec from './repo/records.ts';
import * as reports from './repo/reports.ts';
import { Forbidden } from './lib/table.ts';
import { assertFresh } from './lib/versions.ts';
import { cleanRef } from './repo/refs.ts';
import { cleanFieldDefs, type MemberField } from '../shared/member-fields.ts';
import { toCsv } from '../shared/reports.ts';
import * as vf from './repo/visitor-form.ts';
import * as sec from './repo/security.ts';
import * as arc from './repo/archive.ts';
import * as bg from './repo/backgrounds.ts';
import { libraryChecks } from './repo/checks.ts';
import * as grp from './repo/groups.ts';
import type { ServiceRecord } from '../shared/records.ts';
import { renderService } from './repo/render.ts';
import { songUsage } from './repo/history.ts';
import { getSettings, updateSettings, type Settings } from './repo/settings.ts';
import { serviceDocx } from './export/docx.ts';
import { freeshowProject } from './export/freeshow.ts';
import { fileForToken, buildFile, type DownloadFile } from './repo/downloads.ts';
import { listGrants, revokeGrant, externalBase } from './oauth.ts';
import { toolCatalog } from './mcp.ts';

export const api = express.Router();

type Handler = (req: Request, res: Response) => unknown;
/** Send a CSV download (with a BOM so Excel reads Chinese correctly). */
function sendCsv(res: Response, filename: string, rows: (string | number | null | undefined)[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(toCsv(rows));
}
/** Wrap a handler: async errors go to the error middleware, return values are sent as JSON. */
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
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

// ---------------------------------------------------------------- public: session & setup

api.get('/me', (req, res) => {
  const u = sessionUser(req);
  res.json({ user: u ? { ...u, csrf: undefined } : null, csrf: u?.csrf ?? null, needsSetup: userCount() === 0 });
});

api.post('/setup', h((req, res) => {
  if (userCount() > 0) throw Object.assign(new Error('Already set up'), { status: 409 });
  const b = z.object({
    username: z.string().min(2), display_name: z.string().min(1), password: z.string().min(8),
    church_name: S.L10nSchema.optional(),
    languages: z.array(S.LangSchema).min(1).max(8).optional(),
    ui_lang: S.LangSchema.optional(),
  }).parse(req.body);
  const user = createUser({ ...b, role: 'admin' });
  if (b.ui_lang) run('UPDATE users SET lang = ? WHERE id = ?', b.ui_lang, user.id);
  const patch: Partial<Settings> = {};
  if (b.church_name) patch.church_name = b.church_name;
  if (b.languages) {
    patch.languages = b.languages;
    patch.default_languages = b.languages.slice(0, MAX_SERVICE_LANGS);
    patch.bibles = Object.fromEntries(b.languages.map((l) => [l, langInfo(l).bibles[0]?.code]).filter(([, c]) => c));
  }
  updateSettings(patch);
  const csrf = startSession(req, res, user);
  return { user, csrf };
}));

api.post('/login', h((req, res) => {
  const ip = req.ip ?? '';
  if (loginThrottle(ip)) throw Object.assign(new Error('Too many attempts — try again in 15 minutes'), { status: 429 });
  const b = z.object({ username: z.string(), password: z.string() }).parse(req.body);
  const user = authenticate(b.username, b.password);
  if (!user) {
    loginFailed(ip);
    throw Object.assign(new Error('Wrong username or password'), { status: 401 });
  }
  loginOk(ip);
  const csrf = startSession(req, res, user);
  return { user, csrf };
}));

api.post('/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

// Public read-only share page for a service (names only, no contact details).
api.get('/share/:token', h((req) => {
  const full = svc.serviceByShareToken(String(req.params.token));
  return renderService(full);
}));

/** Send a built file as a download. */
function sendFile(res: Response, f: DownloadFile) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.body);
}

// Short-lived download links (made by AI agents: canon_get_service format "downloads"): one file each, no sign-in needed.
api.get('/dl/:token', h(async (req, res) => sendFile(res, await fileForToken(String(req.params.token)))));

// Public assets such as the church logo (used by the share page and login screen).
api.use(publicDesignRoutes);

// About Canon: version information (no church data).
const PKG = JSON.parse(fs.readFileSync(path.join(config.root, 'package.json'), 'utf8')) as { version: string; license: string };
api.get('/about', (_req, res) => {
  res.json({
    name: 'Canon',
    version: PKG.version,
    license: PKG.license,
    schema: (get<{ user_version: number }>('PRAGMA user_version')?.user_version) ?? 0,
    node: process.versions.node,
  });
});

// ---------------------------------------------------------------- everything below needs a session

api.use(requireUser);
// the change log records who is making each change
api.use((req, _res, next) => asActor({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, via: 'web' }, next));
// read-only accounts: no members' contact details, notes or birth years (server/lib/viewer-scrub.ts)
api.use(viewerScrub);

api.patch('/me', h((req) => {
  const b = z.object({ lang: S.LangSchema.optional(), display_name: z.string().min(1).optional(), current_password: z.string().optional(), new_password: z.string().min(8).optional() }).parse(req.body);
  const u = req.user!;
  if (b.new_password) {
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!;
    if (!b.current_password || !verifyPassword(b.current_password, row.password_hash)) {
      throw Object.assign(new Error('Current password is wrong'), { status: 400 });
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.new_password), u.id);
  }
  if (b.lang) run('UPDATE users SET lang = ? WHERE id = ?', b.lang, u.id);
  if (b.display_name) run('UPDATE users SET display_name = ? WHERE id = ?', b.display_name, u.id);
  return getUser(u.id);
}));

// Viewers may change their own language/password above; other writes are blocked in requireUser.

api.get('/users', requireAdmin, h(() => listUsers()));
api.post('/users', requireAdmin, h((req) => {
  const b = z.object({ username: z.string().min(2), display_name: z.string().min(1), password: z.string().min(8), role: z.enum(['admin', 'editor', 'viewer']) }).parse(req.body);
  const u = createUser(b);
  logChange({ entity: 'users', entity_id: u.id, action: 'create', after: { username: u.username, display_name: u.display_name, role: u.role } });
  return u;
}));
api.patch('/users/:id', requireAdmin, h((req) => {
  const b = z.object({ role: z.enum(['admin', 'editor', 'viewer']).optional(), password: z.string().min(8).optional(), display_name: z.string().optional() }).parse(req.body);
  const uid = id(req);
  if (b.role && b.role !== 'admin' && uid === req.user!.id) throw Object.assign(new Error('You cannot demote yourself'), { status: 400 });
  const before = getUser(uid);
  if (b.role) run('UPDATE users SET role = ? WHERE id = ?', b.role, uid);
  if (b.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), uid);
    run('DELETE FROM sessions WHERE user_id = ?', uid);
  }
  if (b.display_name) run('UPDATE users SET display_name = ? WHERE id = ?', b.display_name, uid);
  const after = getUser(uid);
  const pick = (u: typeof after) => (u ? { username: u.username, display_name: u.display_name, role: u.role } : null);
  logChange({ entity: 'users', entity_id: uid, action: 'update', before: pick(before), after: pick(after), summary: b.password ? 'Password changed' : undefined });
  return after;
}));
api.delete('/users/:id', requireAdmin, h((req) => {
  const uid = id(req);
  if (uid === req.user!.id) throw Object.assign(new Error('You cannot delete yourself'), { status: 400 });
  const gone = getUser(uid);
  if (gone) logChange({ entity: 'users', entity_id: uid, action: 'delete', before: { username: gone.username, display_name: gone.display_name, role: gone.role } });
  run('DELETE FROM users WHERE id = ?', uid);
}));

// ---------------------------------------------------------------- settings & dashboard

api.get('/settings', h((req) => {
  const s = getSettings();
  // SMTP account details are for administrators only.
  return req.user?.role === 'admin' ? s : { ...s, smtp: { ...s.smtp, host: '', user: '', reply_to: '' } };
}));
api.patch('/settings', requireAdmin, h((req) => {
  const b = z.object({
    church_name: S.L10nSchema.optional(),
    church_address: z.string().max(500).optional(),
    church_contact: z.string().max(500).optional(),
    ccli_license: z.string().max(50).optional(),
    languages: z.array(S.LangSchema).min(1).max(8).optional(),
    bibles: z.record(S.LangSchema, z.string().max(20)).optional(),
    default_languages: z.array(S.LangSchema).min(1).max(MAX_SERVICE_LANGS).optional(),
    season_colours: z.boolean().optional(),
    bulletin_cover: z.enum(['plain', 'cross', 'logo', 'verse']).optional(),
    onboarded: z.boolean().optional(),
    bilingual_layout: z.enum(['parallel', 'stacked']).optional(),
    paper: z.enum(['a4-booklet', 'a4', 'a5', 'letter-booklet', 'letter']).optional(),
    slide_theme: z.enum(['dark', 'light']).optional(),
    default_start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  }).parse(req.body);
  return updateSettings(b as Partial<Settings>);
}));

api.get('/dashboard', h(() => {
  const today = new Date().toISOString().slice(0, 10);
  const in8w = new Date(Date.now() + 56 * 86400_000).toISOString().slice(0, 10);
  const upcoming = svc.listServices({ from: today, to: in8w });
  return {
    upcoming: upcoming.slice(0, 6).map((s) => ({ ...s, warnings: vol.rosterWarnings(s.id) })),
    members: reg.memberStats(),
    birthdays: reg.upcomingBirthdays(14).map((b) => ({ ...b, name: reg.displayName(b.person), person_id: b.person.id, person: undefined })),
    coworkers: reg.listCoworkers({ active: true }).length,
    library: {
      songs: get<{ n: number }>('SELECT COUNT(*) n FROM songs')!.n,
      texts: get<{ n: number }>('SELECT COUNT(*) n FROM texts')!.n,
      verses: get<{ n: number }>('SELECT COUNT(*) n FROM bible_verses')!.n,
      bibles: all<{ code: string }>('SELECT code FROM bible_translations WHERE code IN (SELECT DISTINCT translation FROM bible_verses) ORDER BY lang, code').map((b) => b.code),
    },
  };
}));

// ---------------------------------------------------------------- people & households

api.get('/people', h((req) => reg.listPeople({
  q: str(req.query.q), status: str(req.query.status),
  // read-only accounts search names only (searching by phone or e-mail would reveal them)
  names_only: req.user?.role === 'viewer',
  household_id: Number(req.query.household_id) || undefined,
  congregation_id: Number(req.query.congregation) || undefined,
  limit: Number(req.query.limit) || undefined, offset: Number(req.query.offset) || undefined,
})));
// CSV import/export now goes through the CSV framework (server/routes/csv.ts); these older URLs remain as aliases.
api.get('/people/export.csv', h((req, res) => legacyExport('members', req, res)));
api.post('/people/import', rawBody, h((req) => legacyImport('members', req)));
api.get('/people/:id', h((req) => {
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
api.post('/people', h((req) => {
  const b = S.PersonInput.parse(req.body);
  return reg.people.insert({ ...b, custom: reg.customFor({}, b.custom) ?? {} });
}));
api.patch('/people/:id', h((req) => {
  const pid = id(req);
  assertFresh(req, reg.people.get(pid), 'people', pid);
  const b = S.PersonInput.partial().parse(req.body);
  const custom = reg.customFor(reg.people.get(pid).custom, b.custom);
  return reg.people.update(pid, { ...b, ...(custom ? { custom } : {}) });
}));
// Settings → Security & privacy (administrators): the checklist, what was confirmed, who viewed member records; storage
api.get('/security', requireAdmin, h(() => ({ checklist: sec.securityChecklist(), security: getSettings().security })));
api.put('/security', requireAdmin, h((req) => updateSettings({ security: z.object({ disk_encryption: z.boolean() }).parse(req.body) }).security));
const viewQuery = (q: Record<string, string | undefined>) => ({
  person_id: Number(q.person) || undefined, user_id: Number(q.user) || undefined, via: q.via || undefined,
  from: q.from, to: q.to, q: q.q, page: Number(q.page) || 1, size: Number(q.size) || 50,
});
api.get('/member-views', requireAdmin, h((req) => sec.listMemberViews(viewQuery(req.query as Record<string, string | undefined>))));
api.get('/member-views.csv', requireAdmin, h((req, res) => {
  const r = sec.listMemberViews({ ...viewQuery(req.query as Record<string, string | undefined>), all: true });
  const HOW: Record<string, string> = { web: 'Member page', mcp: 'AI agent', export: 'CSV export' };
  sendCsv(res, `canon-member-views-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'Who', 'How', 'Member', 'Detail'],
    ...r.rows.map((v) => [v.at, v.user_name, HOW[v.via] ?? v.via, v.person_name, v.detail]),
  ]);
}));
api.get('/storage', requireAdmin, h(() => sec.storageReport()));
/** Settings → Member fields (administrators): the church's own fields on the member register. */
api.put('/member-fields', requireAdmin, h((req) => {
  const b = z.array(z.object({
    key: z.string().max(40).optional(), label: S.L10nSchema, type: z.enum(['text', 'date', 'yesno', 'choice']),
    options: z.array(S.L10nSchema).max(30).optional(), sensitive: z.boolean().optional(),
  })).max(30).parse(req.body);
  return updateSettings({ member_fields: cleanFieldDefs(b as MemberField[], getSettings().member_fields ?? []) }).member_fields;
}));
api.delete('/people/:id', h((req) => reg.people.remove(id(req))));
api.put('/people/:id/roles', h((req) => {
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

api.get('/households', h(() => reg.householdsWithMembers()));
api.post('/households', h((req) => reg.households.insert(S.HouseholdInput.parse(req.body))));
api.patch('/households/:id', h((req) => reg.households.update(id(req), S.HouseholdInput.partial().parse(req.body))));
api.delete('/households/:id', h((req) => reg.households.remove(id(req))));

api.get('/coworkers', h((req) => reg.listCoworkers({ active: req.query.active === '1' })));
api.post('/coworkers', h((req) => reg.coworkers.insert(S.CoworkerInput.parse(req.body))));
api.patch('/coworkers/:id', h((req) => reg.coworkers.update(id(req), S.CoworkerInput.partial().parse(req.body))));
api.delete('/coworkers/:id', h((req) => reg.coworkers.remove(id(req))));

// ---------------------------------------------------------------- volunteers

api.get('/teams', h(() => vol.teamsWithRoles()));
// a team is also a "Serving team" group (its roster); the two stay in step
api.post('/teams', h((req) => vol.teams.get(grp.createTeam(S.TeamInput.parse(req.body)))));
api.patch('/teams/:id', h((req) => {
  grp.updateTeam(id(req), S.TeamInput.partial().parse(req.body));
  return vol.teams.get(id(req));
}));
api.delete('/teams/:id', h((req) => grp.deleteTeam(id(req))));
api.post('/roles', h((req) => vol.roles.insert(S.RoleInput.parse(req.body))));
api.patch('/roles/:id', h((req) => vol.roles.update(id(req), S.RoleInput.partial().parse(req.body))));
api.delete('/roles/:id', h((req) => vol.roles.remove(id(req))));
api.put('/roles/:id/members', h((req) => vol.setRoleMembers(id(req), z.array(z.number().int()).parse(req.body.person_ids))));

api.get('/unavailability', h((req) => vol.listUnavailability(str(req.query.from), str(req.query.to))));
api.post('/unavailability', h((req) => vol.unavailability.insert(S.UnavailabilityInput.parse(req.body))));
api.delete('/unavailability/:id', h((req) => vol.unavailability.remove(id(req))));

api.get('/rota', h((req) => {
  const from = str(req.query.from) ?? new Date().toISOString().slice(0, 10);
  const to = str(req.query.to) ?? new Date(Date.now() + 56 * 86400_000).toISOString().slice(0, 10);
  return vol.rota(from, to, Number(req.query.congregation) || undefined);
}));
api.post('/rota/autofill', h((req) => vol.autofill(z.array(z.number().int()).min(1).parse(req.body.service_ids))));

api.post('/services/:id/assignments', h((req) => {
  const b = z.object({ role_id: z.number().int(), person_id: z.number().int(), status: z.enum(['scheduled', 'confirmed', 'declined']).optional() }).parse(req.body);
  return vol.assign(id(req), b.role_id, b.person_id, b.status);
}));
api.patch('/assignments/:id', h((req) => vol.assignments.update(id(req), z.object({ status: z.enum(['scheduled', 'confirmed', 'declined']).optional(), notes: z.string().nullable().optional() }).parse(req.body))));
api.delete('/assignments/:id', h((req) => vol.assignments.remove(id(req))));
api.get('/services/:id/warnings', h((req) => vol.rosterWarnings(id(req))));

// ---------------------------------------------------------------- library

api.get('/songs', h((req) => lib.searchSongs(str(req.query.q), str(req.query.category))));
// When each song was last sung (before ?before=YYYY-MM-DD, default today) and how often in the 12 months before.
api.get('/songs/usage', h((req) => {
  const before = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().parse(str(req.query.before));
  return Object.fromEntries([...songUsage(null, { before })].map(([sid, u]) => [sid, { last_used: u.last_used, times_12m: u.times }]));
}));
api.get('/songs/:id', h((req) => lib.songs.get(id(req))));
api.post('/songs', h((req) => lib.songs.insert(S.SongInput.parse(req.body))));
api.patch('/songs/:id', h((req) => lib.songs.update(id(req), S.SongInput.partial().parse(req.body))));
api.delete('/songs/:id', h((req) => lib.songs.remove(id(req))));

api.get('/texts', h((req) => lib.searchTexts(str(req.query.q), str(req.query.category))));
api.get('/texts/:id', h((req) => lib.texts.get(id(req))));
api.post('/texts', h((req) => lib.texts.insert(S.TextInput.parse(req.body))));
api.patch('/texts/:id', h((req) => lib.texts.update(id(req), S.TextInput.partial().parse(req.body))));
api.delete('/texts/:id', h((req) => lib.texts.remove(id(req))));

api.get('/bible/translations', h(() => bible.translations()));
api.get('/bible/catalog', h(() => {
  const have = new Map(bible.translations().map((t) => [t.code, t.verses]));
  return Object.values(BIBLE_SOURCES).map((b) => ({ ...b, imported: have.get(b.code) ?? 0, job: bible.importJobs.get(b.code) ?? null }));
}));
api.post('/bible/import', requireAdmin, h((req) => bible.startImport(z.string().parse(req.body.code))));
api.get('/bible/passage', h((req) => {
  const ref = z.string().min(1).parse(req.query.ref);
  const lang = S.LangSchema.parse(req.query.lang ?? 'en') as Lang;
  const translation = str(req.query.translation)?.toUpperCase();
  if (translation) bible.checkTranslation(translation, lang); // 404 not installed, 400 wrong language
  return bible.passage(ref, lang, translation);
}));
api.get('/bible/search', h((req) => bible.searchBible(z.string().min(2).parse(req.query.q), str(req.query.translation) ?? 'KJV')));

// ---------------------------------------------------------------- service records (attendance, visitors, offerings)

const recWho = (req: Request) => ({ name: req.user?.display_name ?? '', admin: req.user?.role === 'admin' });
const VisitorSchema = z.object({ name: z.string().max(200), contact: z.string().max(300).optional(), source: z.string().max(300).optional(), follow_up_by: z.string().max(200).optional(), notes: z.string().max(2000).optional(), status: z.enum(['new', 'contacted', 'returning', 'joined']).optional(), prayer: z.string().max(1500).optional(), about: z.string().max(200).optional() });
const RecordInput = z.object({
  attendance: z.number().int().min(0).max(100000).nullable().optional(),
  children: z.number().int().min(0).max(100000).nullable().optional(),
  online: z.number().int().min(0).max(1000000).nullable().optional(),
  visitors: z.array(VisitorSchema).max(500).optional(),
  notes: z.string().max(20000).nullable().optional(),
  offerings: z.array(z.object({ fund: z.string().max(100), method: z.string().max(20), amount: z.number().int().min(0), currency: z.string().max(3).optional(), note: z.string().max(300).optional() })).max(200).optional(),
  foreign_cash: z.record(z.string().regex(/^[A-Z]{3}$/), z.object({ cash: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(1000000)).optional(), total: z.number().int().min(0).optional(), converted: z.number().int().min(0).nullable().optional() })).optional(),
  cash: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(1000000)).optional(),
  counters: z.array(z.string().max(120)).max(10).optional(),
  counted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currency: z.string().max(5).optional(),
});
api.get('/records', h((req) => rec.listRecords({ from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined })
  .map((r) => (canSeeMoney(req) ? r : rec.listRowForViewer(r)))));
// reports (Records → Reports): offerings for editors and administrators only; visitors' contact details likewise
const reportPeriod = (req: Request) => reports.period({ from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined });
const canSeeMoney = (req: Request) => req.user?.role === 'admin' || req.user?.role === 'editor';
api.get('/reports/attendance', h((req) => reports.attendanceReport(reportPeriod(req))));
api.get('/reports/offerings', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Offerings are only shown to editors and administrators.');
  return reports.offeringsReport(reportPeriod(req));
}));
api.get('/reports/visitors', h((req) => reports.visitorsReport(reportPeriod(req), { contact: canSeeMoney(req) })));
api.get('/reports/serving', h((req) => reports.servingReport(reportPeriod(req))));
api.get('/reports/songs', h((req) => reports.songsReport(reportPeriod(req))));
api.get('/reports/scripture', h((req) => reports.scriptureReport({
  from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined,
  years: (str(req.query.years) ?? '').split(',').map(Number).filter(Boolean),
})));
api.get('/reports/membership', h((req) => reports.membershipReport(reportPeriod(req))));
api.get('/services/:id/record', h((req) => {
  const r = rec.recordFor(id(req));
  return canSeeMoney(req) ? r : rec.forViewer(r);
}));
// visitor form: settings (administrators), a service's form (editors), the review queue (editors)
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
api.get('/visitor-form-settings', h(() => vf.formSettings()));
api.put('/visitor-form-settings', requireAdmin, h((req) => vf.saveFormSettings(z.object({
  enabled: z.boolean().optional(), prayer: z.boolean().optional(), welcome: S.L10nSchema.optional(), consent: S.L10nSchema.optional(),
  days_after: z.number().int().min(0).max(14).optional(),
  sources: z.array(S.L10nSchema).max(12).optional(),
  abouts: z.array(S.L10nSchema).max(12).optional(),
}).parse(req.body))));
api.get('/services/:id/visitor-form', h((req) => vf.serviceFormInfo(id(req), origin(req))));
api.put('/services/:id/visitor-form', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators can change the visitor form.');
  return vf.setServiceForm(id(req), z.object({ enabled: z.boolean(), bulletin: z.boolean().optional(), slides: z.boolean().optional() }).parse(req.body), origin(req));
}));
api.get('/services/:id/visitor-cards', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.cardsFor(id(req));
}));
api.post('/visitor-cards/:id/accept', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.acceptCard(id(req), recWho(req));
}));
api.delete('/visitor-cards/:id', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.discardCard(id(req));
}));
api.delete('/services/:id/record', requireAdmin, h((req) => rec.deleteRecord(id(req), recWho(req))));
api.put('/services/:id/record', h((req) => {
  const cur = rec.recordFor(id(req));
  if (cur.saved) assertFresh(req, cur, 'service_records', cur.id);
  return rec.saveRecord(id(req), RecordInput.parse(req.body) as Partial<ServiceRecord>, recWho(req));
}));
api.post('/services/:id/record/sign', h((req) => rec.sign(id(req), z.object({ name: z.string().max(120), image: z.string().max(400_000) }).parse(req.body), recWho(req))));
api.post('/services/:id/record/finish', h((req) => rec.finishSigning(id(req), recWho(req))));
api.post('/services/:id/record/unsign', h((req) => rec.unsign(id(req), z.object({ name: z.string().max(120) }).parse(req.body).name, recWho(req))));
api.post('/services/:id/record/verify', h((req) => rec.setVerified(id(req), z.object({ verified: z.boolean() }).parse(req.body).verified, recWho(req))));
api.put('/offering-settings', requireAdmin, h((req) => {
  const b = z.object({ currency: z.string().max(5), funds: z.array(z.string().min(1).max(100)).min(1).max(30), signing: z.enum(['paper', 'screen']).optional(), min_counters: z.number().int().min(2).max(6).optional() }).parse(req.body);
  const cur = getSettings().offering;
  return updateSettings({ offering: { currency: b.currency, funds: [...new Set(b.funds.map((f) => f.trim()).filter(Boolean))], signing: b.signing ?? cur.signing ?? 'paper', min_counters: b.min_counters ?? cur.min_counters ?? 2 } }).offering;
}));

// ---------------------------------------------------------------- library check (languages that drift apart, duplicates)

api.get('/library/checks', h((req) => libraryChecks({ bibles: req.query.bibles !== '0' })));

// ---------------------------------------------------------------- slide backgrounds (Library)

const rawPicture = express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '11mb' });
api.get('/backgrounds', h(() => bg.listBackgrounds()));
api.post('/backgrounds', rawPicture, h((req) => bg.saveBackground(null, str(req.query.name), req.get('content-type') ?? '', req.body as Buffer)));
api.put('/backgrounds/:id', rawPicture, h((req) => bg.saveBackground(id(req), undefined, req.get('content-type') ?? '', req.body as Buffer)));
api.patch('/backgrounds/:id', h((req) => bg.renameBackground(id(req), z.object({ name: z.string().max(120) }).parse(req.body).name)));
api.delete('/backgrounds/:id', h((req) => bg.deleteBackground(id(req))));

// ---------------------------------------------------------------- congregations

api.get('/congregations', h(() => cong.listCongregations()));
const CongregationInput = z.object({
  name: S.L10nSchema.optional(), code: z.string().max(8).optional(), languages: z.array(S.LangSchema).max(3).optional(),
  color: z.string().max(20).optional(), active: z.boolean().optional(), sort: z.number().int().optional(),
});
api.post('/congregations', requireAdmin, h((req) => cong.saveCongregation(null, CongregationInput.parse(req.body) as Partial<cong.Congregation>)));
api.patch('/congregations/:id', requireAdmin, h((req) => cong.saveCongregation(id(req), CongregationInput.parse(req.body) as Partial<cong.Congregation>)));
api.delete('/congregations/:id', requireAdmin, h((req) => cong.deleteCongregation(id(req))));

// ---------------------------------------------------------------- templates

api.get('/templates', h(() => svc.templates.list('', [], 'id').map(svc.withBuiltin)));
api.get('/templates/:id', h((req) => svc.withBuiltin(svc.templates.get(id(req)))));
api.post('/templates', h((req) => {
  const b = S.TemplateInput.parse(req.body);
  return svc.withBuiltin(svc.templates.insert({ description: {}, items: [], ...b, ref: cleanRef('service_template', b.ref) ?? null }));
}));
api.patch('/templates/:id', h((req) => {
  const tid = id(req);
  const b = S.TemplateInput.partial().parse(req.body);
  return svc.withBuiltin(svc.templates.update(tid, { ...b, ...(b.ref !== undefined ? { ref: cleanRef('service_template', b.ref, tid) } : {}) }));
}));
/** Archive / restore (editors). The church default can't be archived. */
api.put('/templates/:id/hidden', h((req) => svc.setServiceTemplateHidden(id(req), z.object({ hidden: z.boolean() }).parse(req.body).hidden, getSettings().default_service_template_id ?? null)));
/** Delete an archived template (administrators; never a built-in one). */
api.delete('/templates/:id', requireAdmin, h((req) => {
  const tid = id(req);
  svc.deleteServiceTemplate(tid);
  if (getSettings().default_service_template_id === tid) updateSettings({ default_service_template_id: null });
}));
/** The church's usual service template: New service starts from it (administrators). */
api.put('/templates-default', requireAdmin, h((req) => {
  const tid = z.object({ template_id: z.number().int().positive().nullable() }).parse(req.body).template_id;
  if (tid != null) {
    svc.templates.get(tid);
    svc.templates.update(tid, { hidden: false });
  }
  return { default_service_template_id: updateSettings({ default_service_template_id: tid }).default_service_template_id };
}));

// ---------------------------------------------------------------- services

api.get('/services', h((req) => svc.listServices({ from: str(req.query.from), to: str(req.query.to), limit: Number(req.query.limit) || undefined, congregation_id: Number(req.query.congregation) || undefined })));
api.post('/services', h((req) => {
  const b = S.ServiceInput.extend({ template_id: z.number().int().nullable().optional() }).parse(req.body);
  const { template_id, ...input } = b;
  return svc.createService({ ...input, ref: cleanRef('service', input.ref) ?? null }, template_id);
}));
api.get('/services/:id', h((req) => svc.getServiceFull(id(req))));
api.patch('/services/:id', h((req) => {
  const sid = id(req);
  assertFresh(req, svc.services.get(sid), 'services', sid);
  const b = S.ServiceInput.partial().parse(req.body);
  return svc.services.update(sid, { ...b, ...(b.ref !== undefined ? { ref: cleanRef('service', b.ref, sid) } : {}) });
}));
api.delete('/services/:id', h((req) => {
  rec.assertServiceDeletable(id(req));
  return svc.services.remove(id(req));
}));
api.post('/services/:id/duplicate', h((req) => {
  const b = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), with_roster: z.boolean().optional() }).parse(req.body);
  return svc.duplicateService(id(req), b.date, b.with_roster);
}));
api.post('/services/:id/save-as-template', h((req) => svc.saveAsTemplate(id(req), S.L10nSchema.parse(req.body.name))));
api.get('/services/:id/render', h((req) => renderService(id(req))));
api.post('/services/:id/share', h((req) => ({ token: svc.setShare(id(req), !!req.body.enabled) })));
api.get('/services/:id/export.docx', h(async (req, res) => {
  const r = renderService(id(req));
  const buf = await serviceDocx(r);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="order-of-service-${r.date}.docx"`);
  res.send(buf);
}));
api.get('/services/:id/slides.pptx', h(async (req, res) => {
  const langs = typeof req.query.langs === 'string' && req.query.langs ? (req.query.langs.split(',').slice(0, MAX_SERVICE_LANGS) as Lang[]) : null;
  sendFile(res, await buildFile(id(req), 'slides_pptx', langs));
}));
api.get('/services/:id/freeshow.project', h(async (req, res) => {
  const r = renderService(id(req));
  const file = await freeshowProject(r);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="canon-${r.date}.project"`);
  res.send(JSON.stringify(file));
}));

api.post('/services/:id/items', h((req) => {
  const b = z.object({ item: S.ServiceItemInput, position: z.number().int().min(0).optional() }).parse(req.body);
  return svc.addItem(id(req), b.item, b.position);
}));
api.patch('/items/:id', h((req) => svc.updateItem(id(req), S.ServiceItemInput.partial().parse(req.body))));
api.delete('/items/:id', h((req) => svc.deleteItem(id(req))));
api.put('/services/:id/order', h((req) => svc.reorderItems(id(req), z.array(z.number().int()).parse(req.body.item_ids))));

// ---------------------------------------------------------------- MCP administration

api.get('/mcp/config', requireAdmin, h(() => getSettings().mcp));
api.put('/mcp/config', requireAdmin, h((req) => updateSettings({ mcp: S.McpConfigSchema.parse(req.body) }).mcp));
/** AI activity log, newest first, with filters and paging. */
const auditQuery = (q: Record<string, string | undefined>) => ({
  user_id: Number(q.user) || undefined, client: q.client || undefined, tool: q.tool || undefined, module: q.module || undefined,
  ok: q.result === 'ok' ? true : q.result === 'error' ? false : undefined, from: q.from, to: q.to, q: q.q,
  page: Number(q.page) || 1, size: Number(q.size) || 50,
});
api.get('/mcp/audit', requireAdmin, h((req) => listAudit(auditQuery(req.query as Record<string, string | undefined>))));
/** The AI activity log as CSV: every row matching the filters (up to 20,000). */
api.get('/mcp/audit.csv', requireAdmin, h((req, res) => {
  const r = listAudit({ ...auditQuery(req.query as Record<string, string | undefined>), all: true });
  const rows = r.rows as { at: string; user_name: string | null; client_name: string | null; client_id: string | null; tool: string; module: string | null; access: string | null; ok: number; error: string | null; args: string | null }[];
  sendCsv(res, `canon-ai-activity-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'User', 'Client', 'Tool', 'Module', 'Access', 'Result', 'Error', 'Arguments'],
    ...rows.map((a) => [a.at, a.user_name, a.client_name ?? a.client_id, a.tool, a.module, a.access, a.ok ? 'OK' : 'Error', a.error, a.args]),
  ]);
}));

/** The change log (administrators): who changed what and when; a record's history with entity + entity_id. */
const changeQuery = (q: Record<string, string | undefined>) => ({
  entity: q.entity || undefined, entity_id: Number(q.entity_id) || undefined, user_id: Number(q.user) || undefined,
  via: (['web', 'mcp', 'import', 'system'].includes(q.via ?? '') ? q.via : undefined) as 'web' | undefined,
  action: q.action || undefined, from: q.from, to: q.to, q: q.q, page: Number(q.page) || 1, size: Number(q.size) || 50,
});
api.get('/change-log', requireAdmin, h((req) => {
  const r = listChanges(changeQuery(req.query as Record<string, string | undefined>));
  return { ...r, users: changeLogUsers(), entities: ENTITY_LABEL };
}));
/** The change log as CSV: every row matching the filters (up to 20,000), one row per change with its fields. */
api.get('/change-log.csv', requireAdmin, h((req, res) => {
  const r = listChanges({ ...changeQuery(req.query as Record<string, string | undefined>), all: true });
  const val = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  const VIA: Record<string, string> = { web: 'In Canon', mcp: 'AI agent', import: 'CSV import', system: 'Canon' };
  const ACTION: Record<string, string> = { create: 'Added', update: 'Changed', delete: 'Deleted' };
  sendCsv(res, `canon-change-log-${new Date().toISOString().slice(0, 10)}.csv`, [
    ['Time (UTC)', 'Who', 'How', 'Client', 'What', 'Record', 'Action', 'Summary', 'Changes'],
    ...r.rows.map((c) => [
      c.at, c.user_name, VIA[c.via] ?? c.via, c.client, ENTITY_LABEL[c.entity]?.en ?? c.entity, c.name, ACTION[c.action] ?? c.action, c.summary,
      Object.entries(c.changes ?? {}).map(([k, [a, b]]) => `${k}: ${val(a)} → ${val(b)}`).join('; '),
    ]),
  ]);
}));
api.put('/log-retention', requireAdmin, h((req) => {
  const b = z.object({
    change_log_months: z.number().int().min(0).max(120).optional(), mcp_audit_months: z.number().int().min(0).max(120).optional(),
    visitor_contact_months: z.number().int().min(0).max(120).optional(), archive_years: z.number().int().min(0).max(30).optional(),
  }).parse(req.body);
  return updateSettings({ retention: { ...getSettings().retention, ...b } }).retention;
}));
// archives (administrators): preview / run, list, open read-only, download
api.post('/archives/run', requireAdmin, h((req) => arc.runArchive(!!z.object({ dry_run: z.boolean().optional() }).parse(req.body ?? {}).dry_run)));
api.get('/archives', requireAdmin, h(() => arc.listArchives()));
const yearOf = (req: Request) => {
  const y = Number(req.params.year);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) throw Object.assign(new Error('Bad year'), { status: 400 });
  return y;
};
api.get('/archives/:year/records', requireAdmin, h((req) => arc.archivedRecords(yearOf(req))));
api.get('/archives/:year/changes', requireAdmin, h((req) => arc.archivedChanges(yearOf(req), { page: Number(req.query.page) || 1, q: str(req.query.q) })));
api.get('/archives/:year/download', requireAdmin, (req, res, next) => {
  try {
    res.download(arc.archivePath(yearOf(req)));
  } catch (e) {
    next(e);
  }
});
api.get('/mcp/tools', requireAdmin, h(() => toolCatalog()));
api.get('/mcp/endpoint', requireAdmin, h((req) => ({
  url: `${externalBase(req)}/mcp`,
  public_url_set: !!publicUrl(),
  public_url: getSettings().public_url,
  trust_proxy: getSettings().trust_proxy,
  /** set by an IT administrator in the environment; overrides the Settings value */
  env_override: !!config.publicUrl,
})));
api.put('/mcp/public-url', requireAdmin, h((req) => {
  const b = z.object({ public_url: z.string().max(300), trust_proxy: z.boolean().optional() }).parse(req.body);
  const n = normalisePublicUrl(b.public_url);
  if ('error' in n) throw Object.assign(new Error(n.error), { status: 400 });
  const s = updateSettings({ public_url: n.url, ...(b.trust_proxy !== undefined ? { trust_proxy: b.trust_proxy } : {}) });
  return { public_url: s.public_url, trust_proxy: s.trust_proxy };
}));
/** Check that the public address really reaches this Canon (fetches its OAuth metadata over the internet). */
api.post('/mcp/check-public-url', requireAdmin, h(async (req) => {
  const n = normalisePublicUrl(z.string().max(300).parse(req.body.public_url ?? publicUrl()));
  if ('error' in n) return { ok: false, message: n.error };
  if (!n.url) return { ok: false, message: 'No public address entered.' };
  try {
    const r = await fetch(`${n.url}/.well-known/oauth-protected-resource`, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    if (!r.ok) return { ok: false, message: `The address answered with HTTP ${r.status}. Is the tunnel pointing at this Canon (port ${config.port})?` };
    const meta = (await r.json().catch(() => null)) as { resource?: string } | null;
    if (!meta?.resource?.endsWith('/mcp')) return { ok: false, message: 'Something answered at that address, but it is not Canon.' };
    if (meta.resource.replace(/\/+$/, '') !== `${n.url}/mcp`) {
      return { ok: false, message: `Canon answered, but it reports ${meta.resource}. Save the public address first, then check again.` };
    }
    return { ok: true, message: 'Canon is reachable at this address. You can add the connector in claude.ai.' };
  } catch (e) {
    return { ok: false, message: `Could not reach ${n.url} (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}). Check the tunnel is running.` };
  }
}));
api.get('/mcp/grants', requireAdmin, h(() => listGrants()));
api.delete('/mcp/grants/:grant', requireAdmin, h((req) => revokeGrant(String(req.params.grant))));

// ---------------------------------------------------------------- feature modules (v0.2)

api.use(libraryRoutes);
api.use(groupRoutes);
api.use(emailRoutes);
api.use(backupRoutes);
api.use(designRoutes);
api.use(presentationRoutes);
api.use(csvRoutes);
api.use(bibleRoutes);

// ---------------------------------------------------------------- errors

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') });
  }
  if (err instanceof RefError) return res.status(400).json({ error: err.message });
  const e = err as { status?: number; message?: string; code?: string };
  if (e.code === 'ERR_SQLITE_ERROR' && /UNIQUE|FOREIGN KEY|CHECK/.test(e.message ?? '')) {
    return res.status(409).json({ error: e.message });
  }
  if (!e.status || e.status >= 500) console.error(err);
  res.status(e.status ?? 500).json({ error: e.message ?? 'Server error' });
});
