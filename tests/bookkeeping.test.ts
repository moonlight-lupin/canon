// 0.17.0 book-keeping: the module switch and who may use it, starting the books from the church template, balanced
// journals posted with numbers and never changed (reversed instead — the database refuses changes too), closed
// periods, the reports (balanced, with earlier years' surplus in the funds), verified offerings drafted into the
// books (only the difference when a count is corrected), and the export. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-books-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const B = await import('../server/repo/bookkeeping.ts');
const Rp = await import('../server/repo/bk-reports.ts');
const R = await import('../server/repo/records.ts');
const svc = await import('../server/repo/services.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<string, Session> = {};

async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const txt = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(txt);
  } catch { /* CSV */ }
  return { status: r.status, body: json as Json, text: txt };
}
async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
const web = <T,>(fn: () => T) => asActor({ user_id: 1, user_name: 'Test Treasurer', via: 'web' }, fn);

before(async () => {
  await seed();
  updateSettings({ offering: { ...getSettings().offering, currency: 'SGD', funds: ['General', 'Missions'] } });
  for (const [u, role] of [['admin', 'admin'], ['treasurer', 'treasurer'], ['viewer', 'viewer'], ['editor', 'editor']]) {
    createUser({ username: u, display_name: `Test ${u}`, password: 'correct-horse-7', role });
  }
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'treasurer', 'viewer', 'editor']) as[u] = await login(u);
});
after(() => {
  server.close();
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const acc = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)!.id;
const fund = (code: string) => get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', code)!.id;

test('off until switched on; then the treasurer keeps the books, editors and read-only accounts don’t', async () => {
  assert.equal((await call(as.admin, 'GET', '/bookkeeping')).status, 404, 'module off');
  assert.equal((await call(as.admin, 'PUT', '/modules', { ...getSettings().modules, bookkeeping: true })).status, 200);
  assert.equal((await call(as.treasurer, 'GET', '/bookkeeping')).status, 200);
  assert.equal((await call(as.viewer, 'GET', '/bookkeeping')).status, 403);
  assert.equal((await call(as.editor, 'GET', '/bookkeeping')).status, 403, 'editors don’t see the books');
  const r = await call(as.treasurer, 'PUT', '/bookkeeping/setup', { start_date: '2030-01-01', year_end_month: 12, template: true });
  assert.equal(r.status, 200, r.text);
  assert.ok(get('SELECT 1 FROM bk_accounts WHERE code = ?', '4000'));
  const s = B.bkSettings();
  assert.equal(s.fund_map.General.fund_id, fund('GEN'));
  assert.equal(s.fund_map.Missions.fund_id, fund('MIS'));
  assert.equal(s.method_accounts.paynow, acc('1100'));
});

test('opening balances, then journals: balanced to post, numbered, never changed — reversed instead', async () => {
  // opening balances on the start date: bank 10,000 in the general fund, 2,000 for missions
  const open = (await call(as.treasurer, 'POST', '/bookkeeping/journals', {
    date: '2030-01-01', kind: 'opening', memo: 'Opening balances', lines: [
      { account_id: acc('1100'), fund_id: fund('GEN'), debit: 1000000 },
      { account_id: acc('1100'), fund_id: fund('MIS'), debit: 200000 },
      { account_id: acc('3000'), fund_id: fund('GEN'), credit: 1000000 },
      { account_id: acc('3000'), fund_id: fund('MIS'), credit: 199000 },
    ],
  })).body;
  let p = await call(as.treasurer, 'POST', `/bookkeeping/journals/${open.id}/post`);
  assert.equal(p.status, 400);
  assert.match(p.body.error, /must be equal/);
  await call(as.treasurer, 'PUT', `/bookkeeping/journals/${open.id}`, { date: '2030-01-01', kind: 'opening', memo: 'Opening balances', lines: [
    { account_id: acc('1100'), fund_id: fund('GEN'), debit: 1000000 }, { account_id: acc('1100'), fund_id: fund('MIS'), debit: 200000 },
    { account_id: acc('3000'), fund_id: fund('GEN'), credit: 1000000 }, { account_id: acc('3000'), fund_id: fund('MIS'), credit: 200000 },
  ] });
  p = await call(as.treasurer, 'POST', `/bookkeeping/journals/${open.id}/post`);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.body.number, '2030-0001');

  // an expense: rent from the general fund
  const rent = web(() => B.saveDraft(null, { date: '2030-02-01', memo: 'February rent', lines: [
    { account_id: acc('5500'), fund_id: fund('GEN'), debit: 150000, credit: 0 }, { account_id: acc('1100'), fund_id: fund('GEN'), debit: 0, credit: 150000 },
  ] }));
  const posted = web(() => B.postJournal(rent.id));
  assert.equal(posted.number, '2030-0002');
  // posted: no changes through Canon …
  assert.equal((await call(as.treasurer, 'PUT', `/bookkeeping/journals/${rent.id}`, { date: '2030-02-02', lines: [] })).status, 409);
  assert.equal((await call(as.treasurer, 'DELETE', `/bookkeeping/journals/${rent.id}`)).status, 409);
  // … nor in the database itself
  assert.throws(() => run('UPDATE bk_lines SET debit = 1 WHERE journal_id = ?', rent.id), /cannot be changed/);
  assert.throws(() => run('UPDATE bk_journals SET date = ? WHERE id = ?', '2030-03-01', rent.id), /cannot be changed/);
  assert.throws(() => run('DELETE FROM bk_journals WHERE id = ?', rent.id), /cannot be deleted/);
  // reversed instead
  const rev = (await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, { date: '2030-02-03' })).body;
  assert.equal(rev.kind, 'reversal');
  assert.equal(rev.lines[0].credit, 150000);
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, {})).status, 409, 'only once');
  assert.equal(B.getJournal(rent.id).reversed_by_id, rev.id);
  // AI assistants draft, never post
  const draft = web(() => B.saveDraft(null, { date: '2030-02-05', lines: [
    { account_id: acc('5700'), fund_id: fund('GEN'), debit: 500, credit: 0 }, { account_id: acc('1100'), fund_id: fund('GEN'), debit: 0, credit: 500 },
  ] }));
  assert.throws(() => asActor({ user_id: 1, user_name: 'Claude', via: 'mcp' }, () => B.postJournal(draft.id)), /a person posts/);
  web(() => B.postJournal(draft.id));
});

test('closed periods: nothing posted on or before the close; drafts there block it; administrators reopen', async () => {
  const d = web(() => B.saveDraft(null, { date: '2030-03-10', lines: [
    { account_id: acc('5600'), fund_id: fund('GEN'), debit: 2000, credit: 0 }, { account_id: acc('1000'), fund_id: fund('GEN'), debit: 0, credit: 2000 },
  ] }));
  let r = await call(as.treasurer, 'POST', '/bookkeeping/close', { date: '2030-03-31' });
  assert.equal(r.status, 409);
  assert.match(r.body.error, /draft/);
  web(() => B.postJournal(d.id));
  r = await call(as.treasurer, 'POST', '/bookkeeping/close', { date: '2030-03-31' });
  assert.equal(r.status, 200, r.text);
  const late = web(() => B.saveDraft(null, { date: '2030-03-15', lines: [
    { account_id: acc('5600'), fund_id: fund('GEN'), debit: 100, credit: 0 }, { account_id: acc('1000'), fund_id: fund('GEN'), debit: 0, credit: 100 },
  ] }));
  assert.throws(() => web(() => B.postJournal(late.id)), /closed up to 2030-03-31/);
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/reopen', { date: '2030-02-28' })).status, 403);
  assert.equal((await call(as.admin, 'POST', '/bookkeeping/reopen', { date: '2030-02-28' })).status, 200);
  web(() => B.postJournal(late.id));
});

test('reports: trial balance and balance sheet balance; funds hold their income; last year’s surplus stays in the fund', () => {
  // a gift to missions, and next year a missions expense
  web(() => B.postJournal(B.saveDraft(null, { date: '2030-06-01', memo: 'Missions gift', lines: [
    { account_id: acc('1100'), fund_id: fund('MIS'), debit: 50000, credit: 0 }, { account_id: acc('4010'), fund_id: fund('MIS'), debit: 0, credit: 50000 },
  ] }).id));
  web(() => B.postJournal(B.saveDraft(null, { date: '2031-02-01', memo: 'Missionary support', lines: [
    { account_id: acc('5100'), fund_id: fund('MIS'), debit: 30000, credit: 0 }, { account_id: acc('1100'), fund_id: fund('MIS'), debit: 0, credit: 30000 },
  ] }).id));
  const tb = Rp.trialBalance('2031-12-31');
  assert.ok(tb.balanced, JSON.stringify(tb));
  // 2030's income less expenses (gift 500.00 − bank charge 5.00 − office 20.00 and 1.00; the rent was reversed)
  assert.equal(tb.rows.find((r) => r.account_id === 0)?.credit, 50000 - 500 - 2000 - 100);
  const bs = Rp.balanceSheet('2031-12-31');
  assert.ok(bs.balanced);
  assert.equal(bs.funds.find((f) => f.code === 'MIS')!.amount, 200000 + 50000 - 30000);
  const ie = Rp.incomeExpenditure('2031-01-01', '2031-12-31');
  assert.equal(ie.expense.total, 30000);
  assert.equal(ie.surplus[fund('MIS')], -30000);
  const fm = Rp.fundMovements('2031-01-01', '2031-12-31').rows.find((r) => r.code === 'MIS')!;
  assert.equal(fm.opening + fm.income - fm.expense + fm.transfers + fm.other, fm.closing);
  const led = Rp.ledger(acc('1100'), '2030-01-01', '2030-12-31')!;
  assert.equal(led.closing, 1200000 - 150000 + 150000 - 500 + 50000);
});

test('a verified cash count drafts its offering journal; a corrected count drafts only the difference', async () => {
  const s = svc.createService({ date: '2031-03-02' }).service;
  const ed = { name: 'Ed Itor', admin: false, money: true };
  const ad = { name: 'Ad Min', admin: true, money: true };
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 12000 }, { fund: 'Missions', method: 'transfer', amount: 3000 }], counters: ['Ann', 'Ben'] }, ed));
  web(() => R.setVerified(s.id, true, ed));
  const draft = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND kind = 'offering' AND status = 'draft'", s.id)!;
  const j = B.getJournal(draft.id);
  assert.deepEqual(j.lines.map((l) => [l.account_id, l.fund_id, l.debit, l.credit]).sort(), [
    [acc('1100'), fund('GEN'), 12000, 0], [acc('1100'), fund('MIS'), 3000, 0], [acc('4000'), fund('GEN'), 0, 12000], [acc('4000'), fund('MIS'), 0, 3000],
  ].sort());
  web(() => B.postJournal(draft.id));
  // reopened and corrected: 120 → 150 for the general fund
  web(() => R.setVerified(s.id, false, ad));
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 15000 }, { fund: 'Missions', method: 'transfer', amount: 3000 }] }, ad));
  web(() => R.setVerified(s.id, true, ad));
  const change = B.getJournal(get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)!.id);
  assert.match(change.memo ?? '', /Change to offerings/);
  assert.deepEqual(change.lines.map((l) => [l.account_id, l.debit, l.credit]).sort(), [[acc('1100'), 3000, 0], [acc('4000'), 0, 3000]].sort());
  // reopened again: the waiting draft is withdrawn
  web(() => R.setVerified(s.id, false, ad));
  assert.equal(get("SELECT 1 FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id), undefined);
});

test('the journal export for an accountant', async () => {
  const r = await call(as.treasurer, 'GET', '/bookkeeping/export/journals.csv?from=2030-01-01&to=2030-12-31');
  assert.equal(r.status, 200);
  const lines = r.text.replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.match(lines[0], /^Journal,Date,Narration/);
  assert.ok(lines.some((l) => l.startsWith('2030-0001,2030-01-01,Opening balances,opening,1100')));
});

test('bank statements: the layout found under the bank’s own header lines, matches suggested, a bank charge entered, reconciled', async () => {
  const bank = acc('1100');
  // a fictional bank's export: account details first, then the columns
  const csv = [
    'Account Details For:,Example Bank Current Account 000-0000000',
    'Statement as at:,30 Apr 2031',
    '',
    'Transaction Date,Reference,Debit Amount,Credit Amount,Transaction Ref1',
    '02 Apr 2031,PAYNOW,,150.00,Offerings',
    '15 Apr 2031,CHG,5.00,,Service charge',
    '20 Apr 2031,GIRO,"1,500.00",,Rent April',
    'Total,,,,',
  ].join('\r\n');
  const file = Buffer.from(csv).toString('base64');
  const pv = await call(as.treasurer, 'POST', '/bookkeeping/bank/preview', { account_id: bank, file });
  assert.equal(pv.status, 200, pv.text);
  const L = pv.body.layout;
  assert.equal(L.header_row, 2, 'the column names, counting non-blank rows');
  assert.equal(L.date, 'Transaction Date');
  assert.equal(L.debit, 'Debit Amount');
  assert.equal(L.credit, 'Credit Amount');
  assert.equal(L.date_format, 'DD MMM YYYY');
  // the books: an offering of 150.00 by PayNow on 2 Apr, rent paid on 20 Apr
  const off = web(() => B.postJournal(B.saveDraft(null, { date: '2031-04-02', memo: 'Offerings', lines: [
    { account_id: bank, fund_id: fund('GEN'), debit: 15000, credit: 0 }, { account_id: acc('4000'), fund_id: fund('GEN'), debit: 0, credit: 15000 },
  ] }).id));
  web(() => B.postJournal(B.saveDraft(null, { date: '2031-04-19', memo: 'Rent April', lines: [
    { account_id: acc('5500'), fund_id: fund('GEN'), debit: 150000, credit: 0 }, { account_id: bank, fund_id: fund('GEN'), debit: 0, credit: 150000 },
  ] }).id));
  const imp = await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: bank, file, layout: L, file_name: 'april.csv', closing_balance: null });
  assert.equal(imp.status, 200, imp.text);
  assert.equal(imp.body.lines, 3);
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: bank, file, layout: L })).body.already, 3, 'a second import adds nothing');
  const sid = imp.body.statement_id;
  let st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${sid}`)).body;
  const rent = st.lines.find((l: Json) => l.amount === -150000);
  assert.equal(rent.suggestions[0].date, '2031-04-19', 'a day apart, same amount');
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/bank/statements/${sid}/auto-match`)).body.matched, 1, 'only the same-day one');
  await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${rent.id}/match`, { line_id: rent.suggestions[0].id });
  const chg = st.lines.find((l: Json) => l.amount === -500);
  const e = await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${chg.id}/entry`, { account_id: acc('5700'), fund_id: fund('GEN'), post: true });
  assert.equal(e.status, 200, e.text);
  st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${sid}`)).body;
  assert.ok(st.lines.every((l: Json) => l.status === 'matched'));
  assert.equal(st.lines.find((l: Json) => l.amount === 15000).matched.journal_id, off.id);
  // everything in the books for April is on the statement: nothing uncleared
  assert.equal(st.reconciliation.uncleared.length, 0, JSON.stringify(st.reconciliation.uncleared));
  assert.equal(st.reconciliation.expected_bank_balance, st.reconciliation.book_balance);
});

test('AI assistants: read the books by code, draft a journal, never post it', async () => {
  const { BOOKKEEPING_TOOLS } = await import('../server/mcp-tools/bookkeeping.ts');
  const tool = (n: string) => BOOKKEEPING_TOOLS.find((t) => t.name === n)!;
  const mcp = <T,>(fn: () => T) => asActor({ user_id: 1, user_name: 'Claude', via: 'mcp' }, fn);
  const books = (await mcp(() => tool('canon_books').handler({ as_of: '2030-12-31' }, {} as never))) as Json;
  assert.equal(books.amounts_in, 'cents');
  assert.ok(books.accounts.some((a: Json) => a.code === '5500'));
  const d = (await mcp(() => tool('canon_draft_journal').handler({ date: '2030-11-01', memo: 'Hall rent (fictional)', lines: [{ account: '5500', fund: 'GEN', debit_cents: 12000 }, { account: '1100', fund: 'GEN', credit_cents: 12000 }] }, {} as never))) as Json;
  assert.equal(d.status, 'draft');
  assert.deepEqual(d.problems, []);
  assert.equal(get<{ created_via: string }>('SELECT created_via FROM bk_journals WHERE id = ?', d.id)!.created_via, 'mcp');
  assert.throws(() => mcp(() => tool('canon_draft_journal').handler({ date: '2030-11-01', lines: [{ account: '9999', fund: 'GEN', debit_cents: 1 }] }, {} as never)), /No account with the code "9999"/);
  assert.throws(() => mcp(() => B.postJournal(d.id)), /a person posts/);
  const listed = (await mcp(() => tool('canon_books_journals').handler({ status: 'draft', limit: 50 }, {} as never))) as Json;
  assert.ok(listed.journals.some((j: Json) => j.id === d.id && j.lines[0].account === '5500'));
  web(() => B.deleteDraft(d.id));
});
