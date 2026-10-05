// Keeping and archiving (Settings → Security & privacy):
//  - visitors' contact details, prayer requests and how they described themselves are erased from service records
//    after a set number of months (names, how they came and follow-up stay, so reports still count them);
//  - service records (with their offerings) and log entries older than a set number of years move into one
//    read-only archive file per year (data/archives/canon-archive-<year>.db). The services themselves stay, so the
//    planner's history and the AI's precedent are not lost. Archives can be opened read-only in Canon, downloaded,
//    and are copied along with every backup.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { all, db, get, run, tx } from '../db.ts';
import { config } from '../config.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { logChange } from './changelog.ts';
import { getSettings } from './settings.ts';
import type { Visitor } from '../../shared/records.ts';

export const archiveDir = () => path.join(path.dirname(config.dbPath), 'archives');
const archiveFile = (year: number) => path.join(archiveDir(), `canon-archive-${year}.db`);
const FILE_RE = /^canon-archive-(\d{4})\.db$/;

// ---------------------------------------------------------------- visitors' contact details

/** Erase visitors' contact details (and prayer requests, self-descriptions, notes) from records older than `months`. */
export function eraseVisitorContacts(months: number, today = new Date()): number {
  if (!months) return 0;
  const cutoff = new Date(today);
  cutoff.setMonth(cutoff.getMonth() - months);
  const before = cutoff.toISOString().slice(0, 10);
  const rows = all<{ id: number; visitors: string }>(
    `SELECT r.id, r.visitors FROM service_records r JOIN services s ON s.id = r.service_id WHERE s.date < ? AND r.visitors LIKE '%"%'`, before,
  );
  let n = 0;
  for (const r of rows) {
    const vs = JSON.parse(r.visitors || '[]') as Visitor[];
    if (!vs.some((v) => v.contact || v.prayer || v.about || v.notes)) continue;
    const cleaned = vs.map(({ contact: _c, prayer: _p, about: _a, notes: _n, ...keep }) => keep);
    run('UPDATE service_records SET visitors = ? WHERE id = ?', JSON.stringify(cleaned), r.id);
    n += vs.filter((v) => v.contact || v.prayer || v.about || v.notes).length;
  }
  // visitor cards nobody reviewed are not kept beyond that either
  run(`DELETE FROM visitor_cards WHERE created_at < ?`, before);
  return n;
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

/** Copy one year into its archive file (added to it if it exists), then remove it from the live database. */
function archiveYear(year: number) {
  fs.mkdirSync(archiveDir(), { recursive: true });
  const file = archiveFile(year);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const end = `${to} 23:59:59`;
  const counts = countsFor(year);
  db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS arc`);
  try {
    tx(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS arc.archive_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS arc.services AS SELECT * FROM main.services WHERE 0;
        CREATE TABLE IF NOT EXISTS arc.service_records AS SELECT * FROM main.service_records WHERE 0;
        CREATE TABLE IF NOT EXISTS arc.change_log AS SELECT * FROM main.change_log WHERE 0;
        CREATE TABLE IF NOT EXISTS arc.mcp_audit AS SELECT * FROM main.mcp_audit WHERE 0;
        CREATE TABLE IF NOT EXISTS arc.member_views AS SELECT * FROM main.member_views WHERE 0;
      `);
      const ids = 'SELECT r.service_id FROM main.service_records r JOIN main.services s ON s.id = r.service_id WHERE s.date BETWEEN ? AND ?';
      // the services are copied for context (title, date) and stay in Canon
      run(`DELETE FROM arc.services WHERE id IN (${ids})`, from, to);
      run(`INSERT INTO arc.services SELECT * FROM main.services WHERE id IN (${ids})`, from, to);
      run(`INSERT INTO arc.service_records SELECT * FROM main.service_records WHERE service_id IN (${ids})`, from, to);
      run('INSERT INTO arc.change_log SELECT * FROM main.change_log WHERE at BETWEEN ? AND ?', from, end);
      run('INSERT INTO arc.mcp_audit SELECT * FROM main.mcp_audit WHERE at BETWEEN ? AND ?', from, end);
      run('INSERT INTO arc.member_views SELECT * FROM main.member_views WHERE at BETWEEN ? AND ?', from, end);
      run("INSERT OR REPLACE INTO arc.archive_meta (key, value) VALUES ('year', ?), ('updated_at', datetime('now')), ('schema', ?)", String(year), String(get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? ''));
      run(`DELETE FROM main.visitor_cards WHERE service_id IN (${ids})`, from, to);
      run(`DELETE FROM main.service_records WHERE service_id IN (SELECT r.service_id FROM main.service_records r JOIN main.services s ON s.id = r.service_id WHERE s.date BETWEEN ? AND ?)`, from, to);
      run('DELETE FROM main.change_log WHERE at BETWEEN ? AND ?', from, end);
      run('DELETE FROM main.mcp_audit WHERE at BETWEEN ? AND ?', from, end);
      run('DELETE FROM main.member_views WHERE at BETWEEN ? AND ?', from, end);
    });
  } finally {
    db.exec('DETACH DATABASE arc');
  }
  return { year, ...counts };
}

/** Archive every year older than the setting (or preview it with dryRun). */
export function runArchive(dryRun: boolean, years = getSettings().retention.archive_years ?? 5) {
  if (!years) throw new BadRequest('Archiving is off (Keep in Canon: “all years”).');
  const due = archivableYears(years);
  if (dryRun) return { dry_run: true, years: due };
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
      return { year, name, size: fs.statSync(path.join(dir, name)).size, records: n('service_records'), changes: n('change_log'), ai: n('mcp_audit'), views: n('member_views') };
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
      `SELECT s.id, s.date, s.start_time, s.title, r.attendance, r.children, r.online, r.visitors, r.offerings, r.currency, r.verified_at, r.verified_by
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

/** Copy the archive files into a backup folder (they never change once a year is done; copied when new or grown). */
export function copyArchivesTo(dir: string) {
  const src = archiveDir();
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(dir, 'archives');
  let n = 0;
  for (const name of fs.readdirSync(src).filter((x) => FILE_RE.test(x))) {
    const a = path.join(src, name);
    const b = path.join(dest, name);
    if (fs.existsSync(b) && fs.statSync(b).size === fs.statSync(a).size) continue;
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(a, b);
    n++;
  }
  return n;
}
