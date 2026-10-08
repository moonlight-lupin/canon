// 0.18.0: recovery with the books in it — an encrypted backup of a church with posted journals, a paid expense claim
// with its receipt, a bank statement matched (in a group too) and a closed month comes back exactly: the same
// reports, the receipt's bytes, the matches, the closed month — and posted journals are still protected after it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-recovery-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { seed } = await import('../server/seed/index.ts');
const S = await import('../server/repo/settings.ts');
const Bk = await import('../server/repo/backups.ts');
const Crypto = await import('../server/lib/backup-crypto.ts');
const B = await import('../server/repo/bookkeeping.ts');
const Rp = await import('../server/repo/bk-reports.ts');
const Bank = await import('../server/repo/bk-bank.ts');
const C = await import('../server/repo/bk-claims.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { closeDb, get, run } = await import('../server/db.ts');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const INK = `data:image/png;base64,${PNG.toString('base64')}`;
const as = <T,>(fn: () => T) => asActor({ user_id: null, user_name: 'Recovery Treasurer', via: 'web' }, fn);
const acc = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)!.id;
const fund = (code: string) => get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', code)!.id;
const post = (date: string, memo: string, lines: [string, string, number, number][]) => as(() => B.postJournal(B.saveDraft(null, {
  date, memo, lines: lines.map(([a, f, dr, cr]) => ({ account_id: acc(a), fund_id: fund(f), debit: dr, credit: cr })),
}).id));

before(async () => {
  await seed();
  S.updateSettings({ modules: { ...S.getSettings().modules, bookkeeping: true }, backup: { ...S.getSettings().backup, dir: path.join(tmp, 'backups'), encrypted: true } });
  Crypto.setBackupPassword('recovery-password-1');
});
after(() => {
  try {
    closeDb();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** What a restore must bring back exactly. */
function snapshot() {
  const tb = Rp.trialBalance('2031-12-31');
  const claim = get<{ id: number; status: string; approval_journal_id: number; payment_journal_id: number }>('SELECT id, status, approval_journal_id, payment_journal_id FROM bk_claims')!;
  const file = get<{ id: number }>('SELECT id FROM bk_claim_files')!;
  return {
    tb: tb.rows.map((r) => [r.code, r.debit, r.credit]),
    funds: [...Rp.fundBalances('2031-12-31')].sort(),
    journals: get<{ n: number; posted: number }>("SELECT COUNT(*) n, SUM(status = 'posted') posted FROM bk_journals"),
    claim,
    receipt: crypto.createHash('sha256').update(C.claimFileData(file.id).data).digest('hex'),
    matches: get<{ single: number; grouped: number; groups: number }>("SELECT SUM(line_id IS NOT NULL) single, SUM(group_id IS NOT NULL) grouped, (SELECT COUNT(*) FROM bk_match_groups) groups FROM bk_statement_lines"),
    closed: B.bkSettings().closed_through,
  };
}

test('an encrypted backup of the books restores exactly, and posted journals stay protected', async () => {
  as(() => B.setupBooks({ start_date: '2031-01-01', year_end_month: 12, template: true }));
  post('2031-01-01', 'Opening (fictional)', [['1100', 'GEN', 500000, 0], ['3000', 'GEN', 0, 500000]]);
  const off = post('2031-01-04', 'Offerings (fictional)', [['1100', 'GEN', 6000, 0], ['4000', 'GEN', 0, 6000]]);
  post('2031-01-05', 'Rent (fictional)', [['5500', 'GEN', 10000, 0], ['1100', 'GEN', 0, 10000]]);
  // a claim with a receipt, approved, its expense and payment posted
  run("INSERT INTO people (id, first_name, last_name, email) VALUES (801, 'Cora', 'Laim', 'cora@example.org'), (802, 'Al', 'Prover', 'al@example.org')");
  C.saveApprover(null, { person_id: 802 });
  const me: import('../server/repo/bk-claims.ts').Party = { as: 'claimant', person_id: 801, name: 'Cora Laim' };
  let cl = as(() => C.createClaim(801, { pay_to: 'PayNow (fictional)', lines: [{ date: '2031-01-06', description: 'Paper', payee: 'A shop', amount: 1200 }] }, me));
  cl = as(() => C.addClaimFile(cl.id, { name: 'receipt.png', mime: 'image/png', data: PNG }, me));
  as(() => C.submitClaim(cl.id, { image: INK }, me));
  cl = as(() => C.decideClaim(cl.id, { decision: 'approved', image: INK }, { person_id: 802, name: 'Al Prover' }));
  const exp = B.getJournal(cl.approval_journal_id!);
  as(() => B.postJournal(B.saveDraft(exp.id, { date: '2031-01-07', memo: exp.memo, kind: 'claim', lines: exp.lines }).id));
  as(() => C.payClaim(cl.id, { date: '2031-01-08', bank_account_id: acc('1100'), post: true }, { name: 'Recovery Treasurer', person_id: null }));
  // the statement: two gifts in a group against the offering line; the rent and the claim one to one
  const csv = ['Date,Description,Amount', '2031-01-04,GIFT,25.00', '2031-01-04,GIFT,35.00', '2031-01-05,RENT,-100.00', '2031-01-08,CLAIM,-12.00'].join('\n');
  const imp = as(() => Bank.importStatement({ account_id: acc('1100'), data: Buffer.from(csv), layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', date_format: 'YYYY-MM-DD' } }));
  as(() => Bank.autoMatch(imp.statement_id!));
  const gifts = Bank.getStatement(imp.statement_id!).lines.filter((l) => l.status === 'open');
  as(() => Bank.matchGroup(gifts.map((l) => l.id), [off.lines.find((l) => l.account_id === acc('1100'))!.id!]));
  as(() => B.closeThrough('2031-01-31'));
  const before = snapshot();
  assert.equal(before.claim.status, 'paid');
  assert.deepEqual([before.matches!.single, before.matches!.grouped, before.matches!.groups], [2, 2, 1]);

  // an encrypted backup; then things change
  const backup = Bk.createBackup();
  assert.match(backup.name, /\.db\.enc$/, 'encrypted');
  as(() => B.reopenThrough(null, true));
  post('2031-02-01', 'After the backup (fictional)', [['5990', 'GEN', 100, 0], ['1100', 'GEN', 0, 100]]);
  Bank.dissolveGroup(get<{ id: number }>('SELECT id FROM bk_match_groups')!.id);
  run("UPDATE bk_claims SET note = 'changed after the backup'");

  // restore: everything as it was
  const r = await Bk.restoreBackup(backup.path);
  assert.ok(r.safety);
  assert.deepEqual(snapshot(), before);
  assert.ok(!get("SELECT 1 FROM bk_journals WHERE memo = 'After the backup (fictional)'"));
  // and the database still refuses to change a posted journal
  assert.throws(() => run('UPDATE bk_lines SET debit = 1 WHERE journal_id = ?', off.id), /cannot be changed/);
  assert.throws(() => run('DELETE FROM bk_journals WHERE id = ?', off.id), /cannot be deleted/);
  // the safety copy (encrypted too) undoes the restore
  assert.match(r.safety, /\.db\.enc$/);
});
