// Expense claims (0.17.1, part of book-keeping). A claimant (on their phone, in Canon, through the office, or drafted
// by an AI assistant) lists what they paid — several receipts per claim, each line with its receipt photos — and
// signs. Named approvers (people, not a role: each account has one role) approve with an on-screen signature; above a
// set amount two different approvers must. Approval drafts the expense owed (Dr expense / Cr Claims to repay);
// paying drafts the payment (Dr Claims to repay / Cr bank), matched later on the bank statement. The treasurer posts
// both, as every journal. Nobody approves their own claim; an approver who also pays is allowed, and marked.
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.ts';
import { BadRequest, Conflict, Forbidden, NotFound } from '../lib/table.ts';
import { currentActor } from '../lib/actor.ts';
import { wallSql } from '../lib/walls.ts';
import { roleDef } from '../lib/permissions.ts';
import { logChange } from './changelog.ts';
import { getSettings, updateSettings } from './settings.ts';
import { bkSettings, getJournal, postJournal, postingProblems, saveDraft } from './bookkeeping.ts';
import { checkUpload } from './equipment.ts';
import { sendMail, smtpConfigured } from '../lib/mailer.ts';
import { esc, logEmail, messageLangs, wrapHtml } from './email.ts';
import { st } from '../lib/server-text.ts';
import { publicUrl } from '../lib/public-url.ts';
import { addressForOthers } from '../lib/lan.ts';
import type { BkLine, BookkeepingSettings, Claim, ClaimApproval, ClaimApprover, ClaimFile, ClaimLine, ClaimSignature, ClaimStatus } from '../../shared/bookkeeping.ts';
import type { Lang } from '../../shared/types.ts';
import { churchToday } from '../lib/dates.ts';

/** Who is acting on a claim. */
export interface Party {
  /** the claimant themselves (phone, or their Canon account), the office (book-keeping edit), an approver, or an AI assistant drafting */
  as: 'claimant' | 'office' | 'approver' | 'ai';
  person_id: number | null;
  name: string;
}

type Row = Omit<Claim, 'lines' | 'files' | 'approvals' | 'total' | 'signature' | 'approver_paid'> & { signature: string | null; approver_paid: number };

const today = () => churchToday();
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- reading

const linesOf = (id: number) => all<ClaimLine & { id: number }>(
  'SELECT id, date, description, payee, amount, account_id, fund_id, ministry_id, project_id FROM bk_claim_lines WHERE claim_id = ? ORDER BY position, id', id,
);
const filesOf = (id: number) => all<ClaimFile>('SELECT id, line_id, name, mime, size, created_at FROM bk_claim_files WHERE claim_id = ? ORDER BY id', id);
const approvalsOf = (id: number) => all<ClaimApproval>('SELECT id, person_id, name, decision, note, image, hash, via, round, at FROM bk_claim_approvals WHERE claim_id = ? ORDER BY id', id);

export function getClaim(id: number): Claim {
  const r = get<Row>('SELECT * FROM bk_claims WHERE id = ?', id);
  if (!r) throw new NotFound('Claim not found');
  const lines = linesOf(id);
  return {
    ...r, approver_paid: !!r.approver_paid, signature: r.signature ? (JSON.parse(r.signature) as ClaimSignature) : null,
    lines, files: filesOf(id), approvals: approvalsOf(id), total: lines.reduce((n, l) => n + (l.amount || 0), 0),
  };
}

export interface ClaimQuery {
  status?: ClaimStatus | 'open'; person_id?: number; q?: string; from?: string; to?: string; limit?: number;
  /** the office's list (Book-keeping → Claims, an assistant for the books): behind the account's congregation wall (0.19.4) */
  walled?: boolean;
}

/** Claims, newest first, without signatures' images (a list). */
export function listClaims(q: ClaimQuery = {}) {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (q.status === 'open') where.push("c.status IN ('submitted','approved')");
  else if (q.status) { where.push('c.status = ?'); p.push(q.status); }
  if (q.person_id) { where.push('c.person_id = ?'); p.push(q.person_id); }
  if (q.walled) {
    // an account limited to one congregation sees that congregation's claims and the whole church's
    const w = wallSql('c.congregation_id');
    if (w.sql) { where.push(w.sql.replace(/^ AND /, '')); p.push(...(w.params as (string | number)[])); }
  }
  if (q.from) { where.push('date(c.created_at) >= ?'); p.push(q.from); }
  if (q.to) { where.push('date(c.created_at) <= ?'); p.push(q.to); }
  if (q.q?.trim()) {
    where.push('(c.claimant LIKE ? OR c.purpose LIKE ? OR c.number LIKE ? OR EXISTS (SELECT 1 FROM bk_claim_lines l WHERE l.claim_id = c.id AND (l.description LIKE ? OR l.payee LIKE ?)))');
    const s = `%${q.q.trim()}%`;
    p.push(s, s, s, s, s);
  }
  return all<{ id: number; number: string | null; claimant: string; person_id: number | null; purpose: string | null; status: ClaimStatus; ministry_id: number | null; total: number; lines: number; files: number; submitted_at: string | null; approved_at: string | null; paid_on: string | null; approver_paid: number; created_via: string; created_at: string }>(
    `SELECT c.id, c.number, c.claimant, c.person_id, c.purpose, c.status, c.ministry_id, c.submitted_at, c.approved_at, c.paid_on, c.approver_paid, c.created_via, c.created_at,
       (SELECT COALESCE(SUM(amount),0) FROM bk_claim_lines WHERE claim_id = c.id) AS total,
       (SELECT COUNT(*) FROM bk_claim_lines WHERE claim_id = c.id) AS lines,
       (SELECT COUNT(*) FROM bk_claim_files WHERE claim_id = c.id) AS files
     FROM bk_claims c ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE c.status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, c.id DESC LIMIT ?`,
    ...p, Math.min(q.limit ?? 300, 1000),
  ).map((r) => ({ ...r, approver_paid: !!r.approver_paid }));
}

// ---------------------------------------------------------------- the log

/** A claim as the change log keeps it: its heading and lines written out; where to repay only as "changed". */
function snapshot(c: Claim) {
  return {
    title: `${c.number ?? 'Draft'} ${c.claimant}`, status: c.status, purpose: c.purpose, pay_to: c.pay_to ? '(set)' : null,
    lines: c.lines.map((l) => `${l.date ?? ''} ${l.description}${l.payee ? ` (${l.payee})` : ''} ${(l.amount / 100).toFixed(2)}`).join('\n'),
    receipts: c.files.length, total: (c.total / 100).toFixed(2),
  };
}
function logClaim(action: 'create' | 'update' | 'delete', before: Claim | null, after: Claim | null, summary?: string) {
  logChange({ entity: 'bk_claims', entity_id: (after ?? before)!.id, action, summary, before: before ? snapshot(before) : null, after: after ? snapshot(after) : null });
}

// ---------------------------------------------------------------- who may do what

const isOwn = (c: Claim, p: Party) => !!p.person_id && c.person_id === p.person_id;
function mayEdit(c: Claim, p: Party) {
  if (c.status !== 'draft') throw new Conflict('Only a claim being prepared can be changed (an approver can send a submitted claim back).');
  if (p.as === 'office' || (p.as === 'ai' && (isOwn(c, p) || c.created_via === 'mcp'))) return;
  if (p.as === 'claimant' && isOwn(c, p)) return;
  throw new Forbidden('This is someone else’s claim.');
}
/** May see the claim: its claimant, the office, an approver who may decide it (or has). */
export function maySee(c: Claim, p: Party) {
  if (p.as === 'office' || isOwn(c, p)) return true;
  if (p.person_id && c.approvals.some((a) => a.person_id === p.person_id)) return true;
  return c.status === 'submitted' && !!p.person_id && mayApprove(c, p.person_id);
}

// ---------------------------------------------------------------- drafting

export interface ClaimInput {
  purpose?: string | null;
  ministry_id?: number | null;
  project_id?: number | null;
  fund_id?: number | null;
  pay_to?: string | null;
  lines: ClaimLine[];
}

function cleanLines(lines: ClaimLine[]): ClaimLine[] {
  if (!Array.isArray(lines)) throw new BadRequest('A claim needs lines.');
  if (lines.length > 100) throw new BadRequest('At most 100 lines in a claim.');
  return lines.map((l, i) => {
    const amount = Math.round(Number(l.amount) || 0);
    if (amount < 0) throw new BadRequest(`Line ${i + 1}: an amount can’t be negative.`);
    if (l.date && !DATE.test(l.date)) throw new BadRequest(`Line ${i + 1}: the date must be YYYY-MM-DD.`);
    return {
      date: l.date || null, description: String(l.description ?? '').trim().slice(0, 300), payee: l.payee?.trim().slice(0, 120) || null, amount,
      // how it is booked: the office (and approvers in Canon) choose; a claimant's or AI's suggestion is kept as given
      account_id: l.account_id ?? null, fund_id: l.fund_id ?? null, ministry_id: l.ministry_id ?? null, project_id: l.project_id ?? null,
    };
  });
}
/** Save a claim's lines; a receipt attached to a line follows it (the line's id when sent, else its place). */
function writeLines(claimId: number, lines: ClaimLine[]) {
  const old = linesOf(claimId);
  const fileLine = all<{ id: number; line_id: number | null }>('SELECT id, line_id FROM bk_claim_files WHERE claim_id = ? AND line_id IS NOT NULL', claimId);
  const newPlace = new Map<number, number>();
  lines.forEach((l, i) => {
    const prev = l.id ? old.find((o) => o.id === l.id) : old[i];
    if (prev && !newPlace.has(prev.id)) newPlace.set(prev.id, i);
  });
  run('UPDATE bk_claim_files SET line_id = NULL WHERE claim_id = ?', claimId);
  run('DELETE FROM bk_claim_lines WHERE claim_id = ?', claimId);
  const ids = lines.map((l, i) => Number(run(
    'INSERT INTO bk_claim_lines (claim_id, position, date, description, payee, amount, account_id, fund_id, ministry_id, project_id) VALUES (?,?,?,?,?,?,?,?,?,?)',
    claimId, i, l.date, l.description, l.payee, l.amount, l.account_id ?? null, l.fund_id ?? null, l.ministry_id ?? null, l.project_id ?? null,
  ).lastInsertRowid));
  for (const f of fileLine) {
    const at = newPlace.get(f.line_id!);
    if (at != null) run('UPDATE bk_claim_files SET line_id = ? WHERE id = ?', ids[at], f.id);
  }
}

/** A new claim (a draft) for a member: by themselves, the office, or an AI assistant for its person. */
const MAX_DRAFTS = 20;
/** Who typed in where to repay: the claimant on their own page, else the office (an assistant never sets it). */
const payToBy = (by: Party): 'claimant' | 'office' => (by.as === 'claimant' ? 'claimant' : 'office');

export function createClaim(personId: number | null, input: ClaimInput, by: Party): Claim {
  const person = personId ? get<{ first_name: string; last_name: string | null; preferred_name: string | null; congregation_id: number | null }>('SELECT first_name, last_name, preferred_name, congregation_id FROM people WHERE id = ? AND erased_at IS NULL', personId) : null;
  if (personId && !person) throw new BadRequest('That member is not on the register.');
  if (!personId && by.as !== 'office') throw new BadRequest('A claim is made by a member.');
  // claims being prepared, per member: enough for anyone, not a way to fill the church's disk with receipts
  if (personId && by.as !== 'office' && get<{ n: number }>("SELECT COUNT(*) n FROM bk_claims WHERE person_id = ? AND status = 'draft'", personId)!.n >= MAX_DRAFTS) {
    throw new BadRequest(`You have ${MAX_DRAFTS} claims being prepared: submit or delete some first.`);
  }
  const claimant = person ? [person.preferred_name || person.first_name, person.last_name].filter(Boolean).join(' ') : by.name;
  const lines = cleanLines(input.lines ?? []);
  return tx(() => {
    const id = Number(run(
      `INSERT INTO bk_claims (person_id, claimant, purpose, ministry_id, project_id, fund_id, congregation_id, pay_to, pay_to_by, status, created_via, created_by)
       VALUES (?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`,
      personId, claimant, input.purpose?.trim() || null, input.ministry_id ?? null, input.project_id ?? null, input.fund_id ?? null,
      person?.congregation_id ?? null, input.pay_to?.trim() || null, input.pay_to?.trim() ? payToBy(by) : null,
      by.as === 'ai' ? 'mcp' : by.as === 'claimant' ? 'self' : 'web', by.name,
    ).lastInsertRowid);
    writeLines(id, lines);
    const c = getClaim(id);
    logClaim('create', null, c, by.as === 'ai' ? 'Drafted by an AI assistant' : undefined);
    return c;
  });
}

/** Change a claim being prepared (its claimant, the office, or the AI assistant that drafted it). */
export function updateClaim(id: number, input: ClaimInput, by_: Party): Claim {
  const before = getClaim(id);
  mayEdit(before, by_);
  const lines = cleanLines(input.lines ?? []);
  // where to repay keeps who typed it in, until someone else changes it
  const payTo = input.pay_to?.trim() || null;
  const by = payTo === (before.pay_to ?? null) ? before.pay_to_by : payTo ? payToBy(by_) : null;
  return tx(() => {
    run('UPDATE bk_claims SET purpose = ?, ministry_id = ?, project_id = ?, fund_id = ?, pay_to = ?, pay_to_by = ?, updated_at = datetime(\'now\'), revision = revision + 1 WHERE id = ?',
      input.purpose?.trim() || null, input.ministry_id ?? null, input.project_id ?? null, input.fund_id ?? null, payTo, by, id);
    writeLines(id, lines);
    const after = getClaim(id);
    logClaim('update', before, after);
    return after;
  });
}

/**
 * How each line is booked (account, fund, ministry, project), by the office: allowed until the claim's expense is
 * posted. It doesn't change what the claimant signed (dates, descriptions, amounts, receipts, where to repay).
 */
export function classifyClaim(id: number, input: { ministry_id?: number | null; project_id?: number | null; fund_id?: number | null; lines: { id: number; account_id?: number | null; fund_id?: number | null; ministry_id?: number | null; project_id?: number | null }[] }) {
  const before = getClaim(id);
  if (before.approval_journal_id && getJournal(before.approval_journal_id).status === 'posted') throw new Conflict('The claim’s expense is posted: correct it with a journal instead.');
  // a waiting claim moved to another ministry or project goes to its approvers: approvals given so far no longer count
  const rerouted = before.status === 'submitted' && ((input.ministry_id ?? null) !== before.ministry_id || (input.project_id ?? null) !== before.project_id);
  return tx(() => {
    run(`UPDATE bk_claims SET ministry_id = ?, project_id = ?, fund_id = ?, updated_at = datetime('now')${rerouted ? ', revision = revision + 1' : ''} WHERE id = ?`, input.ministry_id ?? null, input.project_id ?? null, input.fund_id ?? null, id);
    for (const l of input.lines) {
      run('UPDATE bk_claim_lines SET account_id = ?, fund_id = ?, ministry_id = ?, project_id = ? WHERE id = ? AND claim_id = ?', l.account_id ?? null, l.fund_id ?? null, l.ministry_id ?? null, l.project_id ?? null, l.id, id);
    }
    const after = getClaim(id);
    logClaim('update', before, after, rerouted ? 'How the claim is booked (another ministry or project: its approvals start again)' : 'How the claim is booked');
    // the draft expense follows
    if (after.approval_journal_id) draftExpense(after, after.approval_journal_id);
    return getClaim(id);
  });
}

export function deleteClaim(id: number, by: Party) {
  const c = getClaim(id);
  if (c.status !== 'draft' && c.status !== 'withdrawn' && !(by.as === 'office' && c.status === 'rejected')) throw new Conflict('Only a claim being prepared or withdrawn can be deleted.');
  if (by.as !== 'office' && !isOwn(c, by) && !(by.as === 'ai' && c.created_via === 'mcp')) throw new Forbidden('This is someone else’s claim.');
  tx(() => {
    for (const f of c.files) run('DELETE FROM assets WHERE key = ?', `claim-file-${f.id}`);
    run('DELETE FROM bk_claims WHERE id = ?', id);
    logClaim('delete', c, null);
  });
}

// ---------------------------------------------------------------- receipts

export function addClaimFile(id: number, f: { name: string; mime: string; data: Buffer; line_id?: number | null }, by: Party): Claim {
  const c = getClaim(id);
  mayEdit(c, by);
  const { name, mime } = checkUpload(f.mime, f.data, f.name);
  if (c.files.length >= 30) throw new BadRequest('At most 30 receipts in a claim.');
  if (f.line_id && !c.lines.some((l) => l.id === f.line_id)) throw new BadRequest('That line is not in this claim.');
  return tx(() => {
    const fid = Number(run('INSERT INTO bk_claim_files (claim_id, line_id, name, mime, size) VALUES (?,?,?,?,?)', id, f.line_id ?? null, name, mime, f.data.length).lastInsertRowid);
    run("INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))", `claim-file-${fid}`, mime, f.data);
    logChange({ entity: 'bk_claims', entity_id: id, action: 'update', summary: `Receipt added: ${name}` });
    return getClaim(id);
  });
}
export function setFileLine(fileId: number, lineId: number | null, by: Party): Claim {
  const f = get<{ claim_id: number }>('SELECT claim_id FROM bk_claim_files WHERE id = ?', fileId);
  if (!f) throw new NotFound('Receipt not found');
  const c = getClaim(f.claim_id);
  mayEdit(c, by);
  if (lineId && !c.lines.some((l) => l.id === lineId)) throw new BadRequest('That line is not in this claim.');
  run('UPDATE bk_claim_files SET line_id = ? WHERE id = ?', lineId, fileId);
  return getClaim(c.id);
}
export function removeClaimFile(fileId: number, by: Party): Claim {
  const f = get<{ claim_id: number; name: string }>('SELECT claim_id, name FROM bk_claim_files WHERE id = ?', fileId);
  if (!f) throw new NotFound('Receipt not found');
  const c = getClaim(f.claim_id);
  mayEdit(c, by);
  tx(() => {
    run('DELETE FROM assets WHERE key = ?', `claim-file-${fileId}`);
    run('DELETE FROM bk_claim_files WHERE id = ?', fileId);
    logChange({ entity: 'bk_claims', entity_id: c.id, action: 'update', summary: `Receipt removed: ${f.name}` });
  });
  return getClaim(c.id);
}
export function claimFileData(fileId: number) {
  const f = get<ClaimFile & { claim_id: number }>('SELECT * FROM bk_claim_files WHERE id = ?', fileId);
  if (!f) throw new NotFound('Receipt not found');
  const a = get<{ data: Uint8Array }>('SELECT data FROM assets WHERE key = ?', `claim-file-${fileId}`);
  if (!a) throw new NotFound('The file is missing.');
  return { file: f, data: Buffer.from(a.data) };
}

// ---------------------------------------------------------------- signing and submitting

/** A fingerprint of what the claimant signs: the lines as written, the receipts and where to repay. */
export function claimHash(c: Pick<Claim, 'lines' | 'files' | 'pay_to'>): string {
  const key = JSON.stringify({
    lines: c.lines.map((l) => [l.date, l.description, l.payee, l.amount]),
    files: c.files.map((f) => f.id).sort((a, b) => a - b),
    pay_to: c.pay_to ?? '',
  });
  return crypto.createHash('sha256').update(key).digest('base64url').slice(0, 16);
}

/** What still stops a claim from being submitted. */
export function submitProblems(c: Claim): string[] {
  const out: string[] = [];
  if (!c.lines.length) out.push('Add at least one line.');
  c.lines.forEach((l, i) => {
    if (!l.description) out.push(`Line ${i + 1}: say what it was for.`);
    if (!l.amount) out.push(`Line ${i + 1}: enter the amount.`);
    if (!l.date) out.push(`Line ${i + 1}: enter the date on the receipt.`);
  });
  if (!c.files.length) out.push('Attach the receipts (photos or PDFs).');
  if (!c.pay_to) out.push('Say where to repay you (e.g. your PayNow number or bank account).');
  return out;
}

const IMAGE = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/**
 * The claimant signs and submits (on screen; or the office records a claim signed on paper, its scan attached).
 * It gets its number, and the approvers who may decide it are told.
 */
export function submitClaim(id: number, s: { name?: string; image?: string; paper?: boolean }, by: Party): Claim {
  const c = getClaim(id);
  if (c.status !== 'draft') throw new Conflict('This claim has been submitted already.');
  if (by.as === 'ai') throw new Forbidden('The claimant signs and submits a claim; an AI assistant only prepares it.');
  if (s.paper) {
    if (by.as !== 'office') throw new Forbidden('Only the office records a claim signed on paper.');
  } else {
    if (!isOwn(c, by)) throw new Forbidden('Only the claimant signs their claim.');
    if (!s.image || !IMAGE.test(s.image) || s.image.length > 300_000) throw new BadRequest('Sign in the box first.');
  }
  const problems = submitProblems(c);
  if (problems.length) throw new BadRequest(problems.join(' '));
  const sig: ClaimSignature = {
    // signed on a phone: the claimant's own name from their member record, never a name the page sends
    name: s.paper ? c.claimant : (by.as === 'claimant' ? by.name : s.name?.trim() || by.name).slice(0, 120), image: s.paper ? '' : s.image!, signed_at: new Date().toISOString(),
    hash: claimHash(c), via: s.paper ? 'paper' : 'device', by: by.name,
  };
  const out = tx(() => {
    run(`UPDATE bk_claims SET status = 'submitted', number = COALESCE(number, ?), signature = ?, submitted_at = datetime('now'), note = NULL, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`,
      c.number ?? nextClaimNumber(), JSON.stringify(sig), id);
    const after = getClaim(id);
    logClaim('update', c, after, s.paper ? 'Submitted (signed on paper)' : 'Signed and submitted');
    return after;
  });
  void notifyApprovers(out);
  return out;
}

/** The year a claim submitted now is numbered in. */
export const claimYear = () => today().slice(0, 4);

/** The next claim number this year: C2026-0001 … C2026-9999, C2026-10000 (the highest as a number, as journals' are). */
export function nextClaimNumber(): string {
  const y = claimYear();
  // "C2026-10000" comes after "C2026-9999", which a text sort gets wrong: every submission after it collided
  const last = get<{ n: number | null }>('SELECT MAX(CAST(substr(number, ?) AS INTEGER)) AS n FROM bk_claims WHERE number LIKE ?', y.length + 3, `C${y}-%`)?.n;
  return `C${y}-${String((last ?? 0) + 1).padStart(4, '0')}`;
}

/** The claimant takes a claim back (before it is approved). */
export function withdrawClaim(id: number, by: Party): Claim {
  const c = getClaim(id);
  if (!isOwn(c, by) && by.as !== 'office') throw new Forbidden('Only the claimant withdraws a claim.');
  if (c.status !== 'draft' && c.status !== 'submitted') throw new Conflict('An approved or decided claim can’t be withdrawn.');
  run(`UPDATE bk_claims SET status = 'withdrawn', updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`, id);
  const after = getClaim(id);
  logClaim('update', c, after, 'Withdrawn');
  return after;
}

// ---------------------------------------------------------------- approvers and approving

/**
 * An approver signs in to approve claims with a code sent to the e-mail address on their member record, so changing
 * that address is for an administrator or someone who may change the books: otherwise whoever edits members could
 * point an approver's sign-in at themselves (0.18.0 review). True when this change must be refused.
 */
export function approverEmailLocked(personId: number, email: string | null | undefined): boolean {
  if (email === undefined) return false;
  const cur = get<{ email: string | null }>('SELECT email FROM people WHERE id = ?', personId);
  if (!cur || (cur.email ?? '').trim().toLowerCase() === (email ?? '').trim().toLowerCase()) return false;
  if (!get('SELECT 1 FROM bk_claim_approvers WHERE person_id = ? AND active = 1', personId)) return false;
  const a = currentActor();
  // Canon's own tasks, and a member changing their own details on their phone
  if (!a?.user_id) return false;
  const u = get<{ role: string }>('SELECT role FROM users WHERE id = ?', a.user_id);
  const r = u ? roleDef(u.role) : null;
  return !(r && (r.admin || r.access.bookkeeping === 'edit'));
}
export const APPROVER_EMAIL_LOCKED = 'This member approves expense claims and signs in with this e-mail address: an administrator or the treasurer changes it.';


export function listApprovers(): ClaimApprover[] {
  return all<{ id: number; person_id: number; first_name: string; last_name: string | null; preferred_name: string | null; email: string | null; ministry_ids: string | null; max_amount: number | null; active: number }>(
    `SELECT a.id, a.person_id, p.first_name, p.last_name, p.preferred_name, p.email, a.ministry_ids, a.max_amount, a.active
     FROM bk_claim_approvers a JOIN people p ON p.id = a.person_id WHERE p.erased_at IS NULL ORDER BY p.first_name, p.last_name`,
  ).map((r) => ({
    id: r.id, person_id: r.person_id, name: [r.preferred_name || r.first_name, r.last_name].filter(Boolean).join(' '), email: r.email,
    ministry_ids: r.ministry_ids ? (JSON.parse(r.ministry_ids) as number[]) : null, max_amount: r.max_amount, active: !!r.active,
  }));
}
export function saveApprover(id: number | null, input: { person_id: number; ministry_ids?: number[] | null; max_amount?: number | null; active?: boolean }) {
  if (!get('SELECT 1 FROM people WHERE id = ? AND erased_at IS NULL', input.person_id)) throw new BadRequest('That member is not on the register.');
  const mins = input.ministry_ids?.length ? JSON.stringify(input.ministry_ids) : null;
  const max = input.max_amount != null && input.max_amount > 0 ? Math.round(input.max_amount) : null;
  if (id) run('UPDATE bk_claim_approvers SET person_id = ?, ministry_ids = ?, max_amount = ?, active = ? WHERE id = ?', input.person_id, mins, max, input.active === false ? 0 : 1, id);
  else {
    if (get('SELECT 1 FROM bk_claim_approvers WHERE person_id = ?', input.person_id)) throw new Conflict('That member is an approver already.');
    id = Number(run('INSERT INTO bk_claim_approvers (person_id, ministry_ids, max_amount, active) VALUES (?,?,?,?)', input.person_id, mins, max, input.active === false ? 0 : 1).lastInsertRowid);
  }
  logChange({ entity: 'bk_claims', entity_id: null, action: 'update', summary: `Claim approver saved: ${listApprovers().find((a) => a.id === id)?.name ?? input.person_id}` });
  return listApprovers();
}
export function deleteApprover(id: number) {
  const a = listApprovers().find((x) => x.id === id);
  run('DELETE FROM bk_claim_approvers WHERE id = ?', id);
  logChange({ entity: 'bk_claims', entity_id: null, action: 'update', summary: `Claim approver removed: ${a?.name ?? id}` });
}

/** How many approvals the claim needs: two above the set amount, else one. */
export const approvalsNeeded = (c: Pick<Claim, 'total'>) => {
  const above = bkSettings().claims_two_above;
  return above != null && c.total > above ? 2 : 1;
};

/** May this person decide this claim: an active approver for its ministry and amount, and not its claimant. */
export function mayApprove(c: Claim, personId: number): boolean {
  if (c.person_id === personId) return false;
  const a = listApprovers().find((x) => x.person_id === personId && x.active);
  if (!a) return false;
  if (a.ministry_ids && !(c.ministry_id && a.ministry_ids.includes(c.ministry_id))) return false;
  if (a.max_amount != null && c.total > a.max_amount) return false;
  return true;
}
/** The approvers who may decide this claim. */
export const approversOf = (c: Claim) => listApprovers().filter((a) => a.active && mayApprove(c, a.person_id));

/**
 * The approvals that count: given for this submission (a claim sent back and submitted again, or moved to another
 * ministry while waiting, starts again) by people who may still approve it.
 */
export const currentApprovals = (c: Claim) => c.approvals.filter((a) => a.decision === 'approved' && a.round === c.revision && a.person_id != null && mayApprove(c, a.person_id));
/** This person has approved the claim as it is now. */
export const hasApproved = (c: Claim, personId: number) => c.approvals.some((a) => a.person_id === personId && a.decision === 'approved' && a.round === c.revision);

/** Claims waiting for this person's decision. */
export function toApprove(personId: number) {
  return listClaims({ status: 'submitted' }).map((r) => getClaim(r.id))
    .filter((c) => mayApprove(c, personId) && !hasApproved(c, personId));
}

/**
 * An approver decides: approve (signed on screen), send back to the claimant (a draft again, to change), or reject.
 * With the approvals it needs, the claim is approved and its expense drafted into the books.
 */
export function decideClaim(id: number, d: { decision: 'approved' | 'returned' | 'rejected'; note?: string | null; image?: string; via?: 'device' | 'account'; account_id?: number | null }, approver: { person_id: number; name: string }): Claim {
  const c = getClaim(id);
  if (c.status !== 'submitted') throw new Conflict('This claim is not waiting for approval.');
  if (c.person_id === approver.person_id) throw new Forbidden('Nobody approves their own claim.');
  if (!mayApprove(c, approver.person_id)) throw new Forbidden('You are not an approver for this claim (its ministry or amount).');
  if (d.decision === 'approved' && (!d.image || !IMAGE.test(d.image) || d.image.length > 300_000)) throw new BadRequest('Sign in the box first.');
  if (d.decision !== 'approved' && !d.note?.trim()) throw new BadRequest('Say why, for the claimant.');
  const hash = c.signature?.hash ?? claimHash(c);
  const out = tx(() => {
    if (d.decision === 'approved' && hasApproved(c, approver.person_id)) throw new Conflict('You have approved it already.');
    run('INSERT INTO bk_claim_approvals (claim_id, person_id, name, decision, note, image, hash, via, account_id, round) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, approver.person_id, approver.name, d.decision, d.note?.trim() || null, d.decision === 'approved' ? d.image! : null, hash, d.via ?? 'device', d.account_id ?? null, c.revision);
    if (d.decision === 'returned') {
      run(`UPDATE bk_claims SET status = 'draft', signature = NULL, note = ?, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`, d.note!.trim(), id);
    } else if (d.decision === 'rejected') {
      run(`UPDATE bk_claims SET status = 'rejected', note = ?, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`, d.note!.trim(), id);
    } else {
      const ok = new Set(currentApprovals(getClaim(id)).map((a) => a.person_id)).size;
      if (ok >= approvalsNeeded(c)) {
        run(`UPDATE bk_claims SET status = 'approved', approved_at = datetime('now'), updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`, id);
        const approved = getClaim(id);
        if (bkSettings().start_date) {
          const j = draftExpense(approved, null);
          run('UPDATE bk_claims SET approval_journal_id = ? WHERE id = ?', j.id, id);
        }
      }
    }
    const after = getClaim(id);
    logClaim('update', c, after, d.decision === 'approved' ? `Approved by ${approver.name}` : d.decision === 'returned' ? `Sent back by ${approver.name}: ${d.note}` : `Rejected by ${approver.name}: ${d.note}`);
    return after;
  });
  if (out.status !== 'submitted') void notifyClaimant(out);
  return out;
}

// ---------------------------------------------------------------- the books

const accountByCode = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ? AND active = 1', code)?.id ?? null;
const payableAccount = () => {
  const s = bkSettings();
  const id = s.claims_payable_account_id ?? accountByCode('2100') ?? get<{ id: number }>("SELECT id FROM bk_accounts WHERE type = 'liability' AND active = 1 ORDER BY code LIMIT 1")?.id;
  if (!id) throw new BadRequest('The chart needs a liability account for claims to repay (Book-keeping → Claims → Settings).');
  return id;
};
const defaultExpense = () => {
  const s = bkSettings();
  const id = s.claims_default_account_id ?? accountByCode('5990') ?? get<{ id: number }>("SELECT id FROM bk_accounts WHERE type = 'expense' AND active = 1 ORDER BY code DESC LIMIT 1")?.id;
  if (!id) throw new BadRequest('The chart needs an expense account for claims (Book-keeping → Claims → Settings).');
  return id;
};
const generalFund = () => get<{ id: number }>("SELECT id FROM bk_funds WHERE active = 1 ORDER BY restriction = 'unrestricted' DESC, sort, id LIMIT 1")?.id ?? null;

/** Dr each line's expense / Cr Claims to repay, by fund: drafted on approval (or brought up to date while a draft). */
function draftExpense(c: Claim, journalId: number | null) {
  if (journalId && getJournal(journalId).status === 'posted') return getJournal(journalId);
  const payable = payableAccount();
  const dflt = defaultExpense();
  const gen = generalFund();
  const lines: BkLine[] = [];
  const credit = new Map<number, number>();
  for (const l of c.lines) {
    const fund = l.fund_id ?? c.fund_id ?? gen;
    if (!fund) throw new BadRequest('The books need a fund first.');
    lines.push({ account_id: l.account_id ?? dflt, fund_id: fund, ministry_id: l.ministry_id ?? c.ministry_id, project_id: l.project_id ?? c.project_id, congregation_id: c.congregation_id, debit: l.amount, credit: 0, memo: [l.description, l.payee].filter(Boolean).join(' · ').slice(0, 500) });
    credit.set(fund, (credit.get(fund) ?? 0) + l.amount);
  }
  for (const [fund, amt] of credit) lines.push({ account_id: payable, fund_id: fund, congregation_id: c.congregation_id, debit: 0, credit: amt, memo: c.claimant });
  return saveDraft(journalId, { date: (c.approved_at ?? new Date().toISOString()).slice(0, 10), memo: `Claim ${c.number}: ${c.claimant}${c.purpose ? ` — ${c.purpose}` : ''}`, kind: 'claim', claim_id: c.id, lines },
    journalId ? 'Brought up to date with how the claim is booked' : 'Drafted from the approved claim');
}

/**
 * The claim is paid (by the treasurer, from a bank account): Dr Claims to repay / Cr bank, drafted (or posted now).
 * The bank line on the statement is then suggested for it. If one of its approvers pays it, that is marked.
 */
export function payClaim(id: number, input: { date?: string; bank_account_id: number; reference?: string | null; post: boolean }, payer: { name: string; person_id: number | null }): Claim {
  let c = getClaim(id);
  if (c.status !== 'approved') throw new Conflict('Only an approved claim is paid.');
  if (!bkSettings().start_date) throw new BadRequest('Start the books first.');
  if (payer.person_id && payer.person_id === c.person_id) throw new Forbidden('Someone else pays your own claim.');
  // the expense comes first (Dr expense / Cr Claims to repay): drafted now if it is missing (the claim was approved
  // before the books started, or its draft was deleted), and posted before the payment can be
  if (!c.approval_journal_id) {
    const j = draftExpense(c, null);
    run('UPDATE bk_claims SET approval_journal_id = ? WHERE id = ?', j.id, id);
    c = getClaim(id);
  }
  const expense = getJournal(c.approval_journal_id!);
  if (input.post && expense.status !== 'posted') throw new BadRequest(`Post the claim’s expense first (the draft dated ${expense.date}), then its payment.`);
  const bank = get<{ id: number; kind: string; type: string }>('SELECT id, kind, type FROM bk_accounts WHERE id = ? AND active = 1', input.bank_account_id);
  if (!bank || bank.type !== 'asset') throw new BadRequest('Choose the bank or cash account it was paid from.');
  const date = input.date && DATE.test(input.date) ? input.date : today();
  const byFund = new Map<number, number>();
  const gen = generalFund();
  for (const l of c.lines) {
    const fund = (l.fund_id ?? c.fund_id ?? gen)!;
    byFund.set(fund, (byFund.get(fund) ?? 0) + l.amount);
  }
  const payable = payableAccount();
  const lines: BkLine[] = [...byFund].map(([fund, amt]) => ({ account_id: payable, fund_id: fund, congregation_id: c.congregation_id, debit: amt, credit: 0, memo: c.claimant }));
  // one line on the bank, so the statement's single payment matches it
  lines.push({ account_id: bank.id, fund_id: [...byFund.keys()][0], congregation_id: c.congregation_id, debit: 0, credit: c.total, memo: input.reference?.trim() || c.claimant });
  const approverPaid = !!payer.person_id && c.approvals.some((a) => a.person_id === payer.person_id && a.decision === 'approved');
  return tx(() => {
    let j = saveDraft(null, { date, memo: `Claim ${c.number} paid: ${c.claimant}`, kind: 'claim', claim_id: c.id, lines }, 'Drafted when the claim was paid');
    if (input.post) {
      const problems = postingProblems(j);
      if (problems.length) throw new BadRequest(problems.join(' '));
      j = postJournal(j.id);
    }
    run(`UPDATE bk_claims SET status = 'paid', paid_on = ?, paid_by = ?, payment_ref = ?, payment_journal_id = ?, approver_paid = ?, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?`,
      date, payer.name, input.reference?.trim() || null, j.id, approverPaid ? 1 : 0, id);
    const after = getClaim(id);
    logClaim('update', c, after, `Paid by ${payer.name} on ${date}${approverPaid ? ' (an approver of this claim)' : ''}`);
    void notifyClaimant(after);
    return after;
  });
}

// ---------------------------------------------------------------- settings

export function saveClaimSettings(input: Pick<BookkeepingSettings, 'claims_self_service' | 'claims_two_above' | 'claims_payable_account_id' | 'claims_default_account_id'>) {
  for (const id of [input.claims_payable_account_id, input.claims_default_account_id]) if (id != null && !get('SELECT 1 FROM bk_accounts WHERE id = ?', id)) throw new BadRequest('That account doesn’t exist.');
  updateSettings({ bookkeeping: { ...bkSettings(), ...input, claims_two_above: input.claims_two_above != null && input.claims_two_above > 0 ? Math.round(input.claims_two_above) : null } });
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: 'Claim settings changed' });
  return bkSettings();
}

/** For the dashboard and the overview (behind the account's congregation wall, like the list). */
export function claimCounts() {
  const w = wallSql('c.congregation_id');
  const n = (sql: string) => get<{ n: number }>(sql + w.sql, ...w.params)!.n;
  return {
    to_approve: n("SELECT COUNT(*) n FROM bk_claims c WHERE c.status = 'submitted'"),
    to_pay: n("SELECT COUNT(*) n FROM bk_claims c WHERE c.status = 'approved'"),
    to_pay_total: n("SELECT COALESCE(SUM(l.amount),0) n FROM bk_claim_lines l JOIN bk_claims c ON c.id = l.claim_id WHERE c.status = 'approved'"),
  };
}

// ---------------------------------------------------------------- e-mails

/** The claim's page (on a phone: the claimant's or an approver's). */
export const claimLink = (id: number) => `${publicUrl() || addressForOthers('')}/self/claims/${id}`;

const WORDS = {
  approve_subject: 'Expense claim to approve: {number} ({claimant}, {amount})',
  approve_body: '{claimant} has submitted expense claim {number} for {amount}. Open it to look at the receipts and approve it, send it back or reject it:',
  approved_subject: 'Your expense claim {number} is approved',
  approved_body: 'Your expense claim {number} for {amount} has been approved. The treasurer will repay you.',
  returned_subject: 'Your expense claim {number} was sent back',
  returned_body: 'Your expense claim {number} was sent back to you: {note}. Change it and submit it again:',
  rejected_subject: 'Your expense claim {number} was not approved',
  rejected_body: 'Your expense claim {number} was not approved: {note}.',
  paid_subject: 'Your expense claim {number} has been paid',
  paid_body: 'Your expense claim {number} for {amount} was paid on {date}.',
};
type WordKey = keyof typeof WORDS;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

async function mail(personId: number | null, subjectKey: WordKey, bodyKey: WordKey, vars: Record<string, string>, link?: string) {
  if (!personId || !smtpConfigured()) return;
  const p = get<{ email: string | null; preferred_lang: string | null }>('SELECT email, preferred_lang FROM people WHERE id = ? AND erased_at IS NULL', personId);
  if (!p?.email) return;
  const langs = messageLangs(p.preferred_lang, getSettings().languages) as Lang[];
  const subject = [...new Set(langs.map((l) => fill(st(WORDS[subjectKey], l), vars)))].join(' / ');
  const text = langs.map((l) => `${fill(st(WORDS[bodyKey], l), vars)}${link ? `\n${link}` : ''}`).join('\n\n— — —\n\n');
  const html = wrapHtml(langs.map((l) => `<p>${esc(fill(st(WORDS[bodyKey], l), vars))}</p>${link ? `<p><a href="${esc(link)}">${esc(link)}</a></p>` : ''}`).join('<hr>'), langs[0]);
  try {
    await sendMail({ to: p.email, subject, text, html });
    logEmail({ person_id: personId, to_addr: p.email, subject, kind: 'claim', ok: true });
  } catch (e) {
    logEmail({ person_id: personId, to_addr: p.email, subject, kind: 'claim', ok: false, error: (e as Error).message });
  }
}
const money = (n: number) => `${getSettings().offering.currency} ${(n / 100).toFixed(2)}`;

async function notifyApprovers(c: Claim) {
  const vars = { number: c.number ?? '', claimant: c.claimant, amount: money(c.total) };
  for (const a of approversOf(c)) await mail(a.person_id, 'approve_subject', 'approve_body', vars, claimLink(c.id)).catch(() => undefined);
}
async function notifyClaimant(c: Claim) {
  const vars = { number: c.number ?? '', amount: money(c.total), note: c.note ?? '', date: c.paid_on ?? '' };
  const k = c.status === 'approved' ? 'approved' : c.status === 'draft' ? 'returned' : c.status === 'rejected' ? 'rejected' : c.status === 'paid' ? 'paid' : null;
  if (!k) return;
  await mail(c.person_id, `${k}_subject` as WordKey, `${k}_body` as WordKey, vars, k === 'returned' ? claimLink(c.id) : undefined).catch(() => undefined);
}

/** An account's member, for claims made or approved inside Canon. */
export const personOfUser = (userId: number) => get<{ person_id: number | null }>('SELECT person_id FROM users WHERE id = ?', userId)?.person_id ?? null;
export const actorName = () => currentActor()?.user_name ?? 'Canon';
