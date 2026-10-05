// Archive ages per kind (0.13): service records and log entries can be archived after different numbers of years.
// Fictional data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-archive-ages-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const svc = await import('../server/repo/services.ts');
const rec = await import('../server/repo/records.ts');
const A = await import('../server/repo/archive.ts');
const S = await import('../server/repo/settings.ts');
const { db, get, run } = await import('../server/db.ts');

after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const editor = { name: 'Ed', admin: false };
const ids: Record<string, number> = {};
for (const [k, date] of [['y2010', '2010-03-07'], ['y2015', '2015-03-01']] as const) {
  ids[k] = svc.createService({ date, title: { en: `Test ${k}` } }).service.id;
  rec.saveRecord(ids[k], { attendance: 40, offerings: [{ fund: 'General', method: 'transfer', amount: 500 }] }, editor);
}
run("INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, changes) VALUES ('2010-06-01 10:00:00', 'Someone', 'web', 'settings', NULL, 'update', 'Settings', '{}')");
run("INSERT INTO change_log (at, user_name, via, entity, entity_id, action, name, changes) VALUES ('2015-06-01 10:00:00', 'Someone', 'web', 'settings', NULL, 'update', 'Settings', '{}')");
const logs = (y: string) => get<{ n: number }>(`SELECT COUNT(*) AS n FROM change_log WHERE at LIKE '${y}%'`)!.n;

test('logs archived sooner than records: a year can have its logs archived and its records kept', () => {
  const due = A.archivableYears(15, new Date('2026-10-05'), 2);
  assert.deepEqual(due.map((d) => [d.year, d.parts.records, d.parts.logs, d.records]), [[2010, true, true, 1], [2015, false, true, 0]]);
  S.updateSettings({ retention: { ...S.getSettings().retention, archive_years: 15, log_archive_years: 2 } });
  assert.equal(A.logArchiveYears(), 2);
  A.runArchive(false);
  assert.equal(rec.recordFor(ids.y2010).saved, false, '2010 record archived');
  assert.ok(rec.recordFor(ids.y2015).saved, '2015 record kept (15 years)');
  assert.equal(logs('2010'), 0);
  assert.equal(logs('2015'), 0, '2015 log entries archived (2 years)');
  assert.equal((A.archivedChanges(2015, {}) as { rows: unknown[] }).rows.length, 1);
});

test('logs kept (0 = never) while records are archived; unset = the same as records', () => {
  assert.equal(A.logArchiveYears({ ...S.getSettings().retention, log_archive_years: null, archive_years: 7 }), 7);
  const due = A.archivableYears(5, new Date('2026-10-05'), 0);
  assert.deepEqual(due.map((d) => [d.year, d.parts.records, d.parts.logs]), [[2015, true, false]]);
});
