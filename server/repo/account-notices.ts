// Notices to an account about its own sign-in (0.19.9): two-step sign-in turned on or off, reset by an administrator,
// new recovery codes, a recovery code used. Shown in Canon (above every page, until read) and e-mailed to the member
// the account belongs to when e-mail is set up — so someone who didn't do it hears of it.
import type { Lang } from '../../shared/types.ts';
import { all, get, run } from '../db.ts';
import { st } from '../lib/server-text.ts';
import { sendMail, smtpConfigured } from '../lib/mailer.ts';
import { config } from '../config.ts';
import { getSettings } from './settings.ts';
import { esc, logEmail, messageLangs, wrapHtml } from './email.ts';

export type NoticeKind = 'two_step_on' | 'two_step_off' | 'two_step_reset' | 'recovery_codes_new' | 'recovery_code_used';
export interface NoticeDetail {
  /** the address it came from */
  ip?: string | null;
  /** recovery codes left */
  left?: number;
  /** the administrator who did it */
  by?: string | null;
}
export interface Notice { id: number; kind: NoticeKind; detail: NoticeDetail; created_at: string }

// the English wording; other languages are in locales/<code>/server.json (server/lib/server-text.ts)
const SUBJECT: Record<NoticeKind, string> = {
  two_step_on: 'Two-step sign-in was turned on for your Canon account',
  two_step_off: 'Two-step sign-in was turned off for your Canon account',
  two_step_reset: 'An administrator reset two-step sign-in for your Canon account',
  recovery_codes_new: 'New recovery codes were made for your Canon account',
  recovery_code_used: 'A recovery code was used to sign in to your Canon account',
};
const WORDS = {
  hello: 'Hello {name},',
  when: 'When: {when}',
  from: 'From the address: {ip}',
  by: 'By: {by}',
  left: '{n} recovery codes are left. Make new ones in Settings → My profile when they run low.',
  notYou: 'If this wasn’t you, change your password in Canon (Settings → My profile) and tell your church’s administrator at once.',
  you: 'If it was you, there is nothing more to do.',
};

/** Tell an account: a notice in Canon (unless it did this itself, here and now) and an e-mail when that is possible. */
export function notifyAccount(userId: number, kind: NoticeKind, detail: NoticeDetail = {}, opts: { inApp?: boolean } = {}) {
  if (opts.inApp !== false) run('INSERT INTO account_notices (user_id, kind, detail) VALUES (?,?,?)', userId, kind, JSON.stringify(detail));
  // the e-mail goes out after the answer: a slow mail server doesn't hold up signing in
  setImmediate(() => {
    emailNotice(userId, kind, detail).catch((e) => console.error(`Notice e-mail (${kind}) failed:`, (e as Error).message));
  });
}

/** Unread notices, newest first. */
export const unreadNotices = (userId: number): Notice[] =>
  all<{ id: number; kind: NoticeKind; detail: string; created_at: string }>(
    'SELECT id, kind, detail, created_at FROM account_notices WHERE user_id = ? AND seen_at IS NULL ORDER BY id DESC LIMIT 20', userId,
  ).map((n) => ({ ...n, detail: JSON.parse(n.detail || '{}') as NoticeDetail }));

/** Mark notices read (all of the account's, without ids). */
export function markNoticesSeen(userId: number, ids?: number[]) {
  const now = new Date().toISOString();
  if (!ids) run('UPDATE account_notices SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL', now, userId);
  else for (const id of ids) run('UPDATE account_notices SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL', now, id, userId);
}

async function emailNotice(userId: number, kind: NoticeKind, d: NoticeDetail) {
  if (config.testCopy || !smtpConfigured()) return;
  const who = get<{ display_name: string; lang: string; person_id: number | null; email: string | null; preferred_lang: string | null }>(
    `SELECT u.display_name, u.lang, u.person_id, p.email, p.preferred_lang FROM users u LEFT JOIN people p ON p.id = u.person_id AND p.erased_at IS NULL WHERE u.id = ?`, userId,
  );
  const to = who?.email?.trim();
  if (!who || !to) return;
  const langs = messageLangs(who.lang || who.preferred_lang, getSettings().languages);
  const when = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const lines = (l: Lang) => {
    const w = (k: keyof typeof WORDS) => st(WORDS[k], l);
    return [
      w('hello').replace('{name}', who.display_name),
      st(SUBJECT[kind], l) + '.',
      [w('when').replace('{when}', when), d.ip ? w('from').replace('{ip}', d.ip) : '', d.by ? w('by').replace('{by}', d.by) : ''].filter(Boolean).join('\n'),
      kind === 'recovery_code_used' && d.left !== undefined ? w('left').replace('{n}', String(d.left)) : '',
      w('notYou'),
      kind === 'two_step_reset' || kind === 'recovery_code_used' ? '' : w('you'),
    ].filter(Boolean);
  };
  const subject = [...new Set(langs.map((l) => st(SUBJECT[kind], l)))].join(' / ');
  const text = langs.map((l) => lines(l).join('\n\n')).join('\n\n— — —\n\n');
  const html = wrapHtml(langs.map((l) => lines(l).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')).join('<hr>'), langs[0]);
  try {
    await sendMail({ to, subject, text, html });
    logEmail({ user_id: userId, person_id: who.person_id, to_addr: to, subject, kind: `account_${kind}`, ok: true });
  } catch (e) {
    logEmail({ user_id: userId, person_id: who.person_id, to_addr: to, subject, kind: `account_${kind}`, ok: false, error: (e as Error).message });
  }
}
