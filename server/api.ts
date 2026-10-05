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
import { csvRoutes } from './routes/csv.ts';
import { bibleRoutes } from './routes/bible.ts';
import { h, id, sendFile, str } from './routes/helpers.ts';
import { peopleRoutes } from './routes/people.ts';
import { recordRoutes } from './routes/records.ts';
import { serviceRoutes } from './routes/services.ts';
import { adminRoutes } from './routes/admin.ts';
import {
  authenticate, createUser, endSession, getUser, hashPassword, listUsers, loginFailed, loginOk, loginThrottle,
  requireAdmin, requireUser, sessionUser, startSession, userCount, verifyPassword,
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
import { getSettings, updateSettings, type Settings } from './repo/settings.ts';
import { fileForToken } from './repo/downloads.ts';

export const api = express.Router();

// ---------------------------------------------------------------- public: session & setup

api.get('/me', (req, res) => {
  const u = sessionUser(req);
  // leads: the groups this account's member leads (the screens offer recording their meetings)
  res.json({ user: u ? { ...u, csrf: undefined, leads: ledGroups(u.person_id) } : null, csrf: u?.csrf ?? null, needsSetup: userCount() === 0 });
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
  const b = z.object({
    role: z.enum(['admin', 'editor', 'viewer']).optional(), password: z.string().min(8).optional(), display_name: z.string().optional(),
    person_id: z.number().int().nullable().optional(),
  }).parse(req.body);
  const uid = id(req);
  if (b.role && b.role !== 'admin' && uid === req.user!.id) throw Object.assign(new Error('You cannot demote yourself'), { status: 400 });
  const before = getUser(uid);
  if (b.role) run('UPDATE users SET role = ? WHERE id = ?', b.role, uid);
  if (b.password) {
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(b.password), uid);
    run('DELETE FROM sessions WHERE user_id = ?', uid);
  }
  if (b.display_name) run('UPDATE users SET display_name = ? WHERE id = ?', b.display_name, uid);
  if (b.person_id !== undefined) {
    if (b.person_id !== null && !get('SELECT 1 FROM people WHERE id = ?', b.person_id)) throw Object.assign(new Error('That member does not exist.'), { status: 400 });
    run('UPDATE users SET person_id = ? WHERE id = ?', b.person_id, uid);
  }
  const after = getUser(uid);
  const pick = (u: typeof after) => (u ? { username: u.username, display_name: u.display_name, role: u.role, person_id: u.person_id ?? null } : null);
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
