// 0.17.1: expense claims — a member claims on their phone (several receipts, signed on screen), named approvers (not a
// role) approve, two above a set amount, never their own; approval drafts the expense owed and paying drafts the
// payment; the office books each line; AI assistants draft a claim and hand back its link. Fictional people only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-claims-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const B = await import('../server/repo/bookkeeping.ts');
const C = await import('../server/repo/bk-claims.ts');
const { memberToken } = await import('../server/repo/lending-self.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { db, get, run, all } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<string, Session> = {};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const INK = `data:image/png;base64,${PNG.toString('base64')}`;

async function call(who: Session | null, method: string, url: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (who) Object.assign(headers, { Cookie: who.cookie, 'X-CSRF-Token': who.csrf });
  if (token) headers['X-Self-Token'] = token;
  let payload: BodyInit | undefined;
  if (Buffer.isBuffer(body)) {
    headers['Content-Type'] = 'image/png';
    payload = body as unknown as BodyInit;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(`${base}/api${url}`, { method, headers, body: payload });
  const txt = await r.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(txt);
  } catch { /* a file */ }
  return { status: r.status, body: json as Json, text: txt };
}
async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-7' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
const person = (first: string, last: string, email: string) => Number(run('INSERT INTO people (first_name, last_name, email) VALUES (?,?,?)', first, last, email).lastInsertRowid);
const acc = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)!.id;
const tok = (pid: number) => memberToken(pid, 'claims').token;

let ann = 0; // claimant
let ben = 0; // approver (and, with the treasurer's account, the one who pays)
let cid = 0; // approver for the youth ministry only, up to 100.00
let dee = 0; // second approver

before(async () => {
  await seed();
  updateSettings({ modules: { ...getSettings().modules, bookkeeping: true }, offering: { ...getSettings().offering, currency: 'SGD' } });
  asActor({ user_id: null, user_name: 'Test', via: 'web' }, () => B.setupBooks({ start_date: '2030-01-01', year_end_month: 12, template: true }));
  ann = person('Ann', 'Example', 'ann@example.org');
  ben = person('Ben', 'Example', 'ben@example.org');
  cid = person('Cid', 'Example', 'cid@example.org');
  dee = person('Dee', 'Example', 'dee@example.org');
  for (const [u, role, pid] of [['admin', 'admin', null], ['treasurer', 'treasurer', ben], ['ann', 'viewer', ann], ['guest', 'guest', null], ['editor', 'editor', null]] as const) {
    createUser({ username: u, display_name: `Test ${u}`, password: 'correct-horse-7', role });
    if (pid) run('UPDATE users SET person_id = ? WHERE username = ?', pid, u);
  }
  server = createApp().listen(0, '127.0.0.1');
  // a full parallel test run is slow: idle connections stay open for the next request (no reset mid-test)
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'treasurer', 'ann', 'guest', 'editor']) as[u] = await login(u);
  const youth = (await call(as.treasurer, 'POST', '/bookkeeping/tags/ministries', { code: 'YTH', name: { en: 'Youth' } })).body.id;
  await call(as.treasurer, 'POST', '/bookkeeping/claim-approvers', { person_id: ben });
  await call(as.treasurer, 'POST', '/bookkeeping/claim-approvers', { person_id: cid, ministry_ids: [youth], max_amount: 10000 });
  await call(as.treasurer, 'POST', '/bookkeeping/claim-approvers', { person_id: dee });
});
after(() => {
  server.close();
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a member claims on their phone: lines, receipts, where to repay, signed; an approver approves; the expense is drafted', async () => {
  // signing in by e-mailed code is off until the treasurer switches it on (and e-mail and a public address work)
  assert.equal((await call(null, 'POST', '/self/claims/code', { email: 'ann@example.org' })).status, 503);
  // someone signed in to Canon claims as their linked member
  const s = await call(as.ann, 'POST', '/me/claims-session');
  assert.equal(s.status, 200, s.text);
  const t = s.body.token as string;
  let c = (await call(null, 'POST', '/self/claims', { purpose: 'Cell group supplies (fictional)', lines: [
    { date: '2030-03-02', description: 'Snacks', payee: 'A shop', amount: 4560 },
    { date: '2030-03-03', description: 'Printing', payee: 'A printer', amount: 1200 },
  ] }, t)).body;
  assert.equal(c.status, 'draft');
  assert.ok(c.problems.some((p: string) => /receipts/.test(p)) && c.problems.some((p: string) => /repay/.test(p)));
  c = (await call(null, 'POST', `/self/claims/${c.id}/files?name=receipt1.png&line_id=${c.lines[0].id}`, PNG, t)).body;
  assert.equal(c.files.length, 1);
  assert.equal((await call(null, 'POST', `/self/claims/${c.id}/files?name=fake.png`, Buffer.from('not a picture'), t)).status, 400);
  c = (await call(null, 'PUT', `/self/claims/${c.id}`, { purpose: c.purpose, pay_to: 'PayNow 8000 0000 (fictional)', lines: c.lines }, t)).body;
  assert.equal(c.files[0].line_id, c.lines[0].id, 'the receipt stays with its line when the lines are saved again');
  assert.deepEqual(c.problems, []);
  assert.equal((await call(null, 'POST', `/self/claims/${c.id}/submit`, { image: 'nope' }, t)).status, 400, 'sign first');
  c = (await call(null, 'POST', `/self/claims/${c.id}/submit`, { image: INK, name: 'Someone Else' }, t)).body;
  assert.equal(c.status, 'submitted');
  assert.equal(c.signature.name, c.claimant, 'signed in her own name, whatever name the page sends');
  assert.match(c.number, /^C\d{4}-0001$/);
  assert.equal(c.may_approve, false, 'not her own');
  assert.equal((await call(null, 'PUT', `/self/claims/${c.id}`, { lines: [] }, t)).status, 409, 'a submitted claim is not changed');

  // Cid approves youth claims only; Ben may approve any
  assert.equal((await call(null, 'POST', `/self/claims/${c.id}/decide`, { decision: 'approved', image: INK }, tok(cid))).status, 403, 'not his to decide');
  assert.equal((await call(null, 'GET', `/self/claims/${c.id}`, undefined, tok(cid))).status, 404, 'nor to see');
  const benSees = (await call(null, 'GET', `/self/claims/${c.id}`, undefined, tok(ben))).body;
  assert.equal(benSees.may_approve, true);
  assert.equal(benSees.pay_to, '•••', 'an approver doesn’t see where she is repaid');
  const mine = (await call(null, 'GET', '/self/claims/mine', undefined, tok(ben))).body;
  assert.ok(mine.approver && mine.to_approve.some((x: Json) => x.id === c.id));
  const ok = (await call(null, 'POST', `/self/claims/${c.id}/decide`, { decision: 'approved', image: INK }, tok(ben))).body;
  assert.equal(ok.status, 'approved');
  const claim = C.getClaim(c.id);
  const j = B.getJournal(claim.approval_journal_id!);
  assert.equal(j.kind, 'claim');
  assert.equal(j.status, 'draft');
  assert.deepEqual(j.lines.map((l) => [l.account_id, l.debit, l.credit]), [[acc('5990'), 4560, 0], [acc('5990'), 1200, 0], [acc('2100'), 0, 5760]]);

  // the office books the printing to Printing and stationery: the draft follows
  await call(as.treasurer, 'PUT', `/bookkeeping/claims/${c.id}/booking`, { lines: claim.lines.map((l, i) => ({ id: l.id, account_id: i === 1 ? acc('5620') : null })) });
  assert.equal(B.getJournal(claim.approval_journal_id!).lines[1].account_id, acc('5620'));

  // paid by the treasurer, whose account is Ben's: allowed, and marked
  const paid = (await call(as.treasurer, 'POST', `/bookkeeping/claims/${c.id}/pay`, { date: '2030-03-10', bank_account_id: acc('1100'), reference: 'FAST 123', post: false })).body;
  assert.equal(paid.status, 'paid');
  assert.equal(paid.approver_paid, true);
  const pj = B.getJournal(paid.payment_journal_id);
  assert.deepEqual(pj.lines.map((l) => [l.account_id, l.debit, l.credit]), [[acc('2100'), 5760, 0], [acc('1100'), 0, 5760]]);
  // the log has the claimant's own steps, by name
  assert.ok(all<{ user_name: string }>("SELECT user_name FROM change_log WHERE entity = 'bk_claims' AND entity_id = ?", c.id).some((r) => /Ann/.test(r.user_name)));
});

test('above the set amount two different approvers; sent back, changed and signed again; rejected', async () => {
  await call(as.treasurer, 'PUT', '/bookkeeping/claim-settings', { claims_self_service: false, claims_two_above: 10000, claims_payable_account_id: null, claims_default_account_id: null });
  const t = tok(ann);
  const make = async (amount: number) => {
    let c = (await call(null, 'POST', '/self/claims', { pay_to: 'PayNow 8000 0000 (fictional)', lines: [{ date: '2030-04-01', description: 'Hall deposit', payee: 'A hall', amount }] }, t)).body;
    c = (await call(null, 'POST', `/self/claims/${c.id}/files?name=r.png`, PNG, t)).body;
    return (await call(null, 'POST', `/self/claims/${c.id}/submit`, { image: INK }, t)).body;
  };
  const big = await make(50000);
  assert.equal(big.needed, 2);
  let d = (await call(null, 'POST', `/self/claims/${big.id}/decide`, { decision: 'approved', image: INK }, tok(ben))).body;
  assert.equal(d.status, 'submitted', 'one of two');
  assert.equal((await call(null, 'POST', `/self/claims/${big.id}/decide`, { decision: 'approved', image: INK }, tok(ben))).status, 409, 'not twice by the same person');
  d = (await call(null, 'POST', `/self/claims/${big.id}/decide`, { decision: 'approved', image: INK }, tok(dee))).body;
  assert.equal(d.status, 'approved');

  const back = await make(3000);
  assert.equal((await call(null, 'POST', `/self/claims/${back.id}/decide`, { decision: 'returned' }, tok(ben))).status, 400, 'say why');
  d = (await call(null, 'POST', `/self/claims/${back.id}/decide`, { decision: 'returned', note: 'Please add the receipt for the second item' }, tok(ben))).body;
  assert.equal(d.status, 'draft');
  const again = (await call(null, 'GET', `/self/claims/${back.id}`, undefined, t)).body;
  assert.equal(again.may_edit, true);
  assert.equal(again.signature, null, 'the signature no longer applies');
  assert.equal((await call(null, 'POST', `/self/claims/${back.id}/submit`, { image: INK }, t)).body.status, 'submitted');
  d = (await call(null, 'POST', `/self/claims/${back.id}/decide`, { decision: 'rejected', note: 'Not a church expense' }, tok(dee))).body;
  assert.equal(d.status, 'rejected');
  assert.equal(C.getClaim(back.id).approval_journal_id, null, 'nothing in the books');
});

test('the office: a paper claim for a member, read-only roles don’t see where to repay, editors don’t see claims', async () => {
  const c = (await call(as.treasurer, 'POST', '/bookkeeping/claims', { person_id: dee, pay_to: 'Bank 000-000 (fictional)', lines: [{ date: '2030-05-01', description: 'Flowers', payee: 'A florist', amount: 2500 }] })).body;
  await call(as.treasurer, 'POST', `/bookkeeping/claims/${c.id}/files?name=scan.png`, PNG);
  const sub = (await call(as.treasurer, 'POST', `/bookkeeping/claims/${c.id}/submit-paper`)).body;
  assert.equal(sub.status, 'submitted');
  assert.equal(sub.signature.via, 'paper');
  assert.ok(!sub.approvers.some((a: Json) => a.person_id === dee), 'not her own');
  assert.equal((await call(as.guest, 'GET', `/bookkeeping/claims/${c.id}`)).body.pay_to, '•••');
  assert.equal((await call(as.editor, 'GET', '/bookkeeping/claims')).status, 403);
  const receipt = await call(as.guest, 'GET', `/bookkeeping/claims/files/${sub.files[0].id}`);
  assert.equal(receipt.status, 200);
});

test('AI assistants: draft a claim for yourself from receipts, hand back the link; never for someone else, never submit', async () => {
  const { CLAIMS_TOOLS } = await import('../server/mcp-tools/claims.ts');
  const { allowedTools } = await import('../server/mcp.ts');
  const cfg = { ...getSettings().mcp, enabled: true, modules: { ...getSettings().mcp.modules, bookkeeping: 'write' as const } };
  const names = allowedTools(cfg, new Set(['canon:read', 'canon:write']), 'viewer').map((t) => t.name);
  assert.ok(names.includes('canon_draft_claim') && names.includes('canon_claims'), 'anyone may claim, whatever their role');
  assert.ok(!names.includes('canon_draft_journal'), 'but not keep the books');
  const tool = (n: string) => CLAIMS_TOOLS.find((x) => x.name === n)!;
  const annUser = get<Json>("SELECT * FROM users WHERE username = 'ann'")!;
  const ctx = { auth: { user: annUser, clientId: 'test', scopes: new Set(['canon:write']), grantId: 'g' }, pii: false } as never;
  const mcp = <T,>(fn: () => T) => asActor({ user_id: annUser.id, user_name: 'Test ann', via: 'mcp' }, fn);
  const d = (await mcp(() => tool('canon_draft_claim').handler({ purpose: 'Youth camp', lines: [{ date: '2030-06-01', description: 'Camp snacks', payee: 'A shop', amount_cents: 3210 }] }, ctx))) as Json;
  assert.equal(d.status, 'draft');
  assert.match(d.link, /\/self\/claims\/\d+$/);
  assert.ok(d.still_needed.some((p: string) => /receipts/.test(p)));
  assert.equal(C.getClaim(d.id).created_via, 'mcp');
  assert.throws(() => mcp(() => tool('canon_draft_claim').handler({ claimant_person_id: dee, lines: [{ date: '2030-06-01', description: 'X', amount_cents: 1 }] }, ctx)), /yourself only/);
  assert.throws(() => mcp(() => C.submitClaim(d.id, { image: INK }, { as: 'ai', person_id: ann, name: 'x' })), /only prepares/);
  const list = (await mcp(() => tool('canon_claims').handler({}, ctx))) as Json;
  assert.ok(list.claims.every((c: Json) => c.claimant.startsWith('Ann')), 'her own claims only');
  assert.ok(!JSON.stringify(list).includes('PayNow'), 'never where she is repaid');
});

// ---------------------------------------------------------------- the 0.18.0 review of claims

const web = <T,>(fn: () => T) => asActor({ user_id: null, user_name: 'Test treasurer', via: 'web' }, fn);
async function submitted(pid: number, amount: number, ministry: number | null) {
  const t = tok(pid);
  let c = (await call(null, 'POST', '/self/claims', { pay_to: 'PayNow 8000 0000 (fictional)', ministry_id: ministry, lines: [{ date: '2030-07-01', description: 'Review test', payee: 'A shop', amount }] }, t)).body;
  c = (await call(null, 'POST', `/self/claims/${c.id}/files?name=r.png`, PNG, t)).body;
  return (await call(null, 'POST', `/self/claims/${c.id}/submit`, { image: INK }, t)).body;
}
const decide = async (id: number, pid: number, decision = 'approved', note?: string) => (await call(null, 'POST', `/self/claims/${id}/decide`, { decision, image: INK, note }, tok(pid))).body;

test('review: approvals count for the submission they were given for, and from people who may still approve it', async () => {
  await call(as.treasurer, 'PUT', '/bookkeeping/claim-settings', { claims_self_service: false, claims_two_above: 4000, claims_payable_account_id: null, claims_default_account_id: null });
  const youth = get<{ id: number }>("SELECT id FROM bk_ministries WHERE code = 'YTH'")!.id;
  // sent back and submitted again, in another ministry: the youth approver's earlier approval doesn't carry over
  const a = await submitted(ann, 5000, youth);
  assert.equal(a.needed, 2);
  assert.equal((await decide(a.id, cid)).status, 'submitted');
  assert.equal((await decide(a.id, ben, 'returned', 'Wrong ministry')).status, 'draft');
  const t = tok(ann);
  const cur = (await call(null, 'GET', `/self/claims/${a.id}`, undefined, t)).body;
  await call(null, 'PUT', `/self/claims/${a.id}`, { purpose: cur.purpose, pay_to: 'PayNow 8000 0000 (fictional)', ministry_id: null, lines: cur.lines }, t);
  assert.equal((await call(null, 'POST', `/self/claims/${a.id}/submit`, { image: INK }, t)).body.status, 'submitted');
  assert.equal((await decide(a.id, ben)).status, 'submitted', 'one approval of this submission, not two');
  assert.equal((await decide(a.id, dee)).status, 'approved');
  // moved by the office to another ministry while waiting: its approvals start again
  const b = await submitted(ann, 5000, youth);
  assert.equal((await decide(b.id, cid)).status, 'submitted');
  assert.equal((await call(as.treasurer, 'PUT', `/bookkeeping/claims/${b.id}/booking`, { ministry_id: null, lines: [] })).status, 200);
  assert.equal((await decide(b.id, ben)).status, 'submitted', 'the youth approval no longer counts');
  assert.equal((await decide(b.id, dee)).status, 'approved');
});

test('review: the expense is booked before the payment; nobody pays their own claim; a deleted payment draft un-pays it', async () => {
  await call(as.treasurer, 'PUT', '/bookkeeping/claim-settings', { claims_self_service: false, claims_two_above: null, claims_payable_account_id: null, claims_default_account_id: null });
  const c = await submitted(ann, 1500, null);
  assert.equal((await decide(c.id, dee)).status, 'approved');
  const pay = (post: boolean) => call(as.treasurer, 'POST', `/bookkeeping/claims/${c.id}/pay`, { date: '2030-07-10', bank_account_id: acc('1100'), post });
  // the expense draft deleted: paying drafts it again, and won't post the payment before it
  web(() => B.deleteDraft(C.getClaim(c.id).approval_journal_id!));
  assert.equal(C.getClaim(c.id).approval_journal_id, null);
  const refused = await pay(true);
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /expense first/);
  const expense = C.getClaim(c.id).approval_journal_id!;
  assert.ok(expense, 'drafted again');
  // paid as a draft, then the draft deleted: approved again, and paid properly
  const paid = (await pay(false)).body;
  assert.equal(paid.status, 'paid');
  web(() => B.deleteDraft(paid.payment_journal_id));
  assert.deepEqual([C.getClaim(c.id).status, C.getClaim(c.id).payment_journal_id], ['approved', null]);
  // (approval dates it today; these fictional books start in 2030)
  web(() => { const j = B.getJournal(expense); B.saveDraft(expense, { date: '2030-07-05', memo: j.memo, lines: j.lines }); return B.postJournal(expense); });
  assert.equal((await pay(true)).body.status, 'paid');
  assert.equal(B.getJournal(C.getClaim(c.id).payment_journal_id!).status, 'posted');
  // Ben's own claim: the treasurer's account is Ben's, so someone else pays it
  const own = await submitted(ben, 1000, null);
  assert.equal((await decide(own.id, dee)).status, 'approved');
  const r = await call(as.treasurer, 'POST', `/bookkeeping/claims/${own.id}/pay`, { date: '2030-07-10', bank_account_id: acc('1100'), post: false });
  assert.equal(r.status, 403);
});

test('review: an approver’s sign-in e-mail is changed by an administrator or the treasurer, not by whoever edits members', async () => {
  const patch = (who: Session, pid: number, email: string) => call(who, 'PATCH', `/people/${pid}`, { email });
  assert.equal((await patch(as.editor, ben, 'someone@example.org')).status, 403, 'an editor can’t move an approver’s sign-in');
  assert.equal(get<{ email: string }>('SELECT email FROM people WHERE id = ?', ben)!.email, 'ben@example.org');
  const other = await patch(as.editor, ann, 'ann2@example.org');
  assert.equal(other.status, 200, `other members as before: ${other.text}`);
  assert.equal((await patch(as.admin, ben, 'ben2@example.org')).status, 200, 'an administrator can');
  assert.equal((await patch(as.admin, ben, 'ben@example.org')).status, 200);
  await patch(as.admin, ann, 'ann@example.org');
});

test('review: AI assistants with read-only access to the books write claims for themselves only', async () => {
  const { CLAIMS_TOOLS } = await import('../server/mcp-tools/claims.ts');
  const tool = CLAIMS_TOOLS.find((x) => x.name === 'canon_draft_claim')!;
  const guest = get<Json>("SELECT * FROM users WHERE username = 'guest'")!;
  const ctx = { auth: { user: guest, clientId: 'test', scopes: new Set(['canon:write']), grantId: 'g' }, pii: false } as never;
  const mcp = <T,>(fn: () => T) => asActor({ user_id: guest.id, user_name: 'Test guest', via: 'mcp' }, fn);
  assert.throws(() => mcp(() => tool.handler({ claimant_person_id: dee, lines: [{ date: '2030-08-01', description: 'X', amount_cents: 100 }] }, ctx)), /yourself only/);
  const deesDraft = C.createClaim(dee, { purpose: 'Dee’s own (fictional)', lines: [] }, { as: 'claimant', person_id: dee, name: 'Dee' });
  assert.throws(() => mcp(() => tool.handler({ id: deesDraft.id, claimant_person_id: dee, lines: [{ date: '2030-08-01', description: 'Changed', amount_cents: 100 }] }, ctx)), /yourself only|someone else/);
});
