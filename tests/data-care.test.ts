// Data care, from the Daedalus Workshop's code study of 0.19.10: claim numbers past 9999, posted journals frozen
// whole, the daily tidy's duties apart (privacy erasure first, and a warning when it fails), Canon's own changes in
// the change log, secrets and personal data out of it, the congregation wall on every list, uploads judged by their
// bytes, and library reminders that can't go out twice. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-data-care-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { seed } = await import('../server/seed/index.ts');
const { createUser } = await import('../server/auth.ts');
const B = await import('../server/repo/bookkeeping.ts');
const C = await import('../server/repo/bk-claims.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { db, get, run, all } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const logChangeOf = async (entity: string, summary: string) => (await import('../server/repo/changelog.ts')).logChange({ entity, entity_id: null, action: 'update', summary });
const web = <T,>(fn: () => T) => asActor({ user_id: 1, user_name: 'Test Treasurer', via: 'web' }, fn);
const acc = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)!.id;
const fund = (code: string) => get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', code)!.id;

before(async () => {
  await seed();
  await createUser({ username: 'treasurer', display_name: 'Test Treasurer', password: 'correct-horse-7', role: 'admin' });
  web(() => B.setupBooks({ start_date: '2030-01-01', year_end_month: 12, template: true }));
});

after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 32. claim numbers

test('32. claim numbers go on past 9999 in a year (a text sort put C-9999 after C-10000, and every submission collided)', () => {
  const y = C.claimYear();
  run("INSERT INTO bk_claims (number, claimant, status) VALUES (?, 'Claimant Example', 'submitted')", `C${y}-9999`);
  assert.equal(C.nextClaimNumber(), `C${y}-10000`);
  run("INSERT INTO bk_claims (number, claimant, status) VALUES (?, 'Claimant Example', 'submitted')", `C${y}-10000`);
  assert.equal(C.nextClaimNumber(), `C${y}-10001`);
});

// ---------------------------------------------------------------- 29. posted journals

const line = (code: string, debit: number, credit: number) => ({ account_id: acc(code), fund_id: fund('GEN'), debit, credit });

test('29. a posted journal is frozen whole: every column but a declared few, and no line can be moved into it', () => {
  const posted = web(() => B.postJournal(web(() => B.saveDraft(null, { date: '2030-02-01', memo: 'Rent (fictional)', lines: [line('5500', 1000, 0), line('1100', 0, 1000)] })).id));
  const draft = web(() => B.saveDraft(null, { date: '2030-02-02', memo: 'Draft (fictional)', lines: [line('5500', 500, 0), line('1100', 0, 500)] }));
  const svc = Number(run("INSERT INTO services (date) VALUES ('2030-02-03')").lastInsertRowid);
  const frozen = /posted journal cannot be changed/;
  assert.throws(() => run('UPDATE bk_journals SET service_id = ? WHERE id = ?', svc, posted.id), frozen, 're-linked to another service');
  assert.throws(() => run("UPDATE bk_journals SET created_by = 'Someone else' WHERE id = ?", posted.id), frozen);
  assert.throws(() => run("UPDATE bk_journals SET created_via = 'mcp' WHERE id = ?", posted.id), frozen);
  const draftLine = get<{ id: number }>('SELECT id FROM bk_lines WHERE journal_id = ?', draft.id)!.id;
  assert.throws(() => run('UPDATE bk_lines SET journal_id = ? WHERE id = ?', posted.id, draftLine), frozen, 'a draft line moved into a posted journal');
  // every column is frozen, but for those declared here (kept, with why, in the migration)
  const EXEMPT = ['updated_at', 'revision', 'reversed_by_id', 'service_id'];
  const trigger = get<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'bk_journals_posted_update'")!.sql;
  for (const { name } of all<{ name: string }>('PRAGMA table_info(bk_journals)')) {
    if (!EXEMPT.includes(name)) assert.ok(trigger.includes(`NEW.${name} IS NOT OLD.${name}`), `bk_journals.${name} is not frozen once posted`);
  }
  // the service of an offering journal can still be deleted (its link is cleared, nothing else changes)
  const offering = web(() => B.saveDraft(null, { date: '2030-02-04', memo: 'Offering (fictional)', lines: [line('1100', 700, 0), line('4000', 0, 700)] }));
  run('UPDATE bk_journals SET service_id = ? WHERE id = ?', svc, offering.id);
  web(() => B.postJournal(offering.id));
  run('DELETE FROM services WHERE id = ?', svc);
  assert.equal(get<Json>('SELECT service_id FROM bk_journals WHERE id = ?', offering.id)!.service_id, null);
});

// ---------------------------------------------------------------- 13 + 15. the daily tidy

const { dailyTidy, TIDY_DUTIES, startBackupScheduler, stopSchedulers } = await import('../server/repo/backups.ts');
const { securityChecklist } = await import('../server/repo/security.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');

function oldVisitor(date: string) {
  const sid = Number(run('INSERT INTO services (date) VALUES (?)', date).lastInsertRowid);
  run('INSERT INTO service_records (service_id, visitors) VALUES (?, ?)', sid, JSON.stringify([{ name: 'Old Visitor', contact: 'old.visitor@example.org' }]));
  return sid;
}
const visitorsOf = (sid: number) => get<{ visitors: string }>('SELECT visitors FROM service_records WHERE service_id = ?', sid)!.visitors;

test('13. one duty of the daily tidy failing doesn’t skip the others: visitors’ details are still erased, and the failure shows', async () => {
  updateSettings({ retention: { ...getSettings().retention, visitor_contact_months: 12 } });
  const sid = oldVisitor('2020-03-01');
  const lines: string[] = [];
  await dailyTidy((s) => lines.push(s), [{ key: 'logs', what: 'Pruning the logs', run: () => { throw new Error('disk is full (test)'); } }, ...TIDY_DUTIES]);
  assert.doesNotMatch(visitorsOf(sid), /old\.visitor@/, 'erased although an earlier duty failed');
  assert.ok(lines.some((l) => /Pruning the logs failed.*disk is full/.test(l)), lines.join('\n'));
  const tidy = securityChecklist().find((i) => i.key === 'tidy')!;
  assert.equal(tidy.status, 'warn');
  assert.match(tidy.detail, /Pruning the logs/);
  // a good run clears it
  await dailyTidy(() => undefined);
  assert.equal(securityChecklist().find((i) => i.key === 'tidy')?.status ?? 'ok', 'ok');
});

test('13. the privacy erasure failing is a warning of its own on the Security checklist until it works again', async () => {
  const failing = TIDY_DUTIES.map((d) => (d.key === 'erase' ? { ...d, run: () => { throw new Error('archive 2019 can’t be opened (test)'); } } : d));
  await dailyTidy(() => undefined, failing);
  const item = securityChecklist().find((i) => i.key === 'tidy')!;
  assert.equal(item.status, 'warn');
  assert.match(item.detail, /contact details are not being erased/);
  assert.match(item.detail, /archive 2019/);
  await dailyTidy(() => undefined);
  assert.equal(securityChecklist().find((i) => i.key === 'tidy')?.status ?? 'ok', 'ok');
});

test('15. what Canon does by itself (the daily tidy) is in the change log, by “Canon”', async () => {
  oldVisitor('2020-04-05');
  await dailyTidy(() => undefined);
  const row = get<Json>("SELECT * FROM change_log WHERE via = 'system' AND summary LIKE '%erased%' ORDER BY id DESC LIMIT 1");
  assert.ok(row, 'the erasure is logged');
  assert.equal(row!.user_name, 'Canon');
  assert.equal(row!.user_id, null);
});

// ---------------------------------------------------------------- 28. reminders once, timers stopped

test('28. “Send now” while the daily reminders are going out sends nobody a second e-mail', async () => {
  const mailer = await import('../server/lib/mailer.ts');
  const L = await import('../server/repo/lending.ts');
  const { sendLoanReminders } = await import('../server/repo/lending-reminders.ts');
  const outbox: string[] = [];
  mailer.setTransportFactory(() => ({ async sendMail(m: { to: string }) { outbox.push(m.to); return { messageId: 'x' }; } }) as never);
  updateSettings({ smtp: { host: 'smtp.example.org', port: 587, secure: false, user: '', from_name: 'Grace', from_email: 'office@example.org', reply_to: '' } } as never);
  try {
    const pid = Number(run("INSERT INTO people (first_name, last_name, status, email) VALUES ('Borrower', 'Example', 'member', 'borrower@example.org')").lastInsertRowid);
    const book = L.saveBook(null, { title: 'A Book (fictional)' } as never, 1);
    const copy = get<{ id: number }>('SELECT id FROM lending_copies WHERE book_id = ?', book.id)!.id;
    const loan = L.lend({ copy_id: copy, person_id: pid }, null);
    run('UPDATE lending_loans SET due_on = ? WHERE id = ?', L.addDays(L.localToday(), -3), loan.id);
    const [a, b] = await Promise.allSettled([sendLoanReminders(), sendLoanReminders()]);
    assert.equal(outbox.filter((t) => t === 'borrower@example.org').length, 1, 'one e-mail');
    const refused = [a, b].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    assert.ok(refused, 'the second run is refused while the first is sending');
    assert.equal(refused!.reason.status, 409);
  } finally {
    mailer.setTransportFactory(null);
  }
});

test('28. the background timers are stopped when Canon stops', () => {
  startBackupScheduler(() => undefined);
  assert.ok(stopSchedulers() >= 3, 'the backup check, the daily tidy and their first runs');
  assert.equal(stopSchedulers(), 0, 'nothing left running');
});

// ---------------------------------------------------------------- 16. secrets and personal data in the change log

test('16. a secret is kept out of the change log by what it is called, also inside a value (a new secret column too)', async () => {
  const { diff } = await import('../server/repo/changelog.ts');
  const d = diff(null, { name: 'Example', api_key: 'k-111', reset_token: 't-222', client_secret: 's-333', attendee: JSON.stringify({ token: 'a-444', on: true }), visitor_form: { token: 'v-555', open: true } }, 'services');
  const text = JSON.stringify(d);
  for (const secret of ['k-111', 't-222', 's-333', 'a-444', 'v-555']) assert.ok(!text.includes(secret), `${secret} logged: ${text}`);
  assert.match(text, /\\"on\\":true/, 'the rest of the value is kept (JSON kept as text)');
  assert.match(text, /"open":true/);
  assert.ok('name' in d);
  const cw = diff({ position: 'Elder' }, { position: 'Pastor' }, 'coworkers');
  assert.deepEqual(cw.position, ['Elder', 'Pastor'], 'a co-worker’s position is a job title: logged (an order elsewhere is not)');
  assert.equal(diff({ position: 1 }, { position: 2 }, 'service_items').position, undefined);
});

test('16. erasing a member reaches their entries in the change log by who they are about, and their contact details anywhere in it', async () => {
  const reg = await import('../server/repo/registers.ts');
  const vol = await import('../server/repo/volunteers.ts');
  const { erasePerson } = await import('../server/repo/pdpa.ts');
  const pid = web(() => reg.people.insert({ first_name: 'Erin', last_name: 'Erasable', email: 'Erin.Erasable@example.org', phone: '+65 8123 4567', status: 'member' } as never)).id;
  // an away date with its reason, deleted before the erasure (it can't be found by its id any more)
  const away = web(() => vol.unavailability.insert({ person_id: pid, start_date: '2030-05-01', end_date: '2030-05-09', reason: 'Chemotherapy (private)' } as never));
  web(() => vol.unavailability.remove(away.id));
  // the e-mail in another entry, written in another case
  await web(() => logChangeOf('settings', 'Approver e-mail set to erin.erasable@example.org; phone +65 8123 4567'));
  web(() => erasePerson(pid, 'Erin Erasable'));
  const log = JSON.stringify(all('SELECT name, summary, changes FROM change_log'));
  for (const leak of ['Chemotherapy', 'erin.erasable@', 'Erin.Erasable@', '8123 4567']) assert.ok(!log.includes(leak), `${leak} still in the change log`);
});

// ---------------------------------------------------------------- 14. the wall on lists

test('14. the record helper’s list keeps to the congregation wall, as get, insert, update and remove do', async () => {
  const reg = await import('../server/repo/registers.ts');
  const c1 = Number(run("INSERT INTO congregations (code, name) VALUES ('EN', '{\"en\":\"English\"}')").lastInsertRowid);
  const c2 = Number(run("INSERT INTO congregations (code, name) VALUES ('ID', '{\"en\":\"Indonesian\"}')").lastInsertRowid);
  run("INSERT INTO people (first_name, last_name, congregation_id) VALUES ('Walled', 'Ours', ?), ('Walled', 'Theirs', ?), ('Walled', 'Everyones', NULL)", c1, c2);
  const walled = asActor({ user_id: 1, user_name: 'Secretary (English)', via: 'web', congregation_id: c1 }, () => reg.people.list("first_name = 'Walled'").map((p) => p.last_name));
  assert.deepEqual(walled.sort(), ['Everyones', 'Ours'], 'another congregation’s member is not listed');
  const all3 = web(() => reg.people.list("first_name = 'Walled'"));
  assert.equal(all3.length, 3, 'an account of the whole church lists everyone');
});

// ---------------------------------------------------------------- 12. uploads judged by their bytes

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0xff, 0xd9]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');
const assetMime = (key: string) => get<{ mime: string }>('SELECT mime FROM assets WHERE key = ?', key)?.mime;

test('12. an upload is stored as what its bytes are, not what the browser or the file says; anything else is refused', async () => {
  const { saveImage, imageKey } = await import('../server/repo/images.ts');
  const P = await import('../server/repo/presentation.ts');
  const { importTemplateFile } = await import('../server/repo/template-files.ts');
  const img = web(() => saveImage(null, 'Poster (fictional)', 'image/png', JPEG));
  assert.equal(img.mime, 'image/jpeg', 'a JPEG sent as a PNG is a JPEG');
  assert.equal(assetMime(imageKey(img.id)), 'image/jpeg');
  // the repo itself checks, whoever calls it (a route, an imported template, a library file)
  const block = web(() => P.createBlock({ kind: 'image', name: 'Picture block (fictional)' } as never));
  assert.throws(() => web(() => P.setBlockImage(block.id, 'text/html', HTML)), /PNG, JPEG or WebP/);
  assert.throws(() => web(() => P.setBlockImage(block.id, 'image/png', HTML)), /PNG, JPEG or WebP/, 'a page sent as a picture');
  web(() => P.setBlockImage(block.id, 'image/webp', PNG));
  assert.equal(assetMime(`bulletin-block-${block.id}`), 'image/png');
  // a template file whose picture isn't one: the template comes in, without it
  const made = web(() => importTemplateFile({ canon: 'slide-template', version: 1, template: { name: { en: 'Imported (fictional)' }, base: 'dark', vars: {}, css: '', background: { mime: 'image/png', data: HTML.toString('base64') } } }));
  assert.equal(made.kind, 'slide');
  assert.equal(assetMime(`slide-theme-${made.id}-bg`), undefined, 'no page stored as a background');
  // a receipt: a PDF sent as a PNG is kept as the PDF it is
  const { checkUpload } = await import('../server/repo/equipment.ts');
  assert.equal(checkUpload('image/png', Buffer.from('%PDF-1.4 fictional'), 'receipt.png').mime, 'application/pdf');
  assert.throws(() => checkUpload('application/pdf', HTML, 'receipt.pdf'), /PNG, JPEG, WebP\) and PDF/);
});
