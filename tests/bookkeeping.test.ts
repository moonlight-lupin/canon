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
  // reversed instead: a reversing DRAFT first — the posted journal stays as it is until the reversal is posted
  const rev = (await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, { date: '2030-02-03' })).body;
  assert.equal(rev.kind, 'reversal');
  assert.equal(rev.status, 'draft');
  assert.equal(rev.lines[0].credit, 150000);
  assert.equal(B.getJournal(rent.id).reversed_by_id, null, 'not reversed yet');
  assert.equal((await call(as.treasurer, 'GET', `/bookkeeping/journals/${rent.id}`)).body.reversal_draft_id, rev.id);
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, {})).status, 409, 'one reversing draft at a time');
  // deleting the draft changes nothing; drafting again works
  await call(as.treasurer, 'DELETE', `/bookkeeping/journals/${rev.id}`);
  assert.equal(B.getJournal(rent.id).reversed_by_id, null);
  const rev2 = (await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, { date: '2030-02-03' })).body;
  const revPosted = (await call(as.treasurer, 'POST', `/bookkeeping/journals/${rev2.id}/post`)).body;
  assert.ok(revPosted.number);
  assert.equal(B.getJournal(rent.id).reversed_by_id, rev2.id, 'linked once the reversal is posted');
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/journals/${rent.id}/reverse`, {})).status, 409, 'only once');
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

test('reports: trial balance and balance sheet balance; funds hold their income; last year’s surplus stays in the fund', async () => {
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
  // the year the books begin: the opening balances are the funds' opening, not a movement
  const first = Rp.fundMovements('2030-01-01', '2030-12-31').rows.find((r) => r.code === 'MIS')!;
  assert.equal(first.opening, 200000);
  assert.equal(first.other, 0);
  // "Transaction Date" is the date column, not the description
  const { guessLayout } = await import('../server/repo/bk-bank.ts');
  const g = guessLayout([['Transaction Date', 'Description', 'Withdrawals', 'Deposits'], ['07/10/2030', 'Hall rent', '15.00', '']]);
  assert.equal(g.date, 'Transaction Date');
  assert.equal(g.description, 'Description');
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
  // an assistant may draft the reversal of a posted journal; it stays a draft until a person posts it
  const posted = web(() => B.postJournal(B.saveDraft(null, { date: '2030-11-02', memo: 'Wrong fund (fictional)', lines: [
    { account_id: acc('5500'), fund_id: fund('GEN'), debit: 700, credit: 0 }, { account_id: acc('1100'), fund_id: fund('GEN'), debit: 0, credit: 700 },
  ] }).id));
  const rv = (await mcp(() => tool('canon_draft_reversal').handler({ journal: posted.number, memo: 'Booked to the wrong fund' }, {} as never))) as Json;
  assert.equal(rv.status, 'draft');
  assert.equal(rv.kind, 'reversal');
  assert.equal(rv.reverses, posted.number);
  assert.equal(B.getJournal(posted.id).reversed_by_id, null, 'the posted journal stands until the reversal is posted');
  assert.throws(() => mcp(() => B.postJournal(rv.id)), /a person posts/);
  assert.throws(() => mcp(() => tool('canon_draft_reversal').handler({ journal: '1999-0001' }, {} as never)), /No posted journal/);
  const listed = (await mcp(() => tool('canon_books_journals').handler({ status: 'draft', limit: 50 }, {} as never))) as Json;
  assert.ok(listed.journals.some((j: Json) => j.id === d.id && j.lines[0].account === '5500'));
  web(() => B.deleteDraft(d.id));
});

test('a journal’s history: every line changed before posting, and for offerings the cash count and earlier drafts', async () => {
  const d = await call(as.treasurer, 'POST', '/bookkeeping/journals', { date: '2031-05-04', memo: 'Hall hire (fictional)', lines: [
    { account_id: acc('5500'), fund_id: fund('GEN'), debit: 20000 }, { account_id: acc('1100'), fund_id: fund('GEN'), credit: 20000 },
  ] });
  await call(as.treasurer, 'PUT', `/bookkeeping/journals/${d.body.id}`, { date: '2031-05-04', memo: 'Hall hire (fictional)', lines: [
    { account_id: acc('5500'), fund_id: fund('GEN'), debit: 25000 }, { account_id: acc('1100'), fund_id: fund('GEN'), credit: 25000 },
  ] });
  await call(as.treasurer, 'POST', `/bookkeeping/journals/${d.body.id}/post`);
  const h = (await call(as.treasurer, 'GET', `/bookkeeping/journals/${d.body.id}/history`)).body.rows as Json[];
  assert.equal(h.length, 3, JSON.stringify(h));
  assert.match(h[0].summary, /^Posted as 2031-/);
  assert.deepEqual(h[1].changes.lines, ['5500 GEN Dr 200.00\n1100 GEN Cr 200.00', '5500 GEN Dr 250.00\n1100 GEN Cr 250.00']);
  assert.equal(h[2].action, 'create');

  // an offering: verified, reopened and corrected, verified again — the count's changes and the withdrawn draft are there
  const s = svc.createService({ date: '2031-05-11' }).service;
  const ed = { name: 'Ed Itor', admin: false, money: true };
  const ad = { name: 'Ad Min', admin: true, money: true };
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 10000 }], counters: ['Ann', 'Ben'], notes: 'Private note (fictional)' }, ed));
  web(() => R.setVerified(s.id, true, ed));
  web(() => R.setVerified(s.id, false, ad));
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 11000 }] }, ad));
  web(() => R.setVerified(s.id, true, ad));
  const draft = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)!.id;
  const oh = (await call(as.treasurer, 'GET', `/bookkeeping/journals/${draft}/history`)).body.rows as Json[];
  assert.ok(oh.some((r) => r.entity === 'bk_journals' && r.action === 'delete' && /reopened/.test(r.summary)), 'the first draft, withdrawn');
  assert.ok(oh.some((r) => r.entity === 'service_records' && r.changes.offerings), 'the count corrected');
  assert.ok(oh.every((r) => !r.changes.notes && !r.changes.visitors), 'only the money fields of the record');
  const status = (await call(as.treasurer, 'GET', `/bookkeeping/offerings/${s.id}`)).body;
  assert.deepEqual(status.journals.map((j: Json) => j.status), ['draft']);
});

test('AI assistants and the bank: read statements, draft for an open line; posting it matches the line', async () => {
  const { BOOKKEEPING_TOOLS } = await import('../server/mcp-tools/bookkeeping.ts');
  const tool = (n: string) => BOOKKEEPING_TOOLS.find((t) => t.name === n)!;
  const mcp = <T,>(fn: () => T) => asActor({ user_id: 1, user_name: 'Claude', via: 'mcp' }, fn);
  const csv = ['Date,Description,Amount', '03/06/2031,INTEREST (fictional),1.25', '04/06/2031,CHARGE (fictional),-2.00'].join('\n');
  const imp = await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: acc('1110'), file: Buffer.from(csv).toString('base64'), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'DD/MM/YYYY' } });
  assert.equal(imp.status, 200, imp.text);
  const list = (await mcp(() => tool('canon_bank_statements').handler({ account: '1110', open_only: true }, {} as never))) as Json;
  assert.equal(list.statements[0].to_match, 2);
  const one = (await mcp(() => tool('canon_bank_statements').handler({ id: imp.body.statement_id, open_only: true }, {} as never))) as Json;
  const interest = one.lines.find((l: Json) => l.amount_cents === 125);
  const d = (await mcp(() => tool('canon_draft_journal').handler({ date: '2031-06-03', memo: 'Interest', statement_line: interest.id, lines: [
    { account: '1110', fund: 'GEN', debit_cents: 125 }, { account: '4400', fund: 'GEN', credit_cents: 125 },
  ] }, {} as never))) as Json;
  assert.equal(d.statement_line.matches_when_posted, true);
  assert.equal(d.kind, 'bank');
  const again = (await mcp(() => tool('canon_bank_statements').handler({ id: imp.body.statement_id, open_only: true }, {} as never))) as Json;
  assert.equal(again.lines.find((l: Json) => l.id === interest.id).draft_journal_id, d.id);
  assert.throws(() => mcp(() => B.postJournal(d.id)), /a person posts/);
  await call(as.treasurer, 'POST', `/bookkeeping/journals/${d.id}/post`);
  const st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.body.statement_id}`)).body;
  assert.equal(st.lines.find((l: Json) => l.id === interest.id).status, 'matched');
  // a draft entered on the Bank screen and posted later matches too
  const chg = st.lines.find((l: Json) => l.amount === -200);
  const e = (await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${chg.id}/entry`, { account_id: acc('5700'), fund_id: fund('GEN'), post: false })).body;
  await call(as.treasurer, 'POST', `/bookkeeping/journals/${e.id}/post`);
  const st2 = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.body.statement_id}`)).body;
  assert.ok(st2.lines.every((l: Json) => l.status === 'matched'));
});

test('the books in Settings → Export data and on the dashboard', async () => {
  const ex = (await call(as.admin, 'GET', '/export')).body;
  assert.equal(ex.bookkeeping, true);
  const j = await call(as.admin, 'GET', '/export/bookkeeping/accounts.csv');
  assert.equal(j.status, 200);
  assert.match(j.text, /Code,Name,Name \(other language\),Type/);
  assert.equal((await call(as.admin, 'GET', '/export/bookkeeping/nothing.csv')).status, 404);
  const dash = (await call(as.treasurer, 'GET', '/dashboard')).body;
  assert.equal(typeof dash.bookkeeping.drafts, 'number');
  assert.equal((await call(as.editor, 'GET', '/dashboard')).body.bookkeeping, null, 'editors don’t see the books');
});

test('a PayNow line added after the count is verified is drafted into the books too', () => {
  const s = svc.createService({ date: '2031-07-06' }).service;
  const ed = { name: 'Ed Itor', admin: false, money: true };
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 5000 }], counters: ['Ann', 'Ben'] }, ed));
  web(() => R.setVerified(s.id, true, ed));
  const first = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)!.id;
  web(() => B.postJournal(first));
  // found later (e.g. at the bank reconciliation): a Missions gift by PayNow for that service
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 5000 }, { fund: 'Missions', method: 'paynow', amount: 2000 }] }, ed));
  const add = B.getJournal(get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)!.id);
  assert.deepEqual(add.lines.map((l) => [l.account_id, l.fund_id, l.debit, l.credit]).sort(), [[acc('1100'), fund('MIS'), 2000, 0], [acc('4000'), fund('MIS'), 0, 2000]].sort());
});

test('a PayNow gift first seen on the bank statement: added to the service’s offerings, drafted, posted and matched', async () => {
  const s = svc.createService({ date: '2031-08-03' }).service;
  const ed = { name: 'Ed Itor', admin: false, money: true };
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'cash', amount: 0 }], cash: {}, counters: ['Ann', 'Ben'] }, ed));
  web(() => R.setVerified(s.id, true, ed));
  const csv = ['Date,Description,Amount', '04/08/2031,PAYNOW FROM A MEMBER (fictional),88.00', '05/08/2031,HALL RENTAL (fictional),300.00'].join('\n');
  const imp = await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: acc('1100'), file: Buffer.from(csv).toString('base64'), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'DD/MM/YYYY' } });
  assert.equal(imp.status, 200, imp.text);
  const st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.body.statement_id}`)).body;
  const gift = st.lines.find((l: Json) => l.amount === 8800);
  const near = (await call(as.treasurer, 'GET', `/bookkeeping/bank/lines/${gift.id}/services`)).body as Json[];
  assert.equal(near[0].id, s.id, 'the service the day before comes first');
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${gift.id}/offering`, { service_id: s.id, fund: 'Missions', method: 'cash', post: true })).status, 400, 'not cash');
  const r = await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${gift.id}/offering`, { service_id: s.id, fund: 'Missions', method: 'paynow', post: true });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.matched, true);
  assert.ok(r.body.journal.number);
  assert.ok(R.recordFor(s.id).offerings.some((o) => o.fund === 'Missions' && o.method === 'paynow' && o.amount === 8800), 'the service record has it');
  // a role without the Offerings permission can't add to a service's offerings
  const rental = st.lines.find((l: Json) => l.amount === 30000);
  assert.equal((await call(as.viewer, 'POST', `/bookkeeping/bank/lines/${rental.id}/offering`, { service_id: s.id, fund: 'General', method: 'transfer', post: false })).status, 403);
});

test('importing journals from Excel or CSV: the template, a preview with what stops each, drafts only', async () => {
  const { readXlsx, tableRows } = await import('../server/lib/xlsx-read.ts');
  const { buildXlsx } = await import('../shared/xlsx.ts');
  const tpl = await fetch(`${base}/api/bookkeeping/import/journals-template.xlsx`, { headers: { Cookie: as.treasurer.cookie } });
  assert.equal(tpl.status, 200);
  const head = tableRows(readXlsx(new Uint8Array(await tpl.arrayBuffer())))[0];
  assert.deepEqual(head.slice(0, 5), ['Journal', 'Date', 'Narration', 'Kind', 'Account code']);
  // an Excel file with a title block above the table, three journals: fine, unbalanced, an unknown account
  const file = buildXlsx([{ name: 'x', lines: ['Some church — journals'], header: ['Journal', 'Date', 'Narration', 'Account code', 'Fund', 'Debit', 'Credit'], rows: [
    ['A', '2031-09-01', 'Hall rent (fictional)', '5500', 'GEN', 100, null], ['A', '2031-09-01', '', '1100', 'GEN', null, 100],
    ['B', '01/09/2031', 'Unbalanced (fictional)', '5500', 'GEN', '20.00', ''], ['B', '', '', '1100', 'GEN', '', '10.00'],
    ['C', '2031-09-02', 'Typo (fictional)', '9999', 'GEN', 5, null], ['C', '2031-09-02', '', '1100', 'GEN', null, 5],
  ] }]);
  const up = (url: string, body: Uint8Array) => fetch(`${base}/api${url}`, { method: 'POST', headers: { Cookie: as.treasurer.cookie, 'X-CSRF-Token': as.treasurer.csrf, 'Content-Type': 'application/octet-stream' }, body: body as unknown as BodyInit }).then((r) => r.json() as Promise<Json>);
  const pv = await up('/bookkeeping/import/journals?dry_run=1', file);
  assert.equal(pv.fatal, null);
  const by = (ref: string) => pv.journals.find((j: Json) => j.ref === ref);
  assert.deepEqual([by('A').errors, by('A').problems], [[], []]);
  assert.equal(by('B').date, '2031-09-01', 'DD/MM/YYYY read too');
  assert.ok(by('B').problems.some((p: string) => /must be equal/.test(p)), 'unbalanced: a draft, not postable yet');
  assert.ok(by('C').errors.some((e: string) => /9999/.test(e)), 'an unknown account stops that journal');
  const before = get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft'")!.n;
  const done = await up('/bookkeeping/import/journals', file);
  assert.equal(done.imported.length, 2);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE status = 'draft'")!.n, before + 2, 'drafts only');
  assert.ok(get("SELECT 1 FROM change_log WHERE entity = 'bk_journals' AND via = 'import'"), 'logged as an import');
  // a CSV file works the same
  const csv = new TextEncoder().encode('Journal,Date,Narration,Account code,Fund,Debit,Credit\nX,2031-09-03,Fictional,5500,GEN,1.00,\nX,2031-09-03,,1100,GEN,,1.00\n');
  assert.equal((await up('/bookkeeping/import/journals?dry_run=1', csv)).journals[0].errors.length, 0);
  // a bank statement as Excel
  const stmt = buildXlsx([{ name: 's', header: ['Date', 'Description', 'Amount'], rows: [['2031-09-04', 'INTEREST (fictional)', 0.5]] }]);
  const prev = await call(as.treasurer, 'POST', '/bookkeeping/bank/preview', { account_id: acc('1110'), file: Buffer.from(stmt).toString('base64') });
  assert.equal(prev.status, 200, prev.text);
  assert.equal(prev.body.layout.date, 'Date');
  assert.equal(prev.body.layout.amount, 'Amount');
});

test('bank re-imports: overlapping files keep a genuine look-alike transaction; exact retries add nothing (review F1)', async () => {
  const L = { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', reference: 'Ref', date_format: 'YYYY-MM-DD' };
  const file = (rows: string[]) => Buffer.from(['Date,Description,Amount,Ref', ...rows].join('\n')).toString('base64');
  const imp = async (rows: string[], layout: Json = L) => (await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: acc('1110'), file: file(rows), layout })).body;
  // with the bank's reference: TX-B is a second SGD 50 gift, not a repeat of TX-A
  let r = await imp(['2031-10-01,PAYNOW GIFT,50.00,TX-A']);
  assert.equal(r.lines, 1);
  r = await imp(['2031-10-01,PAYNOW GIFT,50.00,TX-A', '2031-10-01,PAYNOW GIFT,50.00,TX-B']);
  assert.deepEqual([r.lines, r.already], [1, 1], 'the review’s case: TX-B kept');
  r = await imp(['2031-10-01,PAYNOW GIFT,50.00,TX-A', '2031-10-01,PAYNOW GIFT,50.00,TX-B']);
  assert.deepEqual([r.lines, r.already], [0, 2], 'an exact retry adds nothing');
  // without references: counted — two look-alike lines then three means one new
  const noRef = { ...L, reference: undefined };
  r = await imp(['2031-10-02,CASH DEPOSIT,20.00,', '2031-10-02,CASH DEPOSIT,20.00,'], noRef);
  assert.equal(r.lines, 2, 'two look-alike lines in one file are both kept');
  r = await imp(['2031-10-02,CASH DEPOSIT,20.00,', '2031-10-02,CASH DEPOSIT,20.00,', '2031-10-02,CASH DEPOSIT,20.00,'], noRef);
  assert.deepEqual([r.lines, r.already], [1, 2]);
  assert.equal(get<{ n: number }>("SELECT COUNT(*) n FROM bk_statement_lines WHERE date = '2031-10-02' AND amount = 2000")!.n, 3);
});

test('a bank receipt is added to a service’s offerings once, however often it is retried (review F2)', async () => {
  const ed = { name: 'Ed Itor', admin: false, money: true };
  const s = svc.createService({ date: '2031-11-02' }).service;
  const s2 = svc.createService({ date: '2031-11-09' }).service;
  const csv = ['Date,Description,Amount', '2031-11-03,PAYNOW GIFT (fictional),20.00', '2031-11-04,PAYNOW GIFT (fictional),15.00'].join('\n');
  const imp = (await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: acc('1100'), file: Buffer.from(csv).toString('base64'), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'YYYY-MM-DD' } })).body;
  const st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.statement_id}`)).body;
  const [g20, g15] = [st.lines.find((l: Json) => l.amount === 2000), st.lines.find((l: Json) => l.amount === 1500)];
  const add = (lineId: number, serviceId: number, post: boolean) => call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${lineId}/offering`, { service_id: serviceId, fund: 'General', method: 'paynow', post });
  const bankLinesOf = (serviceId: number, lineId: number) => R.recordFor(serviceId).offerings.filter((o) => o.bank_line_id === lineId).length;

  // before the count is verified: twice, one offering
  assert.equal((await add(g15.id, s2.id, false)).status, 200);
  assert.equal((await add(g15.id, s2.id, false)).body.added, false);
  assert.equal(bankLinesOf(s2.id, g15.id), 1);
  assert.equal((await add(g15.id, s.id, false)).status, 409, 'not also to another service');

  // a verified service, the draft kept: twice, one offering of 20 and a draft of 20
  web(() => R.saveRecord(s.id, { offerings: [], counters: ['Ann', 'Ben'] }, ed));
  web(() => R.setVerified(s.id, true, ed));
  assert.equal((await add(g20.id, s.id, false)).body.added, true);
  const again = (await add(g20.id, s.id, false)).body;
  assert.equal(again.added, false, 'the retry adds no money');
  assert.equal(bankLinesOf(s.id, g20.id), 1);
  const draft = B.getJournal(again.journal.id);
  assert.equal(draft.lines.reduce((n, l) => n + l.debit, 0), 2000, 'the draft is for 20.00, not 40.00');
  // posted and matched; a retry after that returns what was done
  assert.equal((await add(g20.id, s.id, true)).body.matched, true);
  const after = (await add(g20.id, s.id, true)).body;
  assert.deepEqual([after.added, after.matched], [false, true]);
  assert.equal(bankLinesOf(s.id, g20.id), 1);
  // the record editor saving the whole record keeps the marker
  const rec = R.recordFor(s.id);
  web(() => R.saveRecord(s.id, { offerings: rec.offerings }, ed));
  assert.equal(bankLinesOf(s.id, g20.id), 1);
});

test('group matching: several bank receipts against one offering line, one deposit against several entries (review F5)', async () => {
  const ed = { name: 'Ed Itor', admin: false, money: true };
  // a service whose PayNow gifts of 25 and 35 make one bank line of 60 in its offering journal
  const s = svc.createService({ date: '2031-12-07' }).service;
  web(() => R.saveRecord(s.id, { offerings: [{ fund: 'General', method: 'paynow', amount: 2500 }, { fund: 'General', method: 'paynow', amount: 3500 }], counters: ['Ann', 'Ben'] }, ed));
  web(() => R.setVerified(s.id, true, ed));
  const off = web(() => B.postJournal(get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)!.id));
  const bankLine = off.lines.find((l) => l.account_id === acc('1100'))!;
  assert.equal(bankLine.debit, 6000, 'one line of 60.00 in the books');
  // two cash-offering entries (40 and 60) banked as one deposit of 100
  const dep = (d: string, amt: number) => web(() => B.postJournal(B.saveDraft(null, { date: d, memo: 'Deposit (fictional)', lines: [
    { account_id: acc('1100'), fund_id: fund('GEN'), debit: amt, credit: 0 }, { account_id: acc('1010'), fund_id: fund('GEN'), debit: 0, credit: amt },
  ] }).id));
  const d40 = dep('2031-12-14', 4000);
  const d60 = dep('2031-12-14', 6000);
  const csv = ['Date,Description,Amount', '2031-12-07,PAYNOW (fictional),25.00', '2031-12-07,PAYNOW (fictional),35.00', '2031-12-15,CASH DEPOSIT (fictional),100.00'].join('\n');
  const imp = (await call(as.treasurer, 'POST', '/bookkeeping/bank/statements', { account_id: acc('1100'), file: Buffer.from(csv).toString('base64'), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'YYYY-MM-DD' } })).body;
  let st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.statement_id}`)).body;
  const [p25, p35, cash] = [2500, 3500, 10000].map((a) => st.lines.find((l: Json) => l.amount === a));
  // one at a time it can't be matched (the review's finding) …
  assert.equal((await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${p25.id}/match`, { line_id: bankLine.id })).status, 400);
  // … but Canon suggests the group, and it matches
  const g = p25.group_suggestions.find((x: Json) => x.book.some((b: Json) => b.id === bankLine.id));
  assert.ok(g, JSON.stringify(p25.group_suggestions));
  assert.deepEqual([...g.statement_line_ids].sort(), [p25.id, p35.id].sort());
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/bank/match-group', { statement_line_ids: [p25.id], book_line_ids: [bankLine.id] })).status, 400, 'totals must agree');
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/bank/match-group', { statement_line_ids: g.statement_line_ids, book_line_ids: [bankLine.id] })).status, 200);
  // one deposit against two entries
  const book40 = d40.lines.find((l) => l.account_id === acc('1100'))!.id;
  const book60 = d60.lines.find((l) => l.account_id === acc('1100'))!.id;
  st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.statement_id}`)).body;
  assert.ok(st.lines.find((l: Json) => l.id === cash.id).group_suggestions.some((x: Json) => x.book.map((b: Json) => b.id).sort().join() === [book40, book60].sort().join()));
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/bank/match-group', { statement_line_ids: [cash.id], book_line_ids: [book40, book60] })).status, 200);
  st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.statement_id}`)).body;
  assert.ok(st.lines.every((l: Json) => l.status === 'matched'));
  assert.equal(st.lines.find((l: Json) => l.id === p25.id).group.book[0].id, bankLine.id);
  assert.ok(!st.reconciliation.uncleared.some((u: Json) => [bankLine.id, book40, book60].includes(u.id)), 'cleared in the reconciliation');
  // the same entry can't be matched twice; unmatching one line takes its group apart
  assert.equal((await call(as.treasurer, 'POST', '/bookkeeping/bank/match-group', { statement_line_ids: [cash.id, p25.id], book_line_ids: [bankLine.id, book40] })).status, 409);
  await call(as.treasurer, 'POST', `/bookkeeping/bank/lines/${p35.id}/unmatch`);
  st = (await call(as.treasurer, 'GET', `/bookkeeping/bank/statements/${imp.statement_id}`)).body;
  assert.deepEqual([p25.id, p35.id].map((i) => st.lines.find((l: Json) => l.id === i).status), ['open', 'open']);
  assert.ok(st.reconciliation.uncleared.some((u: Json) => u.id === bankLine.id), 'uncleared again');
});

test('importing the chart of accounts and the funds: matched by code, previewed, nothing deleted, a used account keeps its type', async () => {
  const { readXlsx, tableRows } = await import('../server/lib/xlsx-read.ts');
  const x = await fetch(`${base}/api/bookkeeping/import/chart/accounts.xlsx`, { headers: { Cookie: as.treasurer.cookie } });
  const [head] = tableRows(readXlsx(new Uint8Array(await x.arrayBuffer())));
  assert.deepEqual(head.slice(0, 4), ['Code', 'Name', 'Name (other language)', 'Type']);
  const up = (url: string, text: string) => fetch(`${base}/api${url}`, { method: 'POST', headers: { Cookie: as.treasurer.cookie, 'X-CSRF-Token': as.treasurer.csrf, 'Content-Type': 'text/csv' }, body: text }).then((r) => r.json() as Promise<Json>);
  const csv = [
    'Code,Name,Name (other language),Type,What it is for,In use,Description',
    '5450,Youth camp (fictional),青年营,expense,,yes,',
    '5500,Rent and utilities,租金与水电,expense,,yes,Hall and electricity',
    '1100,Bank — current account,,income,bank,yes,',
    '5450,Twice,,expense,,yes,',
  ].join('\n');
  const pv = await up('/bookkeeping/import/chart/accounts?dry_run=1', csv);
  assert.equal(pv.fatal, null);
  const row = (code: string, n = 0) => pv.rows.filter((r: Json) => r.code === code)[n];
  assert.equal(row('5450').action, 'create');
  assert.equal(row('5500').action, 'update');
  assert.deepEqual(row('5500').changes, ['description']);
  assert.equal(row('1100').action, 'error', 'a used account keeps its type');
  assert.equal(row('5450', 1).action, 'error', 'the same code twice');
  assert.equal(get('SELECT 1 FROM bk_accounts WHERE code = ?', '5450'), undefined, 'a preview changes nothing');
  const done = await up('/bookkeeping/import/chart/accounts', csv);
  assert.deepEqual([done.counts.create, done.counts.update], [1, 1]);
  assert.equal(get<{ name: string }>('SELECT name FROM bk_accounts WHERE code = ?', '5450')!.name, JSON.stringify({ en: 'Youth camp (fictional)', zh: '青年营' }));
  assert.equal(get<{ type: string }>('SELECT type FROM bk_accounts WHERE code = ?', '1100')!.type, 'asset');
  const f = await up('/bookkeeping/import/chart/funds', 'Code,Name,Restriction\nYTH,Youth fund (fictional),designated\n');
  assert.equal(f.counts.create, 1);
  assert.equal(get<{ restriction: string }>('SELECT restriction FROM bk_funds WHERE code = ?', 'YTH')!.restriction, 'designated');
});

// ---------------------------------------------------------------- the 0.18.0 review of the books

const Bank = await import('../server/repo/bk-bank.ts');
const post = (date: string, amt: number, other = '1010') => web(() => B.postJournal(B.saveDraft(null, { date, memo: 'Review test (fictional)', lines: [
  { account_id: acc('1100'), fund_id: fund('GEN'), debit: amt > 0 ? amt : 0, credit: amt < 0 ? -amt : 0 },
  { account_id: acc(other), fund_id: fund('GEN'), debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0 },
] }).id));
const bankOf = (j: { lines: { id?: number; account_id: number }[] }) => j.lines.find((l) => l.account_id === acc('1100'))!.id!;
const statement = (lines: [string, string, number][]) => web(() => Bank.importStatement({
  account_id: acc('1100'), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'YYYY-MM-DD' } as never,
  data: Buffer.from(['Date,Description,Amount', ...lines.map(([d, t, a]) => `${d},${t},${(a / 100).toFixed(2)}`)].join('\n')),
})).statement_id!;
const lineIn = (statementId: number, amount: number) => get<{ id: number; status: string; line_id: number | null }>('SELECT id, status, line_id FROM bk_statement_lines WHERE statement_id = ? AND amount = ?', statementId, amount)!;

test('review: a statement line matched in a group can’t also be matched alone; unmatching leaves nothing behind', () => {
  const a = post('2033-01-20', 4000);
  const b = post('2033-01-20', 6000);
  const c = post('2033-01-20', 10000);
  const st = statement([['2033-01-21', 'DEPOSIT (fictional)', 10000]]);
  const line = lineIn(st, 10000);
  web(() => Bank.matchGroup([line.id], [bankOf(a), bankOf(b)]));
  assert.throws(() => web(() => Bank.matchLine(line.id, bankOf(c))), /already matched/);
  web(() => Bank.unmatchLine(line.id));
  assert.deepEqual({ ...lineIn(st, 10000) }, { id: line.id, status: 'open', line_id: null });
  web(() => Bank.matchLine(line.id, bankOf(c)));
  assert.equal(lineIn(st, 10000).line_id, bankOf(c));
  web(() => Bank.deleteStatement(st));
});

test('review: matching a later statement doesn’t change an earlier statement’s reconciliation', () => {
  const cheque = post('2033-03-30', -2500, '5400');
  const before = web(() => Bank.reconciliation(acc('1100'), '2033-03-31', null));
  assert.ok(before.uncleared.some((u) => u.id === bankOf(cheque)), 'not presented by the end of March');
  const feb = statement([['2033-04-03', 'CHEQUE 000123 (fictional)', -2500]]);
  web(() => Bank.matchLine(lineIn(feb, -2500).id, bankOf(cheque)));
  const after = web(() => Bank.reconciliation(acc('1100'), '2033-03-31', null));
  assert.deepEqual(after.uncleared.map((u) => u.id), before.uncleared.map((u) => u.id), 'March is as it was');
  assert.equal(after.expected_bank_balance, before.expected_bank_balance);
  assert.ok(!web(() => Bank.reconciliation(acc('1100'), '2033-04-30', null)).uncleared.some((u) => u.id === bankOf(cheque)), 'cleared in April');
  web(() => Bank.deleteStatement(feb));
});

test('review: a reversal draft stays a reversal when saved again; its posting links the original once', () => {
  const x = post('2033-05-02', 1000);
  const rev = web(() => B.reverseJournal(x.id, '2033-05-03'));
  const saved = web(() => B.saveDraft(rev.id, { date: '2033-05-04', memo: 'Reversal (fictional)', kind: 'manual', lines: rev.lines }));
  assert.equal(saved.kind, 'reversal', 'its kind is kept');
  web(() => B.postJournal(rev.id));
  assert.equal(B.getJournal(x.id).reversed_by_id, rev.id);
  assert.throws(() => web(() => B.reverseJournal(x.id, '2033-05-05')), /reversed/);
  // a person's own draft can't be turned into one of Canon's linked kinds either
  const own = web(() => B.saveDraft(null, { date: '2033-05-06', memo: 'Own (fictional)', lines: rev.lines }));
  assert.equal(web(() => B.saveDraft(own.id, { date: '2033-05-06', kind: 'offering', lines: rev.lines })).kind, 'manual');
  web(() => B.deleteDraft(own.id));
});

test('review: a posted journal keeps who posted it, when, and what reversed it — the database refuses changes', () => {
  const x = post('2033-05-10', 1200);
  for (const sql of ["UPDATE bk_journals SET posted_by = 'Someone else' WHERE id = ?", "UPDATE bk_journals SET posted_at = '2020-01-01' WHERE id = ?"]) {
    assert.throws(() => run(sql, x.id), /cannot be changed/);
  }
  const rev = web(() => B.postJournal(B.reverseJournal(x.id, '2033-05-11').id));
  assert.equal(B.getJournal(x.id).reversed_by_id, rev.id, 'set once, when the reversal is posted');
  assert.throws(() => run('UPDATE bk_journals SET reversed_by_id = NULL WHERE id = ?', x.id), /cannot be changed/);
});

test('review: amounts written with a decimal comma read right, in bank statements and journal imports', () => {
  const cases: [string, number | null][] = [['12,50', 1250], ['1.234,50', 123450], ['1,234.50', 123450], ['1,234', 123400], ['12.345,6', 1234560], ['1.234.567', 123456700], ['(12.00)', -1200], ['-0', 0], ['abc', null]];
  for (const [s, cents] of cases) assert.equal(Bank.parseBankAmount(s), cents, s);
});

test('review: journal numbers go on past 9999 in a year', () => {
  run("INSERT INTO bk_journals (date, memo, status, kind, number, posted_by, posted_at) VALUES ('2034-06-01', 'Numbering (fictional)', 'posted', 'manual', '2034-9999', 'Test', '2034-06-01')");
  assert.equal(post('2034-06-02', 100).number, '2034-10000');
  assert.equal(post('2034-06-02', 100).number, '2034-10001');
});
