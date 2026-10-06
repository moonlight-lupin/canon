// Lending library reminders (0.15): e-mail a borrower a few days before a loan is due ("due soon", once) and when it
// is overdue (then once a week). Sent each day with Canon's daily housekeeping when the library is switched on, its
// rules say so and e-mail is set up; the librarian can also send them now. One message per borrower and kind, in
// their language; logged in the e-mail log.
import type { L10n, Lang } from '../../shared/types.ts';
import { all, run } from '../db.ts';
import { pick, toTraditional } from '../lib/chinese.ts';
import { isFatal, mapMailError, sendMail, smtpConfigured } from '../lib/mailer.ts';
import { getSettings } from './settings.ts';
import { esc, logEmail, messageLangs, wrapHtml } from './email.ts';
import { addDays, localToday } from './lending.ts';

type Kind = 'loan_due' | 'loan_overdue';

interface Words { due_subject: string; overdue_subject: string; greeting: string; due_intro: string; overdue_intro: string; due: string; renew: string; signoff: string }
const WORDS: Record<string, Words> = {
  en: {
    due_subject: 'Library reminder: due back on {date}',
    overdue_subject: 'Library reminder: overdue since {date}',
    greeting: 'Dear {name},',
    due_intro: 'This is a reminder that what you borrowed from the church library is due back soon:',
    overdue_intro: 'What you borrowed from the church library is now overdue. Please bring it back as soon as you can:',
    due: 'due {date}',
    renew: 'If you need it for longer, ask the librarian to renew it.',
    signoff: 'Thank you,',
  },
  zh: {
    due_subject: '图书馆提醒：请于 {date} 前归还',
    overdue_subject: '图书馆提醒：已于 {date} 逾期',
    greeting: '{name} 平安！',
    due_intro: '提醒您，您向教会图书馆借阅的物品即将到期：',
    overdue_intro: '您向教会图书馆借阅的物品已经逾期，请尽快归还：',
    due: '{date} 到期',
    renew: '如需延长借期，请联络图书管理员续借。',
    signoff: '谢谢！',
  },
  ms: {
    due_subject: 'Peringatan perpustakaan: perlu dipulangkan pada {date}',
    overdue_subject: 'Peringatan perpustakaan: lewat sejak {date}',
    greeting: '{name} yang dikasihi,',
    due_intro: 'Ini peringatan bahawa barang yang anda pinjam dari perpustakaan gereja perlu dipulangkan tidak lama lagi:',
    overdue_intro: 'Barang yang anda pinjam dari perpustakaan gereja sudah lewat. Sila pulangkan secepat mungkin:',
    due: 'perlu dipulangkan {date}',
    renew: 'Jika anda perlukannya lebih lama, minta pustakawan untuk melanjutkannya.',
    signoff: 'Terima kasih,',
  },
};
const words = (lang: Lang): Words => (lang === 'zh-Hant'
  ? Object.fromEntries(Object.entries(WORDS.zh).map(([k, v]) => [k, toTraditional(v)])) as unknown as Words
  : WORDS[lang] ?? WORDS.en);

interface Due {
  loan_id: number;
  person_id: number;
  email: string;
  first_name: string;
  preferred_name: string | null;
  native_name: string | null;
  preferred_lang: string | null;
  title: string;
  number: string;
  due_on: string;
}

/** The loans whose reminders are due today: due soon (not yet reminded) and overdue (not reminded this week). */
export function dueReminders(today = localToday()) {
  const rules = getSettings().lending;
  const soon = addDays(today, rules.remind_days_before);
  const weekAgo = addDays(today, -7);
  const sql = (extra: string) => `
    SELECT l.id AS loan_id, p.id AS person_id, p.email, p.first_name, p.preferred_name, p.native_name, p.preferred_lang, b.title, c.number, l.due_on
    FROM lending_loans l JOIN lending_copies c ON c.id = l.copy_id JOIN lending_books b ON b.id = c.book_id JOIN people p ON p.id = l.person_id
    WHERE l.returned_on IS NULL AND p.erased_at IS NULL AND p.email IS NOT NULL AND p.email <> '' AND ${extra}
    ORDER BY p.id, l.due_on`;
  return {
    due: rules.remind_days_before > 0 ? all<Due>(sql('l.due_on >= ? AND l.due_on <= ? AND l.reminded_on IS NULL'), today, soon) : [],
    overdue: all<Due>(sql('l.due_on < ? AND (l.overdue_reminded_on IS NULL OR l.overdue_reminded_on <= ?)'), today, weekAgo),
  };
}

const greet = (d: Due, lang: Lang) => (lang.startsWith('zh') && d.native_name?.trim() ? d.native_name.trim() : (d.preferred_name || d.first_name).trim());

function render(kind: Kind, list: Due[], langs: Lang[], church: L10n) {
  const subjects: string[] = [];
  const texts: string[] = [];
  const htmls: string[] = [];
  const first = list[0];
  for (const lang of langs) {
    const w = words(lang);
    const date = kind === 'loan_due' ? list[0].due_on : list.map((x) => x.due_on).sort()[0];
    subjects.push((kind === 'loan_due' ? w.due_subject : w.overdue_subject).replace('{date}', date));
    const lines = list.map((x) => `${x.title} (${x.number}) — ${w.due.replace('{date}', x.due_on)}`);
    const name = pick(church, lang) || '';
    const intro = kind === 'loan_due' ? w.due_intro : w.overdue_intro;
    texts.push([w.greeting.replace('{name}', greet(first, lang)), '', intro, ...lines.map((l) => `• ${l}`), '', w.renew, '', w.signoff, name].join('\n'));
    htmls.push(`<p>${esc(w.greeting.replace('{name}', greet(first, lang)))}</p><p>${esc(intro)}</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`
      + `<p>${esc(w.renew)}</p><p>${esc(w.signoff)}<br>${esc(name)}</p>`);
  }
  return {
    subject: [...new Set(subjects)].join(' / '),
    text: texts.join('\n\n— — —\n\n'),
    html: wrapHtml(htmls.join('<hr style="border:0;border-top:1px solid #A8893C;margin:26px 0">'), langs[0]),
  };
}

export interface ReminderResult { sent: number; failed: number; skipped_no_email: number; errors: string[] }

/** Send today's reminders (each borrower once per kind). Stops at the first error that would fail them all. */
export async function sendLoanReminders(opts: { today?: string; userId?: number | null } = {}): Promise<ReminderResult> {
  const out: ReminderResult = { sent: 0, failed: 0, skipped_no_email: 0, errors: [] };
  if (!smtpConfigured()) throw Object.assign(new Error('E-mail is not set up yet (Settings → E-mail).'), { status: 400 });
  const today = opts.today ?? localToday();
  const s = getSettings();
  const { due, overdue } = dueReminders(today);
  out.skipped_no_email = all<{ n: number }>(
    `SELECT COUNT(DISTINCT l.person_id) n FROM lending_loans l JOIN people p ON p.id = l.person_id
     WHERE l.returned_on IS NULL AND l.due_on < ? AND (p.email IS NULL OR p.email = '')`, today)[0].n;
  const batches: [Kind, Due[]][] = [];
  for (const [kind, list] of [['loan_due', due], ['loan_overdue', overdue]] as [Kind, Due[]][]) {
    const byPerson = new Map<number, Due[]>();
    for (const d of list) byPerson.set(d.person_id, [...(byPerson.get(d.person_id) ?? []), d]);
    for (const l of byPerson.values()) batches.push([kind, l]);
  }
  for (const [kind, list] of batches) {
    const p = list[0];
    const langs = messageLangs(p.preferred_lang, s.languages);
    const msg = render(kind, list, langs, s.church_name);
    try {
      await sendMail({ to: p.email, subject: msg.subject, text: msg.text, html: msg.html });
      logEmail({ user_id: opts.userId ?? null, person_id: p.person_id, to_addr: p.email, subject: msg.subject, kind, ok: true });
      const col = kind === 'loan_due' ? 'reminded_on' : 'overdue_reminded_on';
      for (const d of list) run(`UPDATE lending_loans SET ${col} = ? WHERE id = ?`, today, d.loan_id);
      out.sent++;
    } catch (e) {
      const err = mapMailError(e);
      logEmail({ user_id: opts.userId ?? null, person_id: p.person_id, to_addr: p.email, subject: msg.subject, kind, ok: false, error: err.message });
      out.failed++;
      out.errors.push(err.message);
      if (isFatal(err.code)) break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return out;
}

/** Canon's daily housekeeping: when the library is on, its rules send reminders and e-mail is set up. */
export async function dailyLoanReminders() {
  const s = getSettings();
  if (s.modules.lending === false || !s.lending.send_reminders || !smtpConfigured()) return null;
  return sendLoanReminders();
}

