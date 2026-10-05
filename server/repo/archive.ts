// Keeping and archiving (Settings → Security & privacy):
//  - visitors' contact details, prayer requests and how they described themselves are erased from service records
//    after a set number of months (names, how they came and follow-up stay, so reports still count them);
//  - service records (with their offerings) and log entries older than a set number of years move into one
//    read-only archive file per year (data/archives/canon-archive-<year>.db). The services themselves stay, so the
//    planner's history and the AI's precedent are not lost. Archives can be opened read-only in Canon, downloaded,
//    and are copied along with every backup. archived_records (live database) remembers which services have their
//    record in an archive: that record is read-only until an administrator brings it back (restoreArchivedRecord).
//  - erasing visitors' details covers every copy Canon keeps: live records, archive files and the change log
//    (live and archived). Backups keep their copies until they are removed (Settings → Backups → keep newest N);
//    a restored backup is erased again straight away.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { all, db, get, run, tx } from '../db.ts';
import { config } from '../config.ts';
import { BadRequest, Conflict, NotFound } from '../lib/table.ts';
import { logChange } from './changelog.ts';
import { getSettings } from './settings.ts';
import type { Visitor } from '../../shared/records.ts';
import { backupKey, encryptFile } from '../lib/backup-crypto.ts';

export const archiveDir = () => path.join(path.dirname(config.dbPath), 'archives');
const archiveFile = (year: number) => path.join(archiveDir(), `canon-archive-${year}.db`);
const FILE_RE = /^canon-archive-(\d{4})\.db$/;

// ---------------------------------------------------------------- visitors' contact details

const SENSITIVE = ['contact', 'prayer', 'about', 'notes'] as const;
const hasDetails = (v: Visitor) => SENSITIVE.some((k) => v[k]);
const strip = (vs: Visitor[]) => vs.map(({ contact: _c, prayer: _p, about: _a, notes: _n, ...keep }) => keep);

/** A visitors value in a change-log entry, without the details (long values are stored shortened, as text). */
function stripLogged(v: unknown): unknown {
  if (Array.isArray(v)) return strip(v as Visitor[]);
  if (typeof v === 'string' && SENSITIVE.some((k) => v.includes(`"${k}"`))) return '(visitors’ details erased)';
  return v;
}

/** Erase visitors' details from one database's records and change log (main, or an attached archive). */
function eraseIn(d: DatabaseSync, before: string, schema = 'main'): { visitors: number; log: number } {
  let visitors = 0;
  const rows = d.prepare(
    `SELECT r.id, r.visitors FROM ${schema}.service_records r JOIN ${schema}.services s ON s.id = r.service_id WHERE s.date < ? AND r.visitors LIKE '%"%'`,
  ).all(before) as { id: number; visitors: string }[];
  for (const r of rows) {
    const vs = JSON.parse(r.visitors || '[]') as Visitor[];
    const n = vs.filter(hasDetails).length;
    if (!n) continue;
    d.prepare(`UPDATE ${schema}.service_records SET visitors = ? WHERE id = ?`).run(JSON.stringify(strip(vs)), r.id);
    visitors += n;
  }
  // the change log keeps old and new values: its copies of those visitors go too, by the service's date (what the
  // setting is about, not when the change was made). A deleted service's date comes from its tombstone; if no date
  // can be found at all, the entry goes once it is itself older than the setting.
  let log = 0;
  const known = `SELECT id FROM main.services UNION SELECT id FROM main.service_tombstones${schema === 'main' ? '' : ` UNION SELECT id FROM ${schema}.services`}`;
  const old = `SELECT id FROM main.services WHERE date < ? UNION SELECT id FROM main.service_tombstones WHERE date < ?${schema === 'main' ? '' : ` UNION SELECT id FROM ${schema}.services WHERE date < ?`}`;
  const entries = d.prepare(
    `SELECT id, changes FROM ${schema}.change_log WHERE entity = 'service_records' AND changes LIKE '%visitors%'
     AND (parent_id IN (${old}) OR ((parent_id IS NULL OR parent_id NOT IN (${known})) AND at < ?))`,
  ).all(...(schema === 'main' ? [before, before] : [before, before, before]), before) as { id: number; changes: string }[];
  for (const e of entries) {
    const ch = JSON.parse(e.changes || '{}') as Record<string, [unknown, unknown]>;
    if (!ch.visitors) continue;
    const next = [stripLogged(ch.visitors[0]), stripLogged(ch.visitors[1])];
    if (JSON.stringify(next) === JSON.stringify(ch.visitors)) continue;
    ch.visitors = next as [unknown, unknown];
    d.prepare(`UPDATE ${schema}.change_log SET changes = ? WHERE id = ?`).run(JSON.stringify(ch), e.id);
    log++;
  }
  return { visitors, log };
}

/**
 * Erase visitors' contact details, prayer requests, self-descriptions and notes from services older than `months`:
 * in the live records, in archive files and in the change log. Names, how they came and follow-up stay.
 */
export function eraseVisitorContacts(months: number, today = new Date()): { visitors: number; log: number } {
  if (!months) return { visitors: 0, log: 0 };
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - months);
  const before = cutoff.toISOString().slice(0, 10);
  const total = tx(() => eraseIn(db, before));
  // visitor cards nobody reviewed are not kept beyond that either
  run(`DELETE FROM visitor_cards WHERE created_at < ?`, before);
  for (const year of archiveYears()) {
    if (year > Number(before.slice(0, 4))) continue;
    withArchive(year, () => {
      const n = tx(() => eraseIn(db, before, 'arc'));
      total.visitors += n.visitors;
      total.log += n.log;
    });
  }
  return total;
}

// ---------------------------------------------------------------- archiving

/** Years whose records and log entries are old enough to archive (strictly older than `years` full years). */
export function archivableYears(years: number, today = new Date()): { year: number; records: number; changes: number; ai: number; views: number }[] {
  if (!years) return [];
  const last = today.getFullYear() - years - 1;
  const ys = all<{ y: string }>(
    `SELECT DISTINCT y FROM (
       SELECT substr(s.date, 1, 4) AS y FROM service_records r JOIN services s ON s.id = r.service_id
       UNION SELECT substr(at, 1, 4) FROM change_log UNION SELECT substr(at, 1, 4) FROM mcp_audit UNION SELECT substr(at, 1, 4) FROM member_views
     ) WHERE CAST(y AS INTEGER) <= ? ORDER BY y`, last,
  ).map((r) => Number(r.y)).filter((y) => y > 1900);
  return ys.map((year) => ({ year, ...countsFor(year) }));
}

function countsFor(year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const n = (sql: string, ...p: (string | number)[]) => get<{ n: number }>(sql, ...p)?.n ?? 0;
  return {
    records: n('SELECT COUNT(*) AS n FROM service_records r JOIN services s ON s.id = r.service_id WHERE s.date BETWEEN ? AND ?', from, to),
    changes: n("SELECT COUNT(*) AS n FROM change_log WHERE at BETWEEN ? AND ? || ' 23:59:59'", from, to),
    ai: n("SELECT COUNT(*) AS n FROM mcp_audit WHERE at BETWEEN ? AND ? || ' 23:59:59'", from, to),
    views: n("SELECT COUNT(*) AS n FROM member_views WHERE at BETWEEN ? AND ? || ' 23:59:59'", from, to),
  };
}

/** Attach a year's archive file as `arc` (read-write) for the duration of fn. */
function withArchive<T>(year: number, fn: () => T): T {
  fs.mkdirSync(archiveDir(), { recursive: true });
  db.exec(`ATTACH DATABASE '${archiveFile(year).replace(/'/g, "''")}' AS arc`);
  try {
    return fn();
  } finally {
    db.exec('DETACH DATABASE arc');
  }
}

/** Run fn with each archive file attached as `arc` (erasing a member's details from every copy). */
export function forEachArchive(fn: () => void) {
  for (const year of archiveYears()) withArchive(year, fn);
}

const COPIED = ['services', 'service_records', 'change_log', 'mcp_audit', 'member_views'] as const;
const columnsOf = (schema: string, t: string) => (db.prepare(`PRAGMA ${schema}.table_info(${t})`).all() as { name: string; type: string; dflt_value: string | null }[]);

/** Make the archive's copy of a table and give it any columns added to Canon since the archive was made. */
function syncTable(t: (typeof COPIED)[number]) {
  db.exec(`CREATE TABLE IF NOT EXISTS arc.${t} AS SELECT * FROM main.${t} WHERE 0`);
  const have = new Set(columnsOf('arc', t).map((c) => c.name));
  // with its default, so the rows already archived get a value (e.g. revision 0), as in the live database
  for (const c of columnsOf('main', t)) {
    if (!have.has(c.name)) db.exec(`ALTER TABLE arc.${t} ADD COLUMN ${c.name} ${c.type || ''}${c.dflt_value != null ? ` DEFAULT ${c.dflt_value}` : ''}`);
  }
}
/** The columns both copies have, for INSERT … SELECT by name (an older archive may have fewer). */
const shared = (t: string, skip: string[] = []) => {
  const arc = new Set(columnsOf('arc', t).map((c) => c.name));
  return columnsOf('main', t).map((c) => c.name).filter((c) => arc.has(c) && !skip.includes(c)).join(', ');
};

/** Copy one year into its archive file (added to it if it exists), then remove it from the live database. */
function archiveYear(year: number) {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const end = `${to} 23:59:59`;
  const counts = countsFor(year);
  return withArchive(year, () => tx(() => {
    db.exec('CREATE TABLE IF NOT EXISTS arc.archive_meta (key TEXT PRIMARY KEY, value TEXT)');
    for (const t of COPIED) syncTable(t);
    const ids = 'SELECT r.service_id FROM main.service_records r JOIN main.services s ON s.id = r.service_id WHERE s.date BETWEEN ? AND ?';
    // one record per service in an archive. A live record already in the archive (a backup from before archiving
    // was restored) is dropped only if it is the same record: every stored field equal (money, visitors, signatures,
    // its last save…; the revision counter aside, as restores give different histories). Anything else stops
    // archiving before the live record is touched.
    const same = shared('service_records', ['revision']).split(', ').map((c) => `m.${c} IS a.${c}`).join(' AND ');
    const clash = all<{ service_id: number; same: number }>(
      `SELECT m.service_id, (${same}) AS same FROM main.service_records m
       JOIN arc.service_records a ON a.service_id = m.service_id WHERE m.service_id IN (${ids})`, from, to,
    );
    const differ = clash.filter((c) => !c.same);
    if (differ.length) {
      throw new Conflict(`The ${year} archive already has a different record for ${differ.length} of these services (services ${differ.slice(0, 5).map((c) => c.service_id).join(', ')}). Nothing was archived. Bring the archived record back first, or compare the two.`);
    }
    const fresh = `${ids} AND r.service_id NOT IN (SELECT service_id FROM arc.service_records)`;
    // the services are copied for context (title, date) and stay in Canon
    run(`DELETE FROM arc.services WHERE id IN (${ids})`, from, to);
    run(`INSERT INTO arc.services (${shared('services')}) SELECT ${shared('services')} FROM main.services WHERE id IN (${ids})`, from, to);
    run(`INSERT INTO arc.service_records (${shared('service_records')}) SELECT ${shared('service_records')} FROM main.service_records WHERE service_id IN (${fresh})`, from, to);
    try {
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS arc.archive_one_record_per_service ON service_records(service_id)');
    } catch { /* an archive made by 0.11.0 may already hold a duplicate: kept as it is, and listed as such */ }
    for (const t of ['change_log', 'mcp_audit', 'member_views'] as const) {
      run(`INSERT INTO arc.${t} (${shared(t)}) SELECT ${shared(t)} FROM main.${t} WHERE at BETWEEN ? AND ?`, from, end);
    }
    run("INSERT OR REPLACE INTO arc.archive_meta (key, value) VALUES ('year', ?), ('updated_at', datetime('now')), ('schema', ?)", String(year), String(get<{ user_version: number }>('PRAGMA main.user_version')?.user_version ?? ''));
    // the live database remembers which services have their record in this archive (read-only from now on)
    run(`INSERT OR REPLACE INTO main.archived_records (service_id, year) SELECT service_id, ? FROM (${ids})`, year, from, to);
    run(`DELETE FROM main.visitor_cards WHERE service_id IN (${ids})`, from, to);
    run(`DELETE FROM main.service_records WHERE service_id IN (SELECT r.service_id FROM main.service_records r JOIN main.services s ON s.id = r.service_id WHERE s.date BETWEEN ? AND ?)`, from, to);
    for (const t of ['change_log', 'mcp_audit', 'member_views'] as const) run(`DELETE FROM main.${t} WHERE at BETWEEN ? AND ?`, from, end);
    return { year, ...counts };
  }));
}

/** The years that have an archive file. */
export const archiveYears = () => (fs.existsSync(archiveDir()) ? fs.readdirSync(archiveDir()).filter((n) => FILE_RE.test(n)).map((n) => Number(FILE_RE.exec(n)![1])).sort() : []);

/**
 * Make archived_records match the archive files (archives made by 0.11.0, or copied in by hand): every service with
 * a record in an archive, and no live record, is marked as archived. Returns how many were added.
 */
export function syncArchiveIndex(): number {
  let n = 0;
  for (const year of archiveYears()) {
    withArchive(year, () => {
      n += Number(db.prepare(
        `INSERT OR IGNORE INTO main.archived_records (service_id, year)
         SELECT DISTINCT a.service_id, ? FROM arc.service_records a
         WHERE a.service_id IN (SELECT id FROM main.services) AND a.service_id NOT IN (SELECT service_id FROM main.service_records)`,
      ).run(year).changes);
    });
  }
  return n;
}

/**
 * Bring one archived record back into the live database so it can be corrected (administrators). It leaves the
 * archive; the next archiving puts it back. Logged.
 */
export function restoreArchivedRecord(year: number, serviceId: number) {
  if (!fs.existsSync(archiveFile(year))) throw new NotFound(`No archive for ${year}.`);
  const marked = get<{ year: number }>('SELECT year FROM archived_records WHERE service_id = ?', serviceId);
  if (marked && marked.year !== year) throw new BadRequest(`That service's record is in the ${marked.year} archive.`);
  const out = withArchive(year, () => tx(() => {
    syncTable('service_records');
    const rows = all<{ id: number }>('SELECT id FROM arc.service_records WHERE service_id = ? ORDER BY id', serviceId);
    if (!rows.length) throw new NotFound(`The ${year} archive has no record for that service.`);
    if (rows.length > 1) throw new Conflict(`The ${year} archive holds ${rows.length} records for that service (archived by 0.11.0). Download the archive and compare them before bringing one back.`);
    if (get('SELECT 1 FROM main.service_records WHERE service_id = ?', serviceId)) throw new Conflict('That service already has a live record.');
    const cols = shared('service_records', ['id']);
    run(`INSERT INTO main.service_records (${cols}) SELECT ${cols} FROM arc.service_records WHERE service_id = ?`, serviceId);
    run('DELETE FROM arc.service_records WHERE service_id = ?', serviceId);
    run('DELETE FROM main.archived_records WHERE service_id = ?', serviceId);
    return get<{ date: string; title: string }>('SELECT date, title FROM main.services WHERE id = ?', serviceId);
  }));
  logChange({
    entity: 'services', entity_id: serviceId, action: 'update',
    summary: `Brought the service record of ${out?.date ?? `service ${serviceId}`} back from the ${year} archive to correct it`,
  });
  return { restored: true, service_id: serviceId };
}

/** Archive every year older than the setting (or preview it with dryRun). */
export function runArchive(dryRun: boolean, years = getSettings().retention.archive_years ?? 5) {
  if (!years) throw new BadRequest('Archiving is off (Keep in Canon: “all years”).');
  const due = archivableYears(years);
  if (dryRun) return { dry_run: true, years: due };
  // what should already be erased never reaches an archive
  eraseVisitorContacts(getSettings().retention.visitor_contact_months);
  const done = due.map((y) => archiveYear(y.year));
  if (done.length) {
    logChange({
      entity: 'settings', entity_id: null, action: 'update',
      summary: `Archived ${done.map((d) => `${d.year} (${d.records} service records, ${d.changes} change-log entries)`).join('; ')} to data/archives`,
    });
  }
  return { dry_run: false, years: done };
}

// ---------------------------------------------------------------- reading archives

export function listArchives() {
  const dir = archiveDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => FILE_RE.test(n)).sort().map((name) => {
    const year = Number(FILE_RE.exec(name)![1]);
    const d = open(year);
    try {
      const n = (t: string) => (d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
      const duplicates = (d.prepare('SELECT COUNT(*) AS n FROM (SELECT service_id FROM service_records GROUP BY service_id HAVING COUNT(*) > 1)').get() as { n: number }).n;
      return { year, name, size: fs.statSync(path.join(dir, name)).size, records: n('service_records'), changes: n('change_log'), ai: n('mcp_audit'), views: n('member_views'), duplicates };
    } finally {
      d.close();
    }
  });
}

function open(year: number) {
  const file = archiveFile(year);
  if (!fs.existsSync(file)) throw new NotFound(`No archive for ${year}.`);
  return new DatabaseSync(file, { readOnly: true });
}

export const archivePath = (year: number) => {
  const file = archiveFile(year);
  if (!fs.existsSync(file)) throw new NotFound(`No archive for ${year}.`);
  return file;
};

/** One year's archived service records: date, service, attendance, visitors and offering totals per currency. */
export function archivedRecords(year: number) {
  const d = open(year);
  try {
    const rows = d.prepare(
      `SELECT r.service_id AS id, s.date, s.start_time, s.title, r.attendance, r.children, r.online, r.visitors, r.offerings, r.currency, r.verified_at, r.verified_by
       FROM service_records r LEFT JOIN services s ON s.id = r.service_id ORDER BY s.date, s.start_time`,
    ).all() as Record<string, string | number | null>[];
    return rows.map((r) => {
      const offerings = JSON.parse(String(r.offerings ?? '[]')) as { amount: number; currency?: string }[];
      const totals: Record<string, number> = {};
      for (const l of offerings) totals[l.currency ?? String(r.currency)] = (totals[l.currency ?? String(r.currency)] ?? 0) + (Number(l.amount) || 0);
      return {
        service_id: r.id, date: r.date, start_time: r.start_time, title: JSON.parse(String(r.title ?? '{}')),
        attendance: r.attendance, children: r.children, online: r.online,
        visitors: (JSON.parse(String(r.visitors ?? '[]')) as unknown[]).length,
        totals, verified: !!r.verified_at, verified_by: r.verified_by,
      };
    });
  } finally {
    d.close();
  }
}

/** One year's archived change log, newest first, paged; q searches names and values. */
export function archivedChanges(year: number, q: { page?: number; q?: string }) {
  const d = open(year);
  try {
    const size = 50;
    const page = Math.max(1, q.page ?? 1);
    const where = q.q ? "WHERE (name || ' ' || IFNULL(summary, '') || ' ' || changes) LIKE ? ESCAPE '\\'" : '';
    const params = q.q ? [`%${q.q.replace(/[\\%_]/g, (c) => '\\' + c)}%`] : [];
    const total = (d.prepare(`SELECT COUNT(*) AS n FROM change_log ${where}`).get(...params) as { n: number }).n;
    const rows = (d.prepare(`SELECT * FROM change_log ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size) as Record<string, unknown>[])
      .map((r) => ({ ...r, changes: JSON.parse(String(r.changes ?? '{}')) }));
    return { rows, total, page, size };
  } finally {
    d.close();
  }
}

/** Copy the archive files into a backup folder (when new or changed since the last copy). */
export function copyArchivesTo(dir: string) {
  const src = archiveDir();
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(dir, 'archives');
  let n = 0;
  for (const name of fs.readdirSync(src).filter((x) => FILE_RE.test(x))) {
    const a = path.join(src, name);
    const key = backupKey();
    const b = path.join(dest, key ? `${name}.enc` : name);
    // copied again when it changed (archiving adds to it; erasing visitors' details edits it in place)
    if (fs.existsSync(b) && (key || fs.statSync(b).size === fs.statSync(a).size) && fs.statSync(b).mtimeMs >= fs.statSync(a).mtimeMs) continue;
    fs.mkdirSync(dest, { recursive: true });
    if (key) encryptFile(a, b, key);
    else fs.copyFileSync(a, b);
    n++;
  }
  return n;
}
