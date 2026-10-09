// Settings → Security & privacy and the Storage panel:
//  - who viewed member records (a member's page, an AI agent reading a person, the members CSV export), kept as long
//    as the change log;
//  - a security checklist in plain words (disk encryption, backups, public address, accounts, AI access, keep
//    periods), each item with what to do;
//  - how much space Canon uses, what uses it, how fast it grows, and the free space on the drive.
import { gates, selfServiceWeek } from './lending-self.ts';
import { publicUrl } from '../lib/public-url.ts';
import { firstAdminId, memberLinkProblem } from '../auth.ts';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, type SqlValue } from '../db.ts';
import { config } from '../config.ts';
import { getMeta, getSettings, setMeta } from './settings.ts';
import { backupDir, lastBackupAt, listBackups } from './backups.ts';
import { dateRange, paging } from './changelog.ts';
import { likeTerm } from '../lib/table.ts';
import { formSettings } from './visitor-form.ts';
import { archivableYears, logArchiveYears } from './archive.ts';
import { isAdmin } from '../lib/permissions.ts';
import { backupKeyState } from '../lib/backup-crypto.ts';
import { churchToday } from '../lib/dates.ts';

// ---------------------------------------------------------------- member record views

export type ViewVia = 'web' | 'mcp' | 'export';

/** Note that someone looked at member records. The same person opening the same record within 10 minutes counts once. */
export function logMemberView(v: { user_id: number | null; user_name: string | null; person_id: number | null; via: ViewVia; detail?: string }) {
  const recent = get<{ id: number }>(
    `SELECT id FROM member_views WHERE IFNULL(user_id, 0) = ? AND IFNULL(person_id, 0) = ? AND via = ? AND at > datetime('now', '-10 minutes')`,
    v.user_id ?? 0, v.person_id ?? 0, v.via,
  );
  if (recent) return;
  run('INSERT INTO member_views (user_id, user_name, person_id, via, detail) VALUES (?,?,?,?,?)', v.user_id, v.user_name, v.person_id, v.via, v.detail ?? null);
}

export interface ViewQuery { person_id?: number; user_id?: number; via?: string; from?: string; to?: string; q?: string; page?: number; size?: number; all?: boolean }

export function listMemberViews(q: ViewQuery) {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.person_id) {
    where.push('v.person_id = ?');
    params.push(q.person_id);
  }
  if (q.user_id) {
    where.push('v.user_id = ?');
    params.push(q.user_id);
  }
  if (q.via && ['web', 'mcp', 'export'].includes(q.via)) {
    where.push('v.via = ?');
    params.push(q.via);
  }
  const dr = dateRange('v.at', q.from, q.to);
  where.push(...dr.where);
  params.push(...dr.params);
  if (q.q) {
    where.push(`(IFNULL(p.first_name,'') || ' ' || IFNULL(p.last_name,'') || ' ' || IFNULL(p.native_name,'') || ' ' || IFNULL(v.detail,'')) LIKE ? ESCAPE '\\'`);
    params.push(likeTerm(q.q));
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { size, page, offset } = paging(q);
  const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM member_views v LEFT JOIN people p ON p.id = v.person_id ${w}`, ...params)?.n ?? 0;
  const rows = all<{ id: number; at: string; user_id: number | null; user_name: string | null; person_id: number | null; person_name: string | null; via: ViewVia; detail: string | null }>(
    `SELECT v.id, v.at, v.user_id, v.user_name, v.person_id, v.via, v.detail,
            TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || IFNULL(p.last_name, '') || ' ' || IFNULL(p.native_name, '')) AS person_name
     FROM member_views v LEFT JOIN people p ON p.id = v.person_id ${w} ORDER BY v.id DESC LIMIT ? OFFSET ?`,
    ...params, size, offset,
  );
  const users = all<{ id: number; name: string }>('SELECT DISTINCT user_id AS id, user_name AS name FROM member_views WHERE user_id IS NOT NULL ORDER BY user_name');
  return { rows, total, page, size, users };
}

export function pruneMemberViews(months: number): number {
  if (!months) return 0;
  return Number(run(`DELETE FROM member_views WHERE at < datetime('now', ?)`, `-${months} months`).changes);
}

// ---------------------------------------------------------------- storage

const fileSize = (p: string) => {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
};

/** What uses the space inside the database, in plain words. */
const TABLE_LABEL: Record<string, string> = {
  bible_verses: 'Bible texts', assets: 'Pictures and files (logo, QR codes and notes, backgrounds, book covers, asset photos and receipts)', slide_backgrounds: 'Slide backgrounds', images: 'Images (Library)',
  songs: 'Songs', texts: 'Liturgy and catechisms', services: 'Services', service_items: 'Orders of service',
  service_records: 'Service records', change_log: 'Change log', mcp_audit: 'AI activity log', member_views: 'Member record views',
  people: 'Members', email_log: 'E-mail log', visitor_cards: 'Visitor cards',
  templates: 'Service templates', song_hymnals: 'Hymn numbers', hymnals: 'Hymnals', sqlite_schema: 'Database structure', sqlite_master: 'Database structure',
  bulletin_templates: 'Bulletin templates', slide_themes: 'Slide templates', bulletin_blocks: 'QR codes and notes', groups: 'Groups', group_members: 'Group members',
  households: 'Households', assignments: 'Rota', settings: 'Settings', bible_translations: 'Bible versions', oauth_tokens: 'AI connections', oauth_grants: 'AI connections',
  sessions: 'Sign-ins', users: 'User accounts', coworkers: 'Co-workers', roles: 'Roles', teams: 'Teams', congregations: 'Congregations', unavailability: 'Away dates',
  lending_books: 'Lending library', lending_copies: 'Lending library', lending_loans: 'Lending library loans', equipment: 'Asset register', equipment_maintenance: 'Asset register', equipment_files: 'Asset register',
  bk_accounts: 'Book-keeping', bk_funds: 'Book-keeping', bk_projects: 'Book-keeping', bk_ministries: 'Book-keeping', bk_journals: 'Book-keeping', bk_lines: 'Book-keeping',
  bk_statements: 'Book-keeping', bk_statement_lines: 'Book-keeping',
  bk_claims: 'Expense claims', bk_claim_lines: 'Expense claims', bk_claim_files: 'Expense claims', bk_claim_approvers: 'Expense claims', bk_claim_approvals: 'Expense claims',
};

/** Keep one size reading a day (for the growth estimate); the last 400 days. */
export function recordSizeSnapshot(today = churchToday()) {
  const hist = sizeHistory();
  if (hist.at(-1)?.date === today) return;
  hist.push({ date: today, bytes: fileSize(config.dbPath) + fileSize(`${config.dbPath}-wal`) });
  setMeta('_size_history', JSON.stringify(hist.slice(-400)));
}
function sizeHistory(): { date: string; bytes: number }[] {
  try {
    return JSON.parse(getMeta('_size_history') ?? '[]');
  } catch {
    return [];
  }
}

export function storageReport() {
  const db = fileSize(config.dbPath);
  const wal = fileSize(`${config.dbPath}-wal`);
  let tables: { name: string; label: string; bytes: number }[] = [];
  try {
    tables = all<{ name: string; bytes: number }>(
      `SELECT CASE WHEN m.type = 'index' THEN m.tbl_name ELSE s.name END AS name, SUM(s.pgsize) AS bytes
       FROM dbstat s LEFT JOIN sqlite_master m ON m.name = s.name GROUP BY 1 ORDER BY bytes DESC`,
    ).map((t) => ({ ...t, label: TABLE_LABEL[t.name] ?? t.name }));
  } catch { /* dbstat not available in this SQLite build */ }
  const top = tables.slice(0, 8);
  const rest = tables.slice(8).reduce((s, t) => s + t.bytes, 0);
  const backups = listBackups();
  const backupBytes = backups.reduce((s, b) => s + b.size, 0);
  let free: number | null = null;
  try {
    const st = fs.statfsSync(path.dirname(config.dbPath));
    free = Number(st.bavail) * Number(st.bsize);
  } catch { /* not available */ }
  const hist = sizeHistory();
  const monthAgo = hist.find((h) => Date.parse(h.date) >= Date.now() - 31 * 86400_000);
  const growth = monthAgo && hist.length > 1 ? Math.max(0, db + wal - monthAgo.bytes) : null;
  const warnings: string[] = [];
  if (free !== null && free < 2e9) warnings.push('Less than 2 GB free on the drive Canon uses. Free some space before backups fail.');
  if (db + wal > 1e9) warnings.push('The database is over 1 GB: consider archiving older records (coming in this release).');
  if (free !== null && growth && free / growth < 12) warnings.push('At this growth the drive fills within a year.');
  return {
    database: { bytes: db + wal, file: db, wal, path: config.dbPath },
    tables: [...top, ...(rest ? [{ name: 'other', label: 'Everything else', bytes: rest }] : [])],
    backups: { dir: backupDir(), count: backups.length, bytes: backupBytes, last: lastBackupAt() },
    free_bytes: free,
    growth_per_month: growth,
    history: hist.slice(-90),
    warnings,
  };
}

// ---------------------------------------------------------------- security checklist

export type CheckStatus = 'ok' | 'warn' | 'todo' | 'info';
export interface CheckItem { key: string; status: CheckStatus; title: string; detail: string; link?: string }

const SYNCED = /(onedrive|dropbox|google ?drive|icloud|box sync)/i;

export function securityChecklist(): CheckItem[] {
  const s = getSettings();
  const items: CheckItem[] = [];
  items.push(s.security?.disk_encryption
    ? { key: 'disk', status: 'ok', title: 'Disk encryption', detail: 'You confirmed the drive Canon runs on is encrypted (BitLocker on Windows, FileVault on a Mac, or the VM provider’s disk encryption).' }
    : { key: 'disk', status: 'todo', title: 'Disk encryption', detail: 'Turn on BitLocker (Windows 11 Pro: Settings → Privacy & security → Device encryption / BitLocker) so a lost or stolen computer does not give away members’ details. Then tick “Done” here.' });

  const last = lastBackupAt();
  const ageDays = last ? (Date.now() - Date.parse(last)) / 86400_000 : Infinity;
  const auto = s.backup.auto;
  items.push(auto === 'off'
    ? { key: 'backups', status: 'warn', title: 'Automatic backups', detail: 'Automatic backups are off. Turn them on (daily or weekly).', link: '/settings?tab=backups' }
    : ageDays > (auto === 'daily' ? 2 : 9)
      ? { key: 'backups', status: 'warn', title: 'Automatic backups', detail: `The last backup is ${Number.isFinite(ageDays) ? `${Math.round(ageDays)} days` : 'not yet made'} old. Check Settings → Backups.`, link: '/settings?tab=backups' }
      : { key: 'backups', status: 'ok', title: 'Automatic backups', detail: `${auto === 'daily' ? 'Daily' : 'Weekly'}; the last one was ${Math.max(0, Math.round(ageDays))} day(s) ago.` });

  const dir = backupDir();
  const inside = path.resolve(dir).toLowerCase().startsWith(path.resolve(config.root).toLowerCase());
  items.push(SYNCED.test(dir)
    ? { key: 'backup_place', status: 'info', title: 'Where backups are kept', detail: `Backups go to a folder synced to a cloud account (${dir}): a good copy away from this computer, as long as the account is the church’s and only the people who need it can open it — the files are full, unencrypted copies of the database.`, link: '/settings?tab=backups' }
    : inside
      ? { key: 'backup_place', status: 'warn', title: 'Where backups are kept', detail: `Backups are in Canon’s own folder (${dir}), on the same drive as the database. If that drive fails, both are lost: copy them regularly to a USB drive or another computer the office controls.`, link: '/settings?tab=backups' }
      : { key: 'backup_place', status: 'ok', title: 'Where backups are kept', detail: `Backups go to ${dir}.` });
  const enc = backupKeyState(s.backup.encrypted);
  items.push(enc.problem
    ? { key: 'backup_encryption', status: 'warn', title: 'Backup encryption', detail: enc.problem, link: '/settings?tab=backups' }
    : enc.encrypted
    ? { key: 'backup_encryption', status: 'ok', title: 'Backup encryption', detail: 'Backups (and the archive copies with them) are encrypted with the church’s backup password. Keep that password with the church’s records: without it, a backup can’t be restored on another computer.' }
    : { key: 'backup_encryption', status: 'warn', title: 'Backup encryption', detail: 'Backups are not encrypted: anyone who gets a backup file can read it. Set a backup password in Settings → Backups.', link: '/settings?tab=backups' });

  const pub = s.public_url;
  items.push(!pub
    ? { key: 'public', status: 'info', title: 'Public address', detail: 'No public address: Canon is reached on the church’s network only (AI assistants and the visitor form from outside need one).', link: '/settings?tab=mcp' }
    : /^https:\/\//i.test(pub)
      ? { key: 'public', status: 'ok', title: 'Public address', detail: `${pub} (https).` }
      : { key: 'public', status: 'warn', title: 'Public address', detail: `${pub} is not https: sign-ins and members’ details would cross the internet unencrypted.`, link: '/settings?tab=mcp' });

  const users = all<{ id: number; display_name: string; role: string; created_at: string; last_login_at: string | null }>('SELECT id, display_name, role, created_at, last_login_at FROM users');
  const admins = users.filter((u) => isAdmin(u)).length;
  items.push(admins < 2
    ? { key: 'admins', status: 'warn', title: 'Administrators', detail: 'Only one administrator: if that person is away or forgets the password, nobody can manage Canon. Add a second.', link: '/settings?tab=users' }
    : admins > 4
      ? { key: 'admins', status: 'warn', title: 'Administrators', detail: `${admins} administrators: each can change everything. Keep it to the few who need it.`, link: '/settings?tab=users' }
      : { key: 'admins', status: 'ok', title: 'Administrators', detail: `${admins} administrators.` });
  // two-step sign-in: for every account, or for administrators
  const twoStep = all<{ role: string; totp_enabled: number }>('SELECT role, totp_enabled FROM users');
  const withTwoStep = twoStep.filter((u) => isAdmin(u));
  const without = withTwoStep.filter((u) => !u.totp_enabled).length;
  const everyoneWithout = twoStep.filter((u) => !u.totp_enabled).length;
  items.push(s.security?.require_all_2fa
    ? { key: 'two_step', status: 'ok', title: 'Two-step sign-in', detail: `Required for every account${everyoneWithout ? ` (${everyoneWithout} still to set it up — they can only set it up when they sign in)` : ''}.` }
    : s.security?.require_admin_2fa
    ? { key: 'two_step', status: 'ok', title: 'Two-step sign-in', detail: `Required for administrators${without ? ` (${without} still to set it up — they can’t use administrator functions until they do)` : ''}.` }
    : without === 0
      ? { key: 'two_step', status: 'ok', title: 'Two-step sign-in', detail: 'Every administrator uses it. Require it, so a new administrator does too.' }
      : { key: 'two_step', status: 'warn', title: 'Two-step sign-in', detail: `${without} administrator${without === 1 ? ' signs' : 's sign'} in with a password only. Set up two-step sign-in (Settings → My profile) with an authenticator app, then require it here.` });
  // every account is a church member's, except external guests' (the first administrator is reminded)
  const linked = all<{ id: number; display_name: string; role: string; person_id: number | null }>('SELECT id, display_name, role, person_id FROM users');
  const unlinked = linked.filter((u) => memberLinkProblem(u.id, u.role, u.person_id));
  const firstUnlinked = linked.find((u) => u.id === firstAdminId() && !u.person_id);
  items.push(unlinked.length
    ? { key: 'member_links', status: 'warn', title: 'Accounts and members', detail: `Not linked to a church member: ${unlinked.map((u) => u.display_name).join(', ')}. Link each to their member record (Member), or make it an external guest account.`, link: '/settings?tab=users' }
    : firstUnlinked
      ? { key: 'member_links', status: 'todo', title: 'Accounts and members', detail: `Every account belongs to a church member or an external guest, except yours (${firstUnlinked.display_name}, who set Canon up): link it to your member record.`, link: '/settings?tab=users' }
      : { key: 'member_links', status: 'ok', title: 'Accounts and members', detail: 'Every account belongs to a church member, or is an external guest’s (read-only).' });
  const cutoff = Date.now() - 180 * 86400_000;
  const stale = users.filter((u) => (u.last_login_at ? Date.parse(u.last_login_at.replace(' ', 'T') + 'Z') : Date.parse(u.created_at.replace(' ', 'T') + 'Z')) < cutoff);
  items.push(stale.length
    ? { key: 'stale', status: 'warn', title: 'Accounts not used for 6 months', detail: `${stale.map((u) => u.display_name).join(', ')}. Remove accounts people no longer need.`, link: '/settings?tab=users' }
    : { key: 'stale', status: 'ok', title: 'Accounts not used for 6 months', detail: 'None.' });

  const mcp = s.mcp;
  items.push(!mcp.enabled
    ? { key: 'ai', status: 'ok', title: 'AI assistants', detail: 'Off.' }
    : (() => {
      const members = mcp.expose_member_pii && mcp.modules.members !== 'off';
      const visitors = mcp.modules.records !== 'off' && mcp.visitors === 'contact';
      const shared = [members && 'members’ contact details and birthdays', visitors && 'visitors’ contact details'].filter(Boolean).join(' and ');
      return shared
        ? { key: 'ai', status: 'warn' as const, title: 'AI assistants', detail: `On, and ${shared} are shared with them. Keep that only with the consent to share it with the AI provider.`, link: '/settings?tab=mcp' }
        : { key: 'ai', status: 'ok' as const, title: 'AI assistants', detail: 'On; no contact details are shared with them.', link: '/settings?tab=mcp' };
    })());

  const vf = formSettings();
  items.push({ key: 'visitor_form', status: 'info', title: 'Visitor form', detail: vf.enabled ? 'On: services with a form have a public page visitors can fill in.' : 'Off.', link: '/settings?tab=visitor-form' });
  // lending self-service: public pages members use on their phones (gates in repo/lending-self.ts)
  if (s.modules.lending !== false && s.lending.self_service) {
    const week = selfServiceWeek();
    const broken = gates().filter((g) => !g.ok).map((g) => g.key.replace('_', ' '));
    items.push(broken.length
      ? { key: 'self_service', status: 'warn', title: 'Lending library self-service', detail: `Switched on but paused: ${broken.join(', ')} not ready. Members are asked to see the librarian until it is fixed.`, link: '/lending?tab=rules' }
      : { key: 'self_service', status: 'info', title: 'Lending library self-service', detail: `On: members borrow, renew and return on their phones from the internet (${publicUrl()}), signing in with a code e-mailed to their address on the register. This week: ${week.codes} sign-in code(s) sent, ${week.self_loans} self-service loan(s).`, link: '/lending?tab=rules' });
  }
  // the daily tidy: a duty that failed (above all the privacy erasure) is a warning until it works again
  const tidy = (() => {
    try {
      return JSON.parse(getMeta('tidy_status') ?? 'null') as { at: string; failed: Record<string, { what: string; error: string }> } | null;
    } catch {
      return null;
    }
  })();
  const failed = Object.entries(tidy?.failed ?? {});
  if (tidy && failed.length) {
    const erase = tidy.failed.erase;
    const day = tidy.at.slice(0, 10);
    items.push({
      key: 'tidy', status: 'warn', title: 'Daily housekeeping',
      detail: erase
        ? `Visitors’ contact details are not being erased as Settings says: the daily tidy of ${day} could not (${erase.error}). Canon tries again every day; if this stays, look at Canon’s log or ask whoever looks after the computer.`
        : `The daily tidy of ${day}: ${failed.map(([, f]) => `${f.what} failed (${f.error})`).join('; ')}. Canon tries again every day; if this stays, look at Canon’s log.`,
    });
  }
  items.push({ key: 'retention', status: 'info', title: 'How long logs are kept', detail: `Change log and member record views: ${s.retention.change_log_months || 'all'} months; AI activity: ${s.retention.mcp_audit_months || 'all'} months.`, link: '/settings?tab=changelog' });
  items.push(s.retention.visitor_contact_months
    ? { key: 'visitor_contacts', status: 'ok', title: 'Visitors’ contact details', detail: `Erased ${s.retention.visitor_contact_months} months after the service (names and follow-up stay).` }
    : { key: 'visitor_contacts', status: 'warn', title: 'Visitors’ contact details', detail: 'Kept for ever. Personal data should be kept only as long as it is needed: set how many months below.' });
  const recYears = s.retention.archive_years ?? 0;
  const logYears = logArchiveYears(s.retention);
  const due = archivableYears(recYears, new Date(), logYears);
  const ages = [recYears ? `service records after ${recYears} years` : 'service records never', logYears ? `log entries after ${logYears} years` : 'log entries never'].join(', ');
  items.push(!recYears && !logYears
    ? { key: 'archive', status: 'info', title: 'Archiving', detail: 'Off: every year’s records and logs stay in Canon.' }
    : due.length
      ? { key: 'archive', status: 'warn', title: 'Archiving', detail: `${due.map((d) => d.year).join(', ')} can be archived (${ages}). Use “Archive now” below.` }
      : { key: 'archive', status: 'ok', title: 'Archiving', detail: `Archived: ${ages}; nothing waiting.` });
  items.push({ key: 'readonly', status: 'ok', title: 'Read-only accounts', detail: 'Never see members’ contact details, notes, ages or sensitive fields.' });
  return items;
}
