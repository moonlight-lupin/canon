// 0.18.0: a reference church's whole financial cycle, checked against figures worked out by hand from the events
// below — not from Canon's own reports. A release gate for calling Canon a church's main books (v0.17.2 review).
//
// Grace Reference Church (fictional), SGD, books from 1 January 2031, calendar financial year.
//   Opening:  bank 12,000.00 (General 10,000.00, Missions 2,000.00), cash 500.00, payables 300.00
//             → General fund 10,200.00, Missions fund 2,000.00
//   4 Jan     service: cash 800.00 (General), PayNow 200.00 (Missions)               verified → posted
//   11 Jan    service: PayNow 25.00 + 35.00 (General)                                verified → posted
//   13 Jan    the 4 Jan cash banked: 800.00
//   20 Jan    claim C (two receipts, 100.00 + 50.00) for fellowship snacks: approved, booked to 5400, paid from bank
//   25 Jan    hall rent 1,000.00 posted to the Missions fund by mistake → reversed (draft, posted) → re-entered General
//   31 Jan    bank charge 5.00, first seen on the statement, entered from it
//   Statement for January: opening 12,000.00; +200 +25 +35 +800 −150 −5 → closing 12,905.00 (the rent not yet presented)
//   4 Jan 2032 service: PayNow 100.00 (General)
//
// By hand, for 2031:
//   Income   General 860.00 (800 + 25 + 35), Missions 200.00
//   Expense  General 1,155.00 (rent 1,000 + snacks 150 + bank charge 5); the mistaken Missions rent nets to nothing
//   Surplus  General −295.00, Missions +200.00 → fund balances General 9,905.00, Missions 2,200.00 (together 12,105.00)
//   Bank (books) 12,000 + 200 + 60 + 800 − 150 − 5 − 1,000 = 11,905.00; cash 500.00; offerings not banked 0;
//   claims to repay 0; payables 300.00 → net assets 12,105.00
//   Reconciliation: book 11,905.00 less uncleared (the rent, −1,000.00) → 12,905.00 = the statement: difference 0
//   2032: income General 100.00 only; earlier years' surplus −95.00; General fund 10,005.00
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-reference-books-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { seed } = await import('../server/seed/index.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const B = await import('../server/repo/bookkeeping.ts');
const Rp = await import('../server/repo/bk-reports.ts');
const Bank = await import('../server/repo/bk-bank.ts');
const C = await import('../server/repo/bk-claims.ts');
const R = await import('../server/repo/records.ts');
const svc = await import('../server/repo/services.ts');
const { journalsCsv } = await import('../server/repo/bk-export.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { db, get, run } = await import('../server/db.ts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const INK = `data:image/png;base64,${PNG.toString('base64')}`;
const as = <T,>(fn: () => T) => asActor({ user_id: null, user_name: 'Reference Treasurer', via: 'web' }, fn);
const who = { name: 'Reference Treasurer', admin: true, money: true };
const acc = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)!.id;
const fund = (code: string) => get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', code)!.id;
const c = (n: number) => Math.round(n * 100);

before(async () => {
  await seed();
  updateSettings({ offering: { ...getSettings().offering, currency: 'SGD', funds: ['General', 'Missions'] }, modules: { ...getSettings().modules, bookkeeping: true } });
});
after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const post = (date: string, memo: string, lines: [string, string, number, number][]) => as(() => B.postJournal(B.saveDraft(null, {
  date, memo, lines: lines.map(([a, f, dr, cr]) => ({ account_id: acc(a), fund_id: fund(f), debit: c(dr), credit: c(cr) })),
}).id));
function service(date: string, offerings: { fund: string; method: 'cash' | 'paynow'; amount: number }[], cashNotes: Record<string, number> = {}) {
  const s = svc.createService({ date }).service;
  as(() => R.saveRecord(s.id, { offerings: offerings.map((o) => ({ ...o, amount: c(o.amount) })), cash: cashNotes, counters: ['Ann', 'Ben'] } as never, who));
  as(() => R.setVerified(s.id, true, who));
  const draft = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND kind = 'offering' AND status = 'draft'", s.id)!;
  return as(() => B.postJournal(draft.id));
}

test('the reference church: a year of books reconciles with the figures worked out by hand', async () => {
  as(() => B.setupBooks({ start_date: '2031-01-01', year_end_month: 12, template: true }));
  // offerings into the books: the template's mapping (cash → not yet banked, PayNow → bank; funds → 4000)
  as(() => B.saveOfferingMapping({
    offering_drafts: true,
    method_accounts: { cash: acc('1010'), paynow: acc('1100'), transfer: acc('1100') },
    fund_map: { General: { fund_id: fund('GEN'), income_account_id: acc('4000') }, Missions: { fund_id: fund('MIS'), income_account_id: acc('4000') } },
  }));

  // opening balances
  as(() => B.postJournal(B.saveDraft(null, { date: '2031-01-01', kind: 'opening', memo: 'Opening balances', lines: [
    { account_id: acc('1100'), fund_id: fund('GEN'), debit: c(10000), credit: 0 },
    { account_id: acc('1100'), fund_id: fund('MIS'), debit: c(2000), credit: 0 },
    { account_id: acc('1000'), fund_id: fund('GEN'), debit: c(500), credit: 0 },
    { account_id: acc('2000'), fund_id: fund('GEN'), debit: 0, credit: c(300) },
    { account_id: acc('3000'), fund_id: fund('GEN'), debit: 0, credit: c(10200) },
    { account_id: acc('3000'), fund_id: fund('MIS'), debit: 0, credit: c(2000) },
  ] }).id));

  // the services' offerings
  service('2031-01-04', [{ fund: 'General', method: 'cash', amount: 800 }, { fund: 'Missions', method: 'paynow', amount: 200 }], { 5000: 16 });
  const jan11 = service('2031-01-11', [{ fund: 'General', method: 'paynow', amount: 25 }, { fund: 'General', method: 'paynow', amount: 35 }]);
  // the cash banked
  post('2031-01-13', 'Cash offerings of 4 Jan banked', [['1100', 'GEN', 800, 0], ['1010', 'GEN', 0, 800]]);

  // a claim: two receipts, approved, booked to Fellowship and events, paid
  run("INSERT INTO people (id, first_name, last_name, email) VALUES (901, 'Claire', 'Mant', 'claire@example.org'), (902, 'Abe', 'Prover', 'abe@example.org')");
  C.saveApprover(null, { person_id: 902 });
  const claimant: import('../server/repo/bk-claims.ts').Party = { as: 'claimant', person_id: 901, name: 'Claire Mant' };
  let claim = as(() => C.createClaim(901, { purpose: 'Fellowship snacks (fictional)', pay_to: 'PayNow 8000 0000 (fictional)', lines: [
    { date: '2031-01-18', description: 'Snacks', payee: 'A shop', amount: c(100) }, { date: '2031-01-18', description: 'Drinks', payee: 'A shop', amount: c(50) },
  ] }, claimant));
  claim = as(() => C.addClaimFile(claim.id, { name: 'receipt.png', mime: 'image/png', data: PNG }, claimant));
  as(() => C.submitClaim(claim.id, { image: INK }, claimant));
  claim = as(() => C.decideClaim(claim.id, { decision: 'approved', image: INK }, { person_id: 902, name: 'Abe Prover' }));
  assert.equal(claim.status, 'approved');
  as(() => C.classifyClaim(claim.id, { lines: claim.lines.map((l) => ({ id: l.id!, account_id: acc('5400') })) }));
  // the treasurer dates the expense on the approval date (20 Jan) and posts it
  const expense = B.getJournal(C.getClaim(claim.id).approval_journal_id!);
  as(() => B.postJournal(B.saveDraft(expense.id, { date: '2031-01-20', memo: expense.memo, kind: 'claim', lines: expense.lines }).id));
  claim = as(() => C.payClaim(claim.id, { date: '2031-01-20', bank_account_id: acc('1100'), reference: 'FAST (fictional)', post: true }, { name: 'Reference Treasurer', person_id: null }));
  assert.equal(claim.status, 'paid');

  // a mistake, corrected: rent to the wrong fund, reversed (a draft first), entered again
  const wrong = post('2031-01-25', 'Hall rent', [['5500', 'MIS', 1000, 0], ['1100', 'MIS', 0, 1000]]);
  const rev = as(() => B.reverseJournal(wrong.id, '2031-01-25', 'Wrong fund'));
  assert.equal(B.getJournal(wrong.id).reversed_by_id, null, 'stands until the reversal is posted');
  as(() => B.postJournal(rev.id));
  post('2031-01-25', 'Hall rent', [['5500', 'GEN', 1000, 0], ['1100', 'GEN', 0, 1000]]);

  // the January statement (the rent is not yet presented)
  const csv = ['Date,Description,Amount,Ref', '2031-01-04,PAYNOW,200.00,R1', '2031-01-11,PAYNOW,25.00,R2', '2031-01-11,PAYNOW,35.00,R3',
    '2031-01-13,CASH DEPOSIT,800.00,R4', '2031-01-20,FAST CLAIM,-150.00,R5', '2031-01-31,SERVICE CHARGE,-5.00,R6'].join('\n');
  const imp = as(() => Bank.importStatement({ account_id: acc('1100'), data: Buffer.from(csv), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', reference: 'Ref', date_format: 'YYYY-MM-DD' }, opening_balance: c(12000), closing_balance: c(12905) }));
  const sid = imp.statement_id!;
  as(() => Bank.autoMatch(sid));
  let st = Bank.getStatement(sid);
  // the two PayNow gifts against the service's one offering line (a group)
  const jan11Bank = jan11.lines.find((l) => l.account_id === acc('1100'))!;
  const gifts = st.lines.filter((l) => l.status === 'open' && (l.amount === c(25) || l.amount === c(35)));
  as(() => Bank.matchGroup(gifts.map((l) => l.id), [jan11Bank.id!]));
  // the bank charge, entered from its line and posted
  const charge = Bank.getStatement(sid).lines.find((l) => l.amount === -c(5))!;
  as(() => Bank.entryFromLine(charge.id, { account_id: acc('5700'), fund_id: fund('GEN'), post: true }));
  st = Bank.getStatement(sid);
  assert.deepEqual(st.lines.filter((l) => l.status !== 'matched').map((l) => [l.date, l.amount]), [], 'every line matched');
  assert.equal(st.reconciliation.book_balance, c(11905));
  assert.equal(st.reconciliation.uncleared_total, -c(1000), 'the rent, not yet presented');
  assert.equal(st.reconciliation.difference, 0, 'reconciled');

  // January is closed: nothing can be posted into it; an administrator reopens it
  assert.equal(B.postingProblems({ date: '2031-01-31', kind: 'manual', lines: [] }).some((p) => /closed/.test(p)), false);
  as(() => B.closeThrough('2031-01-31'));
  const late = as(() => B.saveDraft(null, { date: '2031-01-30', memo: 'Late', lines: [{ account_id: acc('5990'), fund_id: fund('GEN'), debit: 100, credit: 0 }, { account_id: acc('1000'), fund_id: fund('GEN'), debit: 0, credit: 100 }] }));
  assert.throws(() => as(() => B.postJournal(late.id)), /closed up to 2031-01-31/);
  as(() => B.deleteDraft(late.id));
  assert.throws(() => as(() => B.reopenThrough(null, false)), /administrator/);
  as(() => B.reopenThrough(null, true));
  as(() => B.closeThrough('2031-01-31'));

  // 2031's reports against the figures worked out by hand
  const ie = Rp.incomeExpenditure('2031-01-01', '2031-12-31');
  assert.equal(ie.income.by_fund[fund('GEN')], c(860));
  assert.equal(ie.income.by_fund[fund('MIS')], c(200));
  assert.equal(ie.expense.by_fund[fund('GEN')], c(1155));
  assert.equal(ie.expense.by_fund[fund('MIS')] ?? 0, 0, 'the mistaken rent nets to nothing');
  assert.equal(ie.total_surplus, c(-95));
  const bs = Rp.balanceSheet('2031-12-31');
  const asset = (code: string) => bs.assets.rows.find((r) => r.code === code)?.amount ?? 0;
  const liab = (code: string) => bs.liabilities.rows.find((r) => r.code === code)?.amount ?? 0;
  assert.equal(asset('1100'), c(11905));
  assert.equal(asset('1000'), c(500));
  assert.equal(asset('1010'), 0, 'every offering banked');
  assert.equal(liab('2100'), 0, 'the claim repaid');
  assert.equal(liab('2000'), c(300));
  assert.equal(bs.net_assets, c(12105));
  assert.ok(bs.balanced);
  assert.equal(bs.funds.find((f) => f.code === 'GEN')!.amount, c(9905));
  assert.equal(bs.funds.find((f) => f.code === 'MIS')!.amount, c(2200));
  const fm = Rp.fundMovements('2031-01-01', '2031-12-31').rows;
  const gen = fm.find((r) => r.code === 'GEN')!;
  assert.deepEqual([gen.opening, gen.income, gen.expense, gen.closing], [c(10200), c(860), c(1155), c(9905)]);
  const tb = Rp.trialBalance('2031-12-31');
  assert.equal(tb.debit, tb.credit);
  // the claim: one expense and one payment, both posted
  const claimJournals = get<{ n: number }>("SELECT COUNT(*) n FROM bk_journals WHERE claim_id = ? AND status = 'posted'", claim.id)!.n;
  assert.equal(claimJournals, 2);
  // fellowship spending: the claim on 5400
  assert.equal(ie.expense.rows.find((r) => r.code === '5400')!.total, c(150));

  // the accountant's export: every posted line once, debits equal credits
  const [head, ...rows] = journalsCsv('2031-01-01', '2031-12-31');
  assert.equal(head[0], 'Journal');
  const sum = (i: number) => rows.reduce((n, r) => n + Math.round(Number(r[i] || 0) * 100), 0);
  assert.equal(sum(10), sum(11), 'debits = credits in the export');
  assert.equal(rows.length, get<{ n: number }>("SELECT COUNT(*) n FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE j.status = 'posted' AND j.date BETWEEN '2031-01-01' AND '2031-12-31'")!.n);

  // the new year: income and expenses start again; the funds carry their balances
  service('2032-01-04', [{ fund: 'General', method: 'paynow', amount: 100 }]);
  const ie32 = Rp.incomeExpenditure('2032-01-01', '2032-12-31');
  assert.equal(ie32.income.total, c(100));
  assert.equal(ie32.expense.total, 0);
  const tb32 = Rp.trialBalance('2032-01-31');
  assert.equal(tb32.rows.find((r) => r.account_id === 0)?.credit ?? 0, 0);
  assert.equal(tb32.rows.find((r) => r.account_id === 0)?.debit, c(95), 'the earlier years’ deficit of 95.00');
  assert.equal(tb32.debit, tb32.credit);
  assert.equal(Rp.fundBalances('2032-01-31').get(fund('GEN')), c(10005));
});
