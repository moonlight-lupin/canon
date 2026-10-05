// Reports: attendance, offerings, visitors, serving, songs and Scripture, membership — over a period. Fictional data.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-reports-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let R: typeof import('../server/repo/reports.ts');
let rec: typeof import('../server/repo/records.ts');
let svc: typeof import('../server/repo/services.ts');
let db: typeof import('../server/db.ts');
let S: typeof import('../shared/reports.ts');

const editor = { name: 'Ed Itor', admin: false };
const ids: Record<string, number> = {};

before(async () => {
  db = await import('../server/db.ts');
  R = await import('../server/repo/reports.ts');
  rec = await import('../server/repo/records.ts');
  svc = await import('../server/repo/services.ts');
  S = await import('../shared/reports.ts');

  const person = (first: string, last: string, extra: Record<string, string | null> = {}) => {
    const cols = ['first_name', 'last_name', ...Object.keys(extra)];
    db.run(`INSERT INTO people (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, first, last, ...Object.values(extra));
    return db.get<{ id: number }>('SELECT MAX(id) AS id FROM people')!.id;
  };
  ids.ann = person('Ann', 'Lee', { status: 'member', birth_date: '1990-05-01', gender: 'F', membership_date: '2032-03-10' });
  ids.ben = person('Ben', 'Ong', { status: 'regular', birth_date: '2015-01-01', gender: 'M' });
  ids.cy = person('Cy', 'Tan', { status: 'member', baptism_date: '2032-04-01' });

  // services in March and April 2032, and one a year earlier for the comparison
  for (const [k, date] of [['m1', '2032-03-07'], ['m2', '2032-03-14'], ['a1', '2032-04-04'], ['prev', '2031-03-09']] as const) {
    ids[k] = svc.createService({ date }).service.id;
  }
  rec.saveRecord(ids.m1, { attendance: 100, children: 20, visitors: [{ name: 'Visitor One', source: 'Friend', contact: '9000 0001', status: 'joined' }, { name: 'Visitor Two', source: 'Friend' }] }, editor);
  rec.saveRecord(ids.m2, { attendance: 120, visitors: [{ name: 'Visitor Three', source: 'Website', status: 'contacted' }] }, editor);
  rec.saveRecord(ids.a1, {
    attendance: 110,
    offerings: [
      { fund: 'General', method: 'cash', amount: 5000 }, { fund: 'Missions', method: 'transfer', amount: 2000 },
      { fund: 'General', method: 'cash', amount: 1000, currency: 'USD' },
    ],
    cash: { '5000': 1 }, foreign_cash: { USD: { cash: { '1000': 1 }, converted: 1300 } },
  }, editor);
  rec.saveRecord(ids.prev, { attendance: 80 }, editor);

  // songs and readings
  db.run("INSERT INTO songs (title, category, copyright, ccli) VALUES (?, 'hymn', 'Fictional Music Co.', '1234567')", JSON.stringify({ en: 'Test Hymn One' }));
  ids.song1 = db.get<{ id: number }>('SELECT MAX(id) AS id FROM songs')!.id;
  db.run("INSERT INTO songs (title, category, public_domain) VALUES (?, 'hymn', 1)", JSON.stringify({ en: 'Test Hymn Two' }));
  ids.song2 = db.get<{ id: number }>('SELECT MAX(id) AS id FROM songs')!.id;
  const item = (service: number, pos: number, kind: string, refId: number | null, scripture: string | null) =>
    db.run('INSERT INTO service_items (service_id, position, kind, ref_id, scripture_ref) VALUES (?, ?, ?, ?, ?)', service, pos, kind, refId, scripture);
  item(ids.m1, 900, 'song', ids.song1, null);
  item(ids.m2, 900, 'song', ids.song1, null);
  item(ids.m1, 901, 'scripture', null, 'Psalm 23');
  item(ids.m2, 901, 'scripture', null, 'see the bulletin');
  db.run('UPDATE services SET sermon_ref = ? WHERE id = ?', 'John 3:16-21', ids.a1);

  // a team with a role: Ann serves twice, Ben declines once, Cy is on the team but never rostered
  db.run('INSERT INTO teams (name) VALUES (?)', JSON.stringify({ en: 'Test Team' }));
  const team = db.get<{ id: number }>('SELECT MAX(id) AS id FROM teams')!.id;
  db.run("INSERT INTO groups (name, kind) VALUES (?, 'serving_team')", JSON.stringify({ en: 'Test Team' }));
  const group = db.get<{ id: number }>('SELECT MAX(id) AS id FROM groups')!.id;
  db.run('UPDATE teams SET group_id = ? WHERE id = ?', group, team);
  for (const p of [ids.ann, ids.ben, ids.cy]) db.run('INSERT INTO group_members (group_id, person_id) VALUES (?, ?)', group, p);
  db.run('INSERT INTO roles (team_id, name, needed) VALUES (?, ?, 2)', team, JSON.stringify({ en: 'Test Usher' }));
  ids.role = db.get<{ id: number }>('SELECT MAX(id) AS id FROM roles')!.id;
  db.run('INSERT INTO role_members (role_id, person_id) VALUES (?, ?), (?, ?)', ids.role, ids.ann, ids.role, ids.ben);
  db.run("INSERT INTO assignments (service_id, role_id, person_id, status) VALUES (?, ?, ?, 'confirmed'), (?, ?, ?, 'scheduled'), (?, ?, ?, 'declined')",
    ids.m1, ids.role, ids.ann, ids.m2, ids.role, ids.ann, ids.m2, ids.role, ids.ben);
});

const P = { from: '2032-03-01', to: '2032-04-30' };

test('helpers: periods, months, age bands, moving average, CSV', () => {
  assert.deepEqual(S.monthsBetween('2031-11-15', '2032-02-01'), ['2031-11', '2031-12', '2032-01', '2032-02']);
  assert.equal(S.yearEarlier('2032-02-29'), '2031-02-28');
  assert.equal(S.ageBand('1990-05-01', '2032-04-30'), '40–49');
  assert.equal(S.ageBand('1990-05-01', '2030-04-30'), '30–39');
  assert.equal(S.ageBand(null, '2032-01-01'), 'unknown');
  assert.deepEqual(S.movingAverage([10, null, 20, 30], 2), [10, 10, 20, 25]);
  assert.equal(S.toCsv([['a,b', '=SUM(1)', -5]]), '﻿"a,b",\'=SUM(1),-5\r\n');
  assert.throws(() => R.period({ from: '2032-05-01', to: '2032-04-01' }), /after its end/);
});

test('attendance: summary, months and the same period a year earlier', () => {
  const a = R.attendanceReport(P);
  assert.equal(a.summary.services, 3);
  assert.equal(a.summary.recorded, 3);
  assert.equal(a.summary.average, 110);
  assert.equal(a.summary.highest?.value, 120);
  assert.equal(a.summary.visitors, 3);
  assert.deepEqual(a.months.map((m) => [m.month, m.average]), [['2032-03', 110], ['2032-04', 110]]);
  assert.equal(a.previous.average, 80);
});

test('offerings: church currency by fund and method, other currencies apart, unverified listed', () => {
  const o = R.offeringsReport(P);
  assert.equal(o.total, 7000);
  assert.deepEqual(o.by_fund, [{ fund: 'General', total: 5000 }, { fund: 'Missions', total: 2000 }]);
  assert.deepEqual(o.other_currencies, [{ currency: 'USD', total: 1000, cash: 1000, converted: 1300 }]);
  assert.equal(o.unverified.length, 1);
  assert.equal(o.services[0].other[0].currency, 'USD');
});

test('visitors: funnel counts each step reached; contact details only when allowed', () => {
  const v = R.visitorsReport(P, { contact: false });
  assert.deepEqual(v.funnel, { new: 3, contacted: 2, returning: 1, joined: 1 });
  assert.equal(v.sources[0].source, 'Friend');
  assert.ok(v.visitors.every((x) => !('contact' in x)));
  assert.equal(R.visitorsReport(P, { contact: true }).visitors.find((x) => x.name === 'Visitor One')?.contact, '9000 0001');
});

test('serving: times served, team members not rostered, roles short of people', () => {
  const s = R.servingReport(P);
  const ann = s.people.find((p) => p.person_id === ids.ann)!;
  assert.equal(ann.served, 2);
  assert.equal(ann.confirmed, 1);
  assert.equal(s.people.find((p) => p.person_id === ids.ben)?.declined, 1);
  assert.deepEqual(s.idle.map((p) => p.person_id).sort(), [ids.ben, ids.cy].sort());
  const role = s.roles.find((r) => r.role_id === ids.role)!;
  assert.deepEqual([role.services, role.short, role.declined, role.qualified], [2, 2, 1, 2]);
});

test('songs: usage with copyright details, unused songs', () => {
  const s = R.songsReport(P);
  const one = s.songs.find((x) => x.song_id === ids.song1)!;
  assert.equal(one.times, 2);
  assert.equal(one.ccli, '1234567');
  assert.ok(s.unused.some((x) => x.song_id === ids.song2));
});

test('Scripture: every book and chapter, read and preached, by period or by chosen years', () => {
  assert.deepEqual(R.chaptersOf('Gen 1:1-2:3; Romans 8'), [{ book: 1, chapters: [1, 2] }, { book: 45, chapters: [8] }]);
  assert.deepEqual(R.chaptersOf('Ps 23-24'), [{ book: 19, chapters: [23, 24] }]);
  assert.deepEqual(R.chaptersOf('see the bulletin'), []);

  const s = R.scriptureReport(P);
  assert.equal(s.books.length, 66);
  assert.equal(s.books[18].chapters, 150);
  assert.equal(s.books[18].read[22], 1, 'Psalm 23 read');
  assert.equal(s.books[42].preached[2], 1, 'John 3 preached');
  assert.equal(s.totals.chapters, 1189);
  assert.deepEqual([s.totals.read, s.totals.preached, s.totals.covered, s.totals.ot_covered, s.totals.nt_covered, s.totals.books_covered], [1, 1, 2, 1, 1, 2]);
  assert.equal(s.passages.length, 3);
  assert.deepEqual(s.passages.find((x) => x.ref === 'see the bulletin')?.chapters, [], 'free text is listed but not counted');

  // years need not follow each other: 2030 and 2032, not 2031
  const old = svc.createService({ date: '2030-06-02' }).service.id;
  db.run('INSERT INTO service_items (service_id, position, kind, scripture_ref) VALUES (?, 900, ?, ?)', old, 'scripture', 'Genesis 1:1-2:3');
  const y = R.scriptureReport({ years: [2032, 2030] });
  assert.deepEqual(y.years, [2030, 2032]);
  assert.ok(y.years_available.includes(2031) && y.years_available.includes(2030));
  assert.deepEqual(y.books[0].read.slice(0, 3), [1, 1, 0]);
  assert.equal(y.books[18].read[22], 1);
  assert.equal(y.books[18].read.length, 150);
  assert.equal(R.scriptureReport({ years: [2031] }).totals.covered, 0, 'the 2031 service has no readings');
});

test('membership: status, age bands, joined and baptised in the period', () => {
  const m = R.membershipReport(P);
  assert.equal(m.by_status.find((x) => x.status === 'member')?.count, 2);
  assert.equal(m.age_bands.find((b) => b.band === '40–49')?.count, 1);
  assert.equal(m.age_bands.find((b) => b.band === '13–19')?.count, 1); // Ben, 17
  assert.equal(m.age_bands.find((b) => b.band === '0–12')?.count, 0);
  assert.deepEqual(m.joined.map((j) => j.name), ['Ann Lee']);
  assert.deepEqual(m.baptised.map((j) => j.name), ['Cy Tan']);
});
