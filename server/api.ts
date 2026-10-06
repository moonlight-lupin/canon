import fs from 'node:fs';
import { roleOffered } from './repo/access-roles.ts';
import { forAttendees, serviceByAttendeeToken } from './repo/attendee-link.ts';
import { publicUrl } from './lib/public-url.ts';
import { addressForOthers } from './lib/lan.ts';
import { lendingSelfRoutes } from './routes/lending-self.ts';
import { lendingRoutes } from './routes/lending.ts';
import { equipmentRoutes } from './routes/equipment.ts';
import { lendingCounts } from './repo/lending.ts';
import { equipmentCounts } from './repo/equipment.ts';
import path from 'node:path';
// REST API for the web app. All business logic lives in ./repo; this file wires HTTP to it.
import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import * as S from '../shared/schemas.ts';
import type { Lang } from '../shared/types.ts';
import { RefError } from '../shared/bible.ts';
import { BIBLE_SOURCES, MAX_SERVICE_LANGS, langInfo } from '../shared/languages.ts';
import { libraryRoutes } from './routes/library.ts';
import { spaceRoutes } from './routes/spaces.ts';
import { groupRoutes } from './routes/groups.ts';
import { emailRoutes } from './routes/email.ts';
import { backupRoutes } from './routes/backups.ts';
import { designRoutes, publicDesignRoutes } from './routes/design.ts';
import { presentationRoutes } from './routes/presentation.ts';
import { csvRoutes } from './routes/csv.ts';
import { bibleRoutes } from './routes/bible.ts';
import { calendarRoutes } from './routes/calendar.ts';
import { h, id, sendFile, str } from './routes/helpers.ts';
import { peopleRoutes } from './routes/people.ts';
import { recordRoutes } from './routes/records.ts';
import { serviceRoutes } from './routes/services.ts';
import { adminRoutes } from './routes/admin.ts';
import {
  authenticate, createUser, endSession, getUser, hashPassword, listUsers, loginFailed, loginOk, loginThrottle,
  requireAdmin, requireUser, sessionUser, startSession, userCount, verifyPassword, wallOf, secondStep, secondStepTicket, LOCK_MINUTES,
  firstAdminId, memberLinkProblem, personLinkProblem, twoStepRequired,
} from './auth.ts';
import { all, get, run } from './db.ts';
import { config } from './config.ts';
import { asActor } from './lib/actor.ts';
import { viewerScrub } from './lib/viewer-scrub.ts';
import { ledGroups } from './lib/leaders.ts';
import { logChange } from './repo/changelog.ts';
import * as reg from './repo/registers.ts';
import * as vol from './repo/volunteers.ts';
import * as lib from './repo/library.ts';
import * as bible from './repo/bible.ts';
import * as svc from './repo/services.ts';
import * as cong from './repo/congregations.ts';
import * as bg from './repo/backgrounds.ts';
import { libraryChecks } from './repo/checks.ts';
import * as grp from './repo/groups.ts';
import { renderService } from './repo/render.ts';
import { songUsage } from './repo/history.ts';
import { getSettings, setMeta, updateSettings, type Settings } from './repo/settings.ts';
import { fileForToken } from './repo/downloads.ts';
import { isAdmin, roleDef } from './lib/permissions.ts';
import { hashCode, newRecoveryCodes, newSecret, otpauthUri, verifyTotp } from './lib/totp.ts';
import QRCode from 'qrcode';
import { withRights } from '../shared/bible-rights.ts';
import { seesSensitiveFields } from './lib/permissions.ts';
import { allows } from '../shared/permissions.ts';

export const api = express.Router();

// ---------------------------------------------------------------- public: session & setup

api.get('/me', (req, res) => {
  const u = sessionUser(req);
  // leads: the groups this account's member leads (the screens offer recording their meetings)
  // role_def: what the account's role allows (the screens use it to show what may be changed)
  // first_admin: the administrator who set Canon up (reminded to link their account to their member record)
  res.json({ user: u ? { ...u, csrf: undefined, leads: ledGroups(u.person_id), role_def: roleDef(u.role), first_admin: u.id === firstAdminId() } : null, csrf: u?.csrf ?? null, needsSetup: userCount() === 0 });
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
  setMeta('first_admin_id', String(user.id));
  if (b.ui_lang) run('UPDATE users SET lang = ? WHERE id = ?', b.ui_lang, user.id);
  // onboarded: false says so explicitly; otherwise a church name alone looks like a v0.1 church set up before onboarding
  const patch: Partial<Settings> = { onboarded: false };
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
  const r = authenticate(b.username, b.password);
  if (!r) {
    loginFailed(ip);
    throw Object.assign(new Error('Wrong username or password'), { status: 401 });
  }
  if ('locked' in r) throw Object.assign(new Error(`This account is locked for ${LOCK_MINUTES} minutes after too many wrong passwords. Try again later, or ask an administrator to reset the password.`), { status: 429 });
  loginOk(ip);
  // two-step sign-in: the code comes next (POST /login/code)
  if ('second_step' in r) return { second_step: true, ticket: secondStepTicket(r.second_step) };
  const csrf = startSession(req, res, r.user);
  return { user: r.user, csrf };
}));

api.post('/login/code', h((req, res) => {
  const ip = req.ip ?? '';
  if (loginThrottle(ip)) throw Object.assign(new Error('Too many attempts — try again in 15 minutes'), { status: 429 });
  const b = z.object({ ticket: z.string().max(100), code: z.string().max(20) }).parse(req.body);
  const user = secondStep(b.ticket, b.code);
  if (!user) {
    loginFailed(ip);
    throw Object.assign(new Error('That code is not right (or has expired). Sign in again if it keeps failing.'), { status: 401 });
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
  // a licensed version's text goes online only if its licence allows it (Library → Bible); else the reference only
  return withRights(renderService(full), 'online');
}));

// Public bulletin for attendees (one link per service): the order, words and announcements — no serving team or notes.
api.get('/bulletin/:token', h((req) => withRights(forAttendees(renderService(serviceByAttendeeToken(String(req.params.token)))), 'online')));

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

// lending library self-service: members on their phones, no Canon account (routes/lending-self.ts)
api.use(lendingSelfRoutes);

api.use(requireUser);
// the change log records who is making each change
api.use((req, _res, next) => asActor({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, via: 'web', congregation_id: wallOf(req.user), sensitive: seesSensitiveFields(req.user) }, next));
// read-only accounts: no members' contact details, notes or birth years (server/lib/viewer-scrub.ts)
api.use(viewerScrub);

// where links for other people point (share links, e-mails): the public address, else this computer's network address
api.get('/link-base', (req, res) => {
  res.json({ base: addressForOthers(`${req.protocol}://${req.get('host')}`), public: !!publicUrl() });
});

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

// ---------------------------------------------------------------- two-step sign-in (my profile)

api.post('/me/two-step/setup', h(async (req) => {
  const secret = newSecret();
  run('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', secret, req.user!.id);
  const issuer = `Canon · ${(getSettings().church_name.en || Object.values(getSettings().church_name).find(Boolean) || 'church').slice(0, 40)}`;
  const uri = otpauthUri(secret, req.user!.username, issuer);
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}));
api.post('/me/two-step/enable', h((req) => {
  const b = z.object({ code: z.string().max(20) }).parse(req.body);
  const row = get<{ totp_secret: string | null }>('SELECT totp_secret FROM users WHERE id = ?', req.user!.id);
  if (!row?.totp_secret || !verifyTotp(row.totp_secret, b.code)) throw Object.assign(new Error('That code is not right. Check the time on your phone and try the newest code.'), { status: 400 });
  const codes = newRecoveryCodes();
  run('UPDATE users SET totp_enabled = 1, recovery_codes = ? WHERE id = ?', JSON.stringify(codes.map(hashCode)), req.user!.id);
  logChange({ entity: 'users', entity_id: req.user!.id, action: 'update', summary: 'Two-step sign-in turned on' });
  return { recovery_codes: codes };
}));
api.post('/me/two-step/disable', h((req) => {
  const b = z.object({ password: z.string() }).parse(req.body);
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
  if (!verifyPassword(b.password, row.password_hash)) throw Object.assign(new Error('Password is wrong'), { status: 400 });
  if (twoStepRequired(req.user)) throw Object.assign(new Error(getSettings().security.require_all_2fa ? 'This church requires two-step sign-in for every account.' : 'This church requires two-step sign-in for administrators.'), { status: 400 });
  run("UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = '[]' WHERE id = ?", req.user!.id);
  logChange({ entity: 'users', entity_id: req.user!.id, action: 'update', summary: 'Two-step sign-in turned off' });
  return { ok: true };
}));

// Viewers may change their own language/password above; other writes are blocked in requireUser.

api.get('/users', requireAdmin, h(() => listUsers()));
api.post('/users', requireAdmin, h((req) => {
  const b = z.object({
    username: z.string().min(2), display_name: z.string().min(1), password: z.string().min(8), role: z.string().min(1).max(40),
    /** the church member the account belongs to (required, except for an external guest) */
    person_id: z.number().int().nullable().optional(),
  }).parse(req.body);
  if (!roleOffered(b.role)) throw Object.assign(new Error('That role does not exist or is archived.'), { status: 400 });
  const personId = b.person_id ?? null;
  const problem = (personId && personLinkProblem(personId, null)) || memberLinkProblem(null, b.role, personId);
  if (problem) throw Object.assign(new Error(problem), { status: 400 });
  const { person_id: _p, ...fields } = b;
  const created = createUser(fields);
  if (personId) run('UPDATE users SET person_id = ? WHERE id = ?', personId, created.id);
  const u = getUser(created.id)!;
  logChange({ entity: 'users', entity_id: u.id, action: 'create', after: { username: u.username, display_name: u.display_name, role: u.role, person_id: u.person_id ?? null } });
  return u;
}));
api.patch('/users/:id', requireAdmin, h((req) => {
  const b = z.object({
    role: z.string().min(1).max(40).optional(), password: z.string().min(8).optional(), display_name: z.string().optional(),
    person_id: z.number().int().nullable().optional(),
    congregation_id: z.number().int().nullable().optional(),
    /** a lost phone: turn the account's two-step sign-in off so they can sign in and set it up again */
    reset_two_step: z.literal(true).optional(),
  }).parse(req.body);
  if (b.reset_two_step) run("UPDATE users SET totp_enabled = 0, totp_secret = NULL, recovery_codes = '[]' WHERE id = ?", id(req));
  const uid = id(req);
  if (b.role && !roleDef(b.role).admin && uid === req.user!.id) throw Object.assign(new Error('You cannot demote yourself'), { status: 400 });
  const before = getUser(uid);
  if (!before) throw Object.assign(new Error('That account does not exist.'), { status: 404 });
  if (b.role && !roleOffered(b.role, before.role)) throw Object.assign(new Error('That role does not exist or is archived.'), { status: 400 });
  // a change of role or member keeps the account a church member's (or an external guest's)
  if (b.role !== undefined || b.person_id !== undefined) {
    const role = b.role ?? before.role;
    const personId = b.person_id !== undefined ? b.person_id : before.person_id ?? null;
    const problem = (b.person_id && personLinkProblem(b.person_id, uid)) || memberLinkProblem(uid, role, personId);
    if (problem) throw Object.assign(new Error(problem), { status: 400 });
  }
  if (b.role) run('UPDATE users SET role = ? WHERE id = ?', b.role, uid);
  if (b.password) {
    // a new password also unlocks the account
    run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', hashPassword(b.password), uid);
    run('DELETE FROM sessions WHERE user_id = ?', uid);
  }
  if (b.display_name) run('UPDATE users SET display_name = ? WHERE id = ?', b.display_name, uid);
  if (b.congregation_id !== undefined) run('UPDATE users SET congregation_id = ? WHERE id = ?', b.congregation_id, uid);
  if (b.person_id !== undefined) run('UPDATE users SET person_id = ? WHERE id = ?', b.person_id, uid);
  const after = getUser(uid);
  const pick = (u: typeof after) => (u ? { username: u.username, display_name: u.display_name, role: u.role, person_id: u.person_id ?? null, congregation_id: u.congregation_id ?? null } : null);
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
  return isAdmin(req.user) ? s : { ...s, smtp: { ...s.smtp, host: '', user: '', reply_to: '' } };
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

api.get('/dashboard', h((req) => {
  const today = new Date().toISOString().slice(0, 10);
  // the optional modules' numbers, when they are on and this account may read them
  const on = getSettings().modules;
  const role = roleDef(req.user!.role);
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
      // the installed versions, by language (a verse count says little)
      bibles: all<{ code: string; lang: string; name: string }>('SELECT code, lang, name FROM bible_translations WHERE code IN (SELECT DISTINCT translation FROM bible_verses) ORDER BY lang, code'),
    },
    lending: on.lending !== false && allows(role, 'lending', 'read') ? lendingCounts() : null,
    equipment: on.equipment !== false && allows(role, 'equipment', 'read') ? equipmentCounts() : null,
  };
}));

// ---------------------------------------------------------------- people & households

api.use(peopleRoutes);

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

api.use(recordRoutes);

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

api.use(serviceRoutes);

// ---------------------------------------------------------------- MCP administration

api.use(adminRoutes);
api.use(calendarRoutes);

// ---------------------------------------------------------------- feature modules (v0.2)

api.use(libraryRoutes);
api.use(spaceRoutes);
api.use(lendingRoutes);
api.use(equipmentRoutes);
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
  res.status(e.status ?? 500).json({ error: e.message ?? 'Server error', ...((e as { needs_password?: boolean }).needs_password ? { needs_password: true } : {}) });
});
