// Lending library self-service (0.15): members borrow, renew and say they've returned books on their own phones,
// without a Canon account. They sign in with a 6-digit code e-mailed to the address on the member register; a renewal
// link in each reminder e-mail renews in one tap. A returned book waits for the librarian to check it in.
//
// Gates: self-service only runs while every gate passes — e-mail works (a test e-mail succeeded with the current
// settings and nothing has failed since), the public https address reaches this very Canon, the library is on and its
// rules were saved. A gate that breaks pauses it (phones are told to see the librarian); fixing it resumes it.
import { st } from '../lib/server-text.ts';
import crypto from 'node:crypto';
import type { Lang } from '../../shared/types.ts';
import { all, get, run } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { publicUrl } from '../lib/public-url.ts';
import { pingAnswer, signToken, verifyToken, hmac } from '../lib/instance.ts';
import { sendMail, smtpHealth } from '../lib/mailer.ts';
import { getSettings } from './settings.ts';
import { esc, logEmail, messageLangs, wrapHtml } from './email.ts';
import * as L from './lending.ts';

// ---------------------------------------------------------------- gates

export type GateKey = 'email' | 'public_address' | 'library';
export interface Gate { key: GateKey; ok: boolean; problem?: string; detail?: string }

let ping: { url: string; ok: boolean; error: string | null; at: number } | null = null;
const PING_FRESH_MS = 10 * 60_000;

/** Call this Canon through the public address: only this Canon can answer the nonce. */
export async function checkPublicAddress(force = false): Promise<NonNullable<typeof ping>> {
  const url = publicUrl();
  if (!force && ping && ping.url === url && Date.now() - ping.at < PING_FRESH_MS) return ping;
  let ok = false;
  let error: string | null = null;
  if (!url) error = 'none';
  else if (!url.startsWith('https://')) error = 'http';
  else {
    const nonce = crypto.randomBytes(16).toString('base64url');
    try {
      const r = await fetch(`${url}/api/self/ping?n=${nonce}`, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      const body = (await r.json().catch(() => ({}))) as { sig?: string };
      ok = r.ok && body.sig === pingAnswer(nonce);
      if (!ok) error = r.ok ? 'other' : `http ${r.status}`;
    } catch (e) {
      error = (e as Error).message || 'unreachable';
    }
  }
  ping = { url, ok, error, at: Date.now() };
  return ping;
}
export const resetPing = () => {
  ping = null;
};

/** The gates as they stand (the public address as last checked). */
export function gates(): Gate[] {
  const s = getSettings();
  const mail = smtpHealth();
  const url = publicUrl();
  const p = ping && ping.url === url ? ping : null;
  return [
    mail.failing
      ? { key: 'email', ok: false, problem: 'failing', detail: mail.failing.error }
      : mail.tested ? { key: 'email', ok: true } : { key: 'email', ok: false, problem: 'not_tested' },
    !url ? { key: 'public_address', ok: false, problem: 'none' }
      : !url.startsWith('https://') ? { key: 'public_address', ok: false, problem: 'http', detail: url }
        : p?.ok ? { key: 'public_address', ok: true, detail: url }
          : p ? { key: 'public_address', ok: false, problem: 'unreachable', detail: `${url} — ${p.error}` }
            : { key: 'public_address', ok: false, problem: 'unchecked', detail: url },
    s.modules.lending === false ? { key: 'library', ok: false, problem: 'off' }
      : !s.lending.rules_saved ? { key: 'library', ok: false, problem: 'rules' } : { key: 'library', ok: true },
  ];
}

/** Self-service is running: switched on, and every gate passes. */
export const selfServiceOn = () => getSettings().lending.self_service && gates().every((g) => g.ok);

/** The status for the librarian: wanted, running, and each gate (the public address checked again if stale). */
export async function selfServiceStatus(force = false) {
  await checkPublicAddress(force);
  const g = gates();
  const wanted = getSettings().lending.self_service;
  return { wanted, on: wanted && g.every((x) => x.ok), gates: g };
}

/** Public routes: make sure the public-address check is recent before deciding. */
export async function selfServiceReady() {
  if (!getSettings().lending.self_service) return false;
  if (!ping || Date.now() - ping.at >= PING_FRESH_MS || ping.url !== publicUrl()) await checkPublicAddress();
  return selfServiceOn();
}

// ---------------------------------------------------------------- signing in with an e-mailed code

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const SESSION_HOURS = 2;
const codeHash = (personId: number, code: string) => hmac(`selfcode:${personId}:${code}`, 43);

interface Who { id: number; first_name: string; preferred_name: string | null; native_name: string | null; preferred_lang: string | null; email: string }
/** The one member with this e-mail address (none when nobody or several people share it). */
function personByEmail(email: string): Who | null {
  const rows = all<Who>("SELECT id, first_name, preferred_name, native_name, preferred_lang, email FROM people WHERE erased_at IS NULL AND lower(trim(email)) = ?", email.trim().toLowerCase());
  return rows.length === 1 ? rows[0] : null;
}

// the English wording; other languages are in locales/<code>/server.json (server/lib/server-text.ts)
const CODE_WORDS_EN = { subject: 'Your code for the church library: {code}', body: 'Your code for the church library is {code}. It works for 10 minutes.', ignore: 'If you didn\'t ask for it, you can ignore this e-mail.' };
const codeWords = (l: Lang) => Object.fromEntries(Object.entries(CODE_WORDS_EN).map(([k, v]) => [k, st(v, l)])) as typeof CODE_WORDS_EN;

/** E-mail a code to the member with this address. Says nothing about whether the address is on the register. */
export async function requestCode(email: string): Promise<void> {
  const p = personByEmail(email);
  if (!p) return;
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + CODE_MINUTES * 60_000).toISOString();
  run('UPDATE lending_self_codes SET used_at = ? WHERE person_id = ? AND used_at IS NULL', new Date().toISOString(), p.id);
  run('INSERT INTO lending_self_codes (person_id, code_hash, expires_at) VALUES (?, ?, ?)', p.id, codeHash(p.id, code), expires);
  const langs = messageLangs(p.preferred_lang, getSettings().languages);
  const subject = [...new Set(langs.map((l) => codeWords(l).subject.replace('{code}', code)))].join(' / ');
  const text = langs.map((l) => `${codeWords(l).body.replace('{code}', code)}\n\n${codeWords(l).ignore}`).join('\n\n— — —\n\n');
  const html = wrapHtml(langs.map((l) => `<p>${esc(codeWords(l).body.replace('{code}', code))}</p><p style="font-size:28px;letter-spacing:6px;font-weight:700">${code}</p><p style="color:#666">${esc(codeWords(l).ignore)}</p>`).join('<hr>'), langs[0]);
  try {
    await sendMail({ to: p.email, subject, text, html });
    logEmail({ person_id: p.id, to_addr: p.email, subject: subject.replace(code, '••••••'), kind: 'library_code', ok: true });
  } catch (e) {
    logEmail({ person_id: p.id, to_addr: p.email, subject: subject.replace(code, '••••••'), kind: 'library_code', ok: false, error: (e as Error).message });
  }
}

/** Check a code; a right one gives a sign-in token for a couple of hours. */
export function verifyCode(email: string, code: string): { token: string; name: string } {
  const p = personByEmail(email);
  const wrong = new BadRequest('That code is not right, or it has expired. Ask for a new one.');
  if (!p) throw wrong;
  const row = get<{ id: number; code_hash: string; expires_at: string; attempts: number }>(
    'SELECT id, code_hash, expires_at, attempts FROM lending_self_codes WHERE person_id = ? AND used_at IS NULL ORDER BY id DESC LIMIT 1', p.id,
  );
  if (!row || row.expires_at < new Date().toISOString() || row.attempts >= MAX_ATTEMPTS) throw wrong;
  run('UPDATE lending_self_codes SET attempts = attempts + 1 WHERE id = ?', row.id);
  const given = codeHash(p.id, code.replace(/\D/g, ''));
  if (given.length !== row.code_hash.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(row.code_hash))) throw wrong;
  run('UPDATE lending_self_codes SET used_at = ? WHERE id = ?', new Date().toISOString(), row.id);
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  return { token: signToken('self', `${p.id}.${exp}`), name: (p.preferred_name || p.first_name).trim() };
}

/** The member a sign-in token is for (throws when it is wrong or old). */
export function personOf(token: string | undefined): number {
  const payload = token ? verifyToken('self', token) : null;
  const [id, exp] = (payload ?? '').split('.').map(Number);
  if (!id || !exp || exp * 1000 < Date.now()) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  const p = get<{ erased_at: string | null }>('SELECT erased_at FROM people WHERE id = ?', id);
  if (!p || p.erased_at) throw Object.assign(new Error('Please sign in again.'), { status: 401 });
  return id;
}

/** Old codes go (they are useless after 10 minutes). */
export const pruneCodes = () => Number(run("DELETE FROM lending_self_codes WHERE created_at < datetime('now', '-1 day')").changes);

// ---------------------------------------------------------------- what members do

/** A copy as a phone sees it: the book and whether it can be borrowed — never who has it. */
export function publicCopy(scanned: string) {
  const f = L.findCopy(scanned);
  const status = f.copy.status !== 'in' ? 'unavailable' : !f.loan ? 'available' : f.loan.return_pending_on ? 'returned' : 'out';
  return {
    number: f.copy.number, book_id: f.book.id, title: f.book.title, authors: f.book.authors, kind: f.book.kind, shelf: f.book.shelf,
    has_cover: f.book.has_cover, updated_at: f.book.updated_at, status, due_on: status === 'out' ? f.loan!.due_on : null,
    loan_days: getSettings().lending.loan_days,
  };
}

export function myLoans(personId: number) {
  const max = getSettings().lending.max_renewals;
  return L.listLoans({ status: 'open', person_id: personId, limit: 100 }).map((l) => ({
    id: l.id, number: l.number, title: l.title, due_on: l.due_on, overdue_days: l.overdue_days, renewals: l.renewals,
    can_renew: l.renewals < max && !l.return_pending_on, returned: !!l.return_pending_on,
  }));
}

export function borrow(personId: number, scanned: string) {
  const f = L.findCopy(scanned);
  return L.lend({ copy_id: f.copy.id, person_id: personId }, null, 'self');
}

export function renewMine(personId: number, loanId: number) {
  const l = L.loans.get(loanId);
  if (l.person_id !== personId) throw new NotFound('Not found');
  if (l.return_pending_on) throw new BadRequest('You said this is back already.');
  return L.renewLoan(loanId);
}

/** "I've put it back": the loan waits for the librarian to check the copy in (anyone holding it may say so). */
export function markReturned(scanned: string) {
  const f = L.findCopy(scanned);
  if (!f.loan) throw new BadRequest('This copy is not on loan.');
  if (!f.loan.return_pending_on) L.loans.update(f.loan.id, { return_pending_on: L.localToday() });
  return { ok: true };
}

// ---------------------------------------------------------------- renewal links in e-mails

export const renewToken = (loan: { id: number; lent_on: string }) => signToken('renew', `${loan.id}.${loan.lent_on}`);

/** The renewal link for a loan's e-mail, while self-service is running (else null). */
export function renewUrl(loan: { id: number; lent_on: string }): string | null {
  return selfServiceOn() ? `${publicUrl()}/self/renew/${renewToken(loan)}` : null;
}

function loanOfLink(token: string) {
  const payload = verifyToken('renew', token);
  const [id] = (payload ?? '').split('.');
  const loan = payload ? L.loans.find(Number(id)) : undefined;
  if (!loan || `${loan.id}.${loan.lent_on}` !== payload || loan.returned_on) throw new NotFound('This link is no longer valid: the book may be back already. Ask the librarian.');
  return loan;
}

export function linkInfo(token: string) {
  const loan = loanOfLink(token);
  const c = get<{ number: string; title: string }>('SELECT c.number, b.title FROM lending_copies c JOIN lending_books b ON b.id = c.book_id WHERE c.id = ?', loan.copy_id)!;
  return { ...c, due_on: loan.due_on, renewals: loan.renewals, can_renew: loan.renewals < getSettings().lending.max_renewals && !loan.return_pending_on };
}

export function renewByLink(token: string) {
  const loan = loanOfLink(token);
  return L.renewLoan(loan.id);
}

/** For the security checklist. */
export function selfServiceWeek() {
  return {
    codes: get<{ n: number }>("SELECT COUNT(*) n FROM email_log WHERE kind = 'library_code' AND at >= datetime('now', '-7 days')")!.n,
    self_loans: get<{ n: number }>("SELECT COUNT(*) n FROM lending_loans WHERE via = 'self' AND created_at >= datetime('now', '-7 days')")!.n,
  };
}
