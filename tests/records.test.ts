// Service records: attendance, visitors, offerings and the cash count; verification rules and the lock.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-records-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let R: typeof import('../server/repo/records.ts');
let svc: typeof import('../server/repo/services.ts');
let M: typeof import('../shared/records.ts');
let actor: typeof import('../server/lib/actor.ts');
let log: typeof import('../server/repo/changelog.ts');

before(async () => {
  R = await import('../server/repo/records.ts');
  svc = await import('../server/repo/services.ts');
  M = await import('../shared/records.ts');
  actor = await import('../server/lib/actor.ts');
  log = await import('../server/repo/changelog.ts');
});

const editor = { name: 'Ed Itor', admin: false };
const admin = { name: 'Ad Min', admin: true };

test('money helpers: minor units, parsing, totals', () => {
  assert.equal(M.parseMoney('1,234.50'), 123450);
  assert.equal(M.parseMoney('abc'), null);
  assert.equal(M.money(123450, 'SGD', true), 'SGD 1,234.50');
  assert.equal(M.cashTotal({ '5000': 3, '100': 7, '20': 4 }), 15000 + 700 + 80);
  assert.equal(M.methodTotal([{ fund: 'General', method: 'cash', amount: 500 }, { fund: 'General', method: 'transfer', amount: 1000 }], 'cash'), 500);
  assert.equal(M.denomLabel(50), '0.50');
});

test('records: save, verify (two counters, matching count), lock for editors, admin reopen; all logged', () => {
  const s = svc.createService({ date: '2033-02-06' }).service;
  const empty = R.recordFor(s.id);
  assert.equal(empty.saved, false);

  actor.asActor({ user_id: null, user_name: 'Ed Itor', via: 'web' }, () => {
    R.saveRecord(s.id, { attendance: 120, children: 18, visitors: [{ name: 'New Friend', contact: '9000 0000' }], notes: 'Mic 2 crackled' }, editor);
    R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 25080 }, { fund: 'Missions', method: 'transfer', amount: 10000 }], cash: { '5000': 5, '50': 1, '10': 3 } }, editor);
  });
  let r = R.recordFor(s.id);
  assert.equal(r.attendance, 120);
  assert.equal(M.cashTotal(r.cash), 25080);

  assert.throws(() => R.setVerified(s.id, true, editor), /two counters/);
  R.saveRecord(s.id, { counters: ['Ann', 'Ben'], cash: { '5000': 5 } }, editor);
  assert.throws(() => R.setVerified(s.id, true, editor), /does not match/);
  R.saveRecord(s.id, { cash: { '5000': 5, '50': 1, '10': 3 } }, editor);
  const verified = R.setVerified(s.id, true, editor);
  assert.ok(verified.verified_at);
  assert.equal(verified.verified_by, 'Ed Itor');

  // locked: editors can still record attendance and notes, but not money
  assert.throws(() => R.saveRecord(s.id, { offerings: [] }, editor), /Only an administrator/);
  R.saveRecord(s.id, { attendance: 121 }, editor);
  assert.throws(() => R.setVerified(s.id, false, editor), /administrator/);
  R.setVerified(s.id, false, admin);
  assert.equal(R.recordFor(s.id).verified_at, null);

  // read-only users see no money or contact details
  const v = R.forViewer(R.recordFor(s.id));
  assert.deepEqual(v.offerings, []);
  assert.deepEqual(v.visitors, [{ name: 'New Friend', source: undefined }]);

  // the change log has the changes, under the service
  const hist = log.listChanges({ entity: 'services', entity_id: s.id });
  assert.ok(hist.rows.some((x) => x.entity === 'service_records' && x.action === 'create'));
  assert.ok(hist.rows.some((x) => x.entity === 'service_records' && x.changes.offerings));

  const list = R.listRecords({ from: '2033-02-01', to: '2033-02-28' });
  assert.equal(list[0].attendance, 121);
  assert.equal(list[0].offering_total, 35080);
  assert.equal(list[0].visitors, 1);
});
