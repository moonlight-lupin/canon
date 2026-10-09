// MCP tools for administration (0.15.3): only on connections approved by an administrator, when Settings → AI / MCP
// → Administration is on. Reading: the security checklist and backups, accounts (never passwords or sign-in
// secrets), the change log (values only when members' personal data is shared), who viewed member records, and a
// settings overview. Writing (Read & write) adds two safe actions: back up now, and run the checks. Accounts, roles
// and settings are only ever changed in Canon itself.
import { z } from 'zod';
import { all } from '../db.ts';
import { DateStr, Id, Limit, RO, WRITE, type ToolDef } from './common.ts';
import { securityChecklist, listMemberViews } from '../repo/security.ts';
import { listChanges } from '../repo/changelog.ts';
import { backupDir, checkFolder, createBackup, lastBackupAt, listBackups, nextDue, prune } from '../repo/backups.ts';
import { backupKeyState } from '../lib/backup-crypto.ts';
import { getSettings } from '../repo/settings.ts';
import { listRoles } from '../lib/permissions.ts';
import { smtpHealth } from '../lib/mailer.ts';
import { publicUrl } from '../lib/public-url.ts';
import { checkPublicAddress } from '../repo/lending-self.ts';

const roleName = (key: string) => listRoles().find((r) => r.key === key)?.name.en ?? key;

function backupStatus() {
  const s = getSettings().backup;
  const items = listBackups();
  const last = lastBackupAt();
  return {
    last_backup_at: last,
    age_days: last ? Math.round((Date.now() - Date.parse(last)) / 86400_000 * 10) / 10 : null,
    automatic: s.auto,
    next_due: nextDue(),
    keep: s.keep,
    copies: items.length,
    folder_problem: checkFolder(backupDir()),
    encrypted: backupKeyState(s.encrypted).encrypted,
  };
}

export const ADMIN_TOOLS: ToolDef[] = [
  {
    name: 'canon_admin_overview', module: 'admin', access: 'read', title: 'Administration overview', annotations: RO,
    description: 'For administrators: the security checklist (each item ok / warn / todo / info with what to do), backups (last, age, automatic schedule, copies kept, folder problems, encryption), and how many accounts there are, with two-step sign-in and locked accounts. Start here for "anything I should fix?".',
    input: {},
    handler: () => {
      const users = all<{ n: number; twofa: number; locked: number }>(
        "SELECT COUNT(*) AS n, SUM(totp_enabled = 1) AS twofa, SUM(locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) AS locked FROM users",
      )[0];
      return {
        checklist: securityChecklist().map(({ key, status, title, detail }) => ({ key, status, title, detail })),
        backups: backupStatus(),
        accounts: { total: users?.n ?? 0, with_two_step: users?.twofa ?? 0, locked: users?.locked ?? 0 },
      };
    },
  },
  {
    name: 'canon_admin_accounts', module: 'admin', access: 'read', title: 'Accounts', annotations: RO,
    description: 'For administrators: every account — username, name, role, the church member it belongs to, two-step sign-in, locked, created and last signed in. Never passwords, sign-in secrets or recovery codes. Changing accounts is done in Canon (Settings → User accounts).',
    input: {},
    handler: () => all<{ id: number; username: string; display_name: string; role: string; person_name: string | null; totp_enabled: number; locked: number; created_at: string; last_login_at: string | null }>(
      `SELECT u.id, u.username, u.display_name, u.role, u.totp_enabled, u.created_at, u.last_login_at,
              u.locked_until > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS locked,
              CASE WHEN p.id IS NOT NULL THEN TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) END AS person_name
       FROM users u LEFT JOIN people p ON p.id = u.person_id ORDER BY u.id`,
    ).map((u) => ({
      id: u.id, username: u.username, name: u.display_name, role: u.role, role_name: roleName(u.role), member: u.person_name,
      two_step: !!u.totp_enabled, locked: !!u.locked, created_at: u.created_at, last_sign_in: u.last_login_at,
    })),
  },
  {
    name: 'canon_admin_change_log', module: 'admin', access: 'read', title: 'Change log', annotations: RO,
    description: 'For administrators: who changed what and when (Settings → Change log), newest first. Filters: entity (e.g. services, service_items, people, songs, settings, users, access_roles), entity_id, user_id, via (web / mcp / system), from, to, q (words). Each entry has the fields that changed; their old and new values only when members\' personal data is shared with AI assistants. Example: {"entity":"services","entity_id":12}.',
    input: {
      entity: z.string().max(40).optional(),
      entity_id: Id.optional(),
      user_id: Id.optional(),
      via: z.enum(['web', 'mcp', 'system']).optional(),
      from: DateStr.optional(),
      to: DateStr.optional(),
      q: z.string().max(100).optional(),
      page: z.number().int().min(1).default(1),
      size: Limit(30, 100),
    },
    handler: (a, ctx) => {
      // without personal data, words are looked for in the entry's name and summary only: a search of the old and new
      // values (a phone number) would tell whose they are without showing them
      const r = listChanges({ ...a, via: a.via as never, values: ctx.pii });
      return {
        total: r.total, page: r.page, size: r.size,
        entries: r.rows.map((c) => ({
          at: c.at, by: c.user_name, via: c.via, client: c.client, entity: c.entity, entity_id: c.entity_id, action: c.action, name: c.name, summary: c.summary,
          ...(ctx.pii ? { changes: c.changes } : { changed: Object.keys(c.changes ?? {}) }),
        })),
        ...(ctx.pii ? {} : { note: 'old and new values are withheld (members’ personal data is not shared with AI assistants): field names only' }),
      };
    },
  },
  {
    name: 'canon_admin_record_views', module: 'admin', access: 'read', title: 'Who viewed member records', annotations: RO,
    description: 'For administrators: every time someone opened a member\'s page, an AI assistant read a member, or the members list was exported (Settings → Security & privacy), newest first: when, who, which member, how. Filters: person_id, user_id, from, to, q. Names only.',
    input: {
      person_id: Id.optional(),
      user_id: Id.optional(),
      from: DateStr.optional(),
      to: DateStr.optional(),
      q: z.string().max(100).optional(),
      page: z.number().int().min(1).default(1),
      size: Limit(30, 100),
    },
    handler: (a) => listMemberViews(a),
  },
  {
    name: 'canon_admin_settings', module: 'admin', access: 'read', title: 'Settings overview', annotations: RO,
    description: 'For administrators: how Canon is set up — church name and languages, parts of Canon switched on, two-step sign-in rules, the public address, e-mail (configured and tested, never the password), backups, how long logs and visitors\' details are kept, the visitor form, the lending library and what AI assistants may see. Read only: settings are changed in Canon.',
    input: {},
    handler: () => {
      const s = getSettings();
      const mail = smtpHealth();
      return {
        church: { name: s.church_name, languages: s.languages },
        modules: s.modules,
        security: s.security,
        public_address: publicUrl() || null,
        email: { configured: !!s.smtp?.host, from: s.smtp?.from_email || null, tested: mail.tested, failing: mail.failing },
        backups: backupStatus(),
        keeping: s.retention,
        visitor_form: { enabled: !!s.visitor_form?.enabled },
        lending: { self_service: !!s.lending?.self_service },
        ai: { enabled: s.mcp.enabled, modules: s.mcp.modules, member_contact_details: s.mcp.expose_member_pii, visitors: s.mcp.visitors, sheet_music: !!s.mcp.sheet_music },
      };
    },
  },
  {
    name: 'canon_admin_backup_now', module: 'admin', access: 'write', title: 'Back up now', annotations: { ...WRITE, idempotentHint: false },
    description: 'For administrators: make a backup of the whole database now, in the backup folder (encrypted when backup encryption is on); older copies beyond the number kept are removed, as with automatic backups. Returns the new copy and the backup status. Ask the user first.',
    input: {},
    handler: () => {
      const problem = checkFolder(backupDir());
      if (problem) throw new Error(`The backup folder has a problem: ${problem}`);
      const b = createBackup();
      const removed = prune(getSettings().backup.keep);
      return { created: b.name, size_mb: Math.round(b.size / 1048576 * 10) / 10, removed, backups: backupStatus() };
    },
  },
  {
    name: 'canon_admin_run_checks', module: 'admin', access: 'write', title: 'Run the checks', annotations: { ...WRITE, idempotentHint: true, openWorldHint: true },
    description: 'For administrators: check again what can drift — whether the public address really reaches this Canon (it calls itself over the internet), whether the backup folder can be written, backup encryption, and whether e-mail last worked (no e-mail is sent) — then return the security checklist. Changes nothing.',
    input: {},
    handler: async () => {
      const pub = await checkPublicAddress(true);
      const mail = smtpHealth();
      const enc = backupKeyState(getSettings().backup.encrypted);
      return {
        public_address: !pub.url ? { ok: false, detail: 'no public address is set (Settings → AI / MCP)' } : { ok: pub.ok, url: pub.url, ...(pub.ok ? {} : { problem: pub.error }) },
        backup_folder: { ok: !checkFolder(backupDir()), problem: checkFolder(backupDir()) },
        backup_encryption: { encrypted: enc.encrypted, problem: enc.problem },
        email: { tested: mail.tested, failing: mail.failing },
        checklist: securityChecklist().map(({ key, status, title, detail }) => ({ key, status, title, detail })),
        checked_at: new Date().toISOString(),
        last_backup_at: lastBackupAt(),
      };
    },
  },
];
