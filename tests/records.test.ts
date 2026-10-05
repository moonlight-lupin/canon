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
let settings: typeof import('../server/repo/settings.ts');

before(async () => {
  R = await import('../server/repo/records.ts');
  svc = await import('../server/repo/services.ts');
  M = await import('../shared/records.ts');
  actor = await import('../server/lib/actor.ts');
  log = await import('../server/repo/changelog.ts');
  settings = await import('../server/repo/settings.ts');
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
  assert.deepEqual(v.visitors, [{ name: 'New Friend', source: undefined, status: undefined }]);

  // the change log has the changes, under the service
  const hist = log.listChanges({ entity: 'services', entity_id: s.id });
  assert.ok(hist.rows.some((x) => x.entity === 'service_records' && x.action === 'create'));
  assert.ok(hist.rows.some((x) => x.entity === 'service_records' && x.changes.offerings));

  const list = R.listRecords({ from: '2033-02-01', to: '2033-02-28' });
  assert.equal(list[0].attendance, 121);
  assert.equal(list[0].offering_total, 35080);
  assert.equal(list[0].visitors, 1);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('other currencies: counted and totalled apart, each must match before verifying', () => {
  const s = svc.createService({ date: '2033-03-06' }).service;
  R.saveRecord(s.id, {
    offerings: [
      { fund: 'General', method: 'cash', amount: 5000 },
      { fund: 'General', method: 'cash', amount: 2000, currency: 'USD' },
      { fund: 'Missions', method: 'cash', amount: 100000, currency: 'THB' },
    ],
    cash: { '5000': 1 }, counters: ['Ann', 'Ben'],
  }, editor);
  assert.throws(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 1, currency: 'usd' }] }, editor), /currency code/);
  // the USD and THB cash is not counted yet
  assert.throws(() => R.setVerified(s.id, true, editor), /THB.*USD/);
  R.saveRecord(s.id, { foreign_cash: { USD: { cash: { '1000': 2 } }, THB: { total: 100000, converted: 3900 } } }, editor);
  assert.deepEqual(M.countProblems(R.recordFor(s.id)), []);
  assert.ok(R.setVerified(s.id, true, editor).verified_at);

  const row = R.listRecords({ from: '2033-03-01', to: '2033-03-31' })[0];
  assert.equal(row.offering_total, 5000); // the church's currency only
  assert.deepEqual(row.other_currencies, [{ currency: 'THB', total: 100000 }, { currency: 'USD', total: 2000 }]);
});

test('on-screen signing: only when chosen, needs a matching count, two signatures verify, a money change clears them', () => {
  const s = svc.createService({ date: '2033-04-03' }).service;
  R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 7000 }], cash: { '5000': 1, '1000': 1 } }, editor);
  assert.throws(() => R.sign(s.id, { name: 'Ann', image: PNG }, editor), /on paper/);

  settings.updateSettings({ offering: { ...settings.getSettings().offering, signing: 'screen' } });
  try {
    assert.throws(() => R.setVerified(s.id, true, editor), /signs on screen/);
    assert.throws(() => R.sign(s.id, { name: 'Ann', image: 'data:text/html,<b>x</b>' }, editor), /could not be read/);
    R.saveRecord(s.id, { cash: { '5000': 1 } }, editor);
    assert.throws(() => R.sign(s.id, { name: 'Ann', image: PNG }, editor), /does not match/);
    R.saveRecord(s.id, { cash: { '5000': 1, '1000': 2 } }, editor);

    let r = R.sign(s.id, { name: 'Ann', image: PNG }, editor);
    assert.equal(r.signatures.length, 1);
    assert.equal(r.verified_at, null);
    // signing again under the same name replaces the signature
    r = R.sign(s.id, { name: 'ann', image: PNG }, editor);
    assert.equal(r.signatures.length, 1);
    r = R.sign(s.id, { name: 'Ben', image: PNG }, editor);
    assert.equal(r.signatures.length, 2);
    assert.ok(r.verified_at);
    assert.deepEqual(r.counters, ['ann', 'Ben']);
    assert.throws(() => R.sign(s.id, { name: 'Cy', image: PNG }, editor), /already verified/);
    assert.throws(() => R.unsign(s.id, 'Ben', editor), /administrator/);

    // notes and attendance do not disturb the signatures; money cannot change while verified, even for an administrator
    R.saveRecord(s.id, { attendance: 80 }, editor);
    assert.equal(R.recordFor(s.id).signatures.length, 2);
    assert.throws(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 7500 }] }, admin), /Reopen the cash count first/);

    // reopening a signed count asks for new signatures; a money change before signing again drops a stale signature
    r = R.setVerified(s.id, false, admin);
    assert.deepEqual(r.signatures, []);
    R.sign(s.id, { name: 'Ann', image: PNG }, editor);
    r = R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 7000 }], cash: { '5000': 1, '1000': 2 }, attendance: 81 }, editor);
    assert.equal(r.signatures.length, 1, 'an unchanged copy of the money keeps the signature');
    r = R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 6000 }], cash: { '5000': 1, '1000': 1 } }, editor);
    assert.deepEqual(r.signatures, [], 'a changed count drops it');
    assert.deepEqual(R.forViewer(R.recordFor(s.id)).signatures, []);
  } finally {
    settings.updateSettings({ offering: { ...settings.getSettings().offering, signing: 'paper' } });
  }
});

test('review fixes: verified money is locked for everyone, an unchanged full payload saves, recorded services cannot be deleted', () => {
  const s = svc.createService({ date: '2033-05-01' }).service;
  const money = { offerings: [{ fund: 'General', method: 'cash' as const, amount: 5000 }], cash: { '5000': 1 }, counters: ['Ann', 'Ben'], currency: 'SGD' };
  R.saveRecord(s.id, { attendance: 70, ...money }, editor);
  R.setVerified(s.id, true, editor);

  // the editor's screen sends the whole record: attendance changes, the money is unchanged — accepted
  const r = R.saveRecord(s.id, { attendance: 72, notes: 'late start', visitors: [], ...money, foreign_cash: {} }, editor);
  assert.equal(r.attendance, 72);
  assert.ok(r.verified_at);

  // a paper-verified count: no money change for anyone without reopening
  assert.throws(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 9999 }] }, editor), /Only an administrator/);
  assert.throws(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 9999 }] }, admin), /Reopen the cash count first/);
  assert.throws(() => R.saveRecord(s.id, { counters: ['Ann', 'Someone Else'] }, admin), /Reopen/);
  assert.equal(R.recordFor(s.id).offerings[0].amount, 5000);

  // the service cannot be deleted while it has a record; the record only by an administrator, after reopening
  assert.throws(() => R.assertServiceDeletable(s.id), /cannot be deleted/);
  assert.throws(() => R.deleteRecord(s.id, { admin: false }), /Only an administrator/);
  assert.throws(() => R.deleteRecord(s.id, { admin: true }), /Reopen it first/);
  R.setVerified(s.id, false, admin);
  assert.deepEqual(R.deleteRecord(s.id, { admin: true }), { deleted: true });
  R.assertServiceDeletable(s.id);
});

test('change log keeps money in full (signatures without images), written with the change', () => {
  const s = svc.createService({ date: '2033-05-08' }).service;
  const long = Array.from({ length: 30 }, (_, i) => ({ fund: `Fund number ${i}`, method: 'transfer' as const, amount: 1000 + i, note: 'a fairly long note for this line' }));
  actor.asActor({ user_id: null, user_name: 'Ed Itor', via: 'web' }, () => R.saveRecord(s.id, { offerings: long }, editor));
  const row = log.listChanges({ entity: 'services', entity_id: s.id }).rows.find((x) => x.entity === 'service_records')!;
  const offerings = row.changes.offerings[1] as unknown;
  const parsed = typeof offerings === 'string' ? JSON.parse(offerings) : offerings;
  assert.equal(parsed.length, 30, 'not shortened');
});
