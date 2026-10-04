// Volunteer reminder e-mails (sent manually by an editor for one service), test e-mails and the e-mail log.
// PDPA: addresses go only to the SMTP server; the log keeps who/when/subject/result, never the message body.
import type { L10n, Lang } from '../../shared/types.ts';
import { isChinese, langInfo } from '../../shared/languages.ts';
import { all, get, run } from '../db.ts';
import { NotFound } from '../lib/table.ts';
import { pick, toTraditional } from '../lib/chinese.ts';
import { MailError, isFatal, mapMailError, sendMail, smtpConfigured } from '../lib/mailer.ts';
import { getSettings } from './settings.ts';
import { services, items as serviceItems, itemTimes } from './services.ts';
import { songs } from './library.ts';

// ---------------------------------------------------------------- message wording

interface Words {
  subject: string; // {title} {date}
  greeting: string; // {name}
  intro: string;
  role: string;
  roles: string;
  items: string;
  note: string;
  share: string;
  closing: string;
  signoff: string;
  test_subject: string;
  test_body: string;
  /** label punctuation, e.g. ': ' or '：' */
  colon: string;
  /** between the date and the time */
  at: string;
}

const WORDS: Record<string, Words> = {
  en: {
    subject: 'Serving reminder: {title}, {date}',
    greeting: 'Dear {name},',
    intro: 'Thank you for serving. This is a reminder that you are on the rota for:',
    role: 'Your role',
    roles: 'Your roles',
    items: 'Items you lead',
    note: 'Please arrive 30 minutes early.',
    share: 'Order of service',
    closing: 'If you are no longer able to serve, please let us know as soon as possible.',
    signoff: 'Grace and peace,',
    test_subject: 'Canon test e-mail',
    test_body: 'This is a test message from Canon. If you can read it, e-mail is set up correctly.',
    colon: ': ',
    at: ', ',
  },
  zh: {
    subject: '服事提醒：{title}（{date}）',
    greeting: '{name} 平安！',
    intro: '感谢您的摆上。提醒您已被安排在以下崇拜中服事：',
    role: '您的岗位',
    roles: '您的岗位',
    items: '您负责的程序',
    note: '请提早 30 分钟到达。',
    share: '崇拜程序',
    closing: '如果您无法服事，请尽早通知我们。',
    signoff: '主内平安，',
    test_subject: 'Canon 测试邮件',
    test_body: '这是 Canon 发出的测试邮件。若您能读到这封邮件，表示电邮设定正确。',
    colon: '：',
    at: ' ',
  },
  ms: {
    subject: 'Peringatan pelayanan: {title}, {date}',
    greeting: '{name} yang dikasihi,',
    intro: 'Terima kasih kerana melayani. Ini peringatan bahawa anda dijadualkan untuk:',
    role: 'Peranan anda',
    roles: 'Peranan anda',
    items: 'Bahagian yang anda pimpin',
    note: 'Sila tiba 30 minit lebih awal.',
    share: 'Aturan kebaktian',
    closing: 'Jika anda tidak dapat melayani lagi, sila maklumkan kepada kami secepat mungkin.',
    signoff: 'Kasih karunia dan damai sejahtera,',
    test_subject: 'E-mel ujian Canon',
    test_body: 'Ini ialah mesej ujian daripada Canon. Jika anda dapat membacanya, e-mel telah disediakan dengan betul.',
    colon: ': ',
    at: ', ',
  },
};

function words(lang: Lang): Words {
  if (lang === 'zh-Hant') return Object.fromEntries(Object.entries(WORDS.zh).map(([k, v]) => [k, toTraditional(v)])) as unknown as Words;
  return WORDS[lang] ?? WORDS.en;
}

/** Default arrival note per church language (shown in the dialog as the placeholder). */
export function defaultNotes(): L10n {
  return Object.fromEntries(getSettings().languages.map((l) => [l, words(l).note]));
}

const GENERIC_TITLE: L10n = { en: 'Worship service', zh: '主日崇拜', ms: 'Kebaktian' };

/** A value in `lang`, else English, else anything. */
function pickAny(v: L10n | null | undefined, lang: Lang): string {
  return pick(v, lang) ?? pick(v, 'en') ?? Object.values(v ?? {}).find((x) => x?.trim()) ?? '';
}

function locale(lang: Lang) {
  return lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : lang === 'en' ? 'en-GB' : langInfo(lang).htmlLang;
}
function fmtDate(date: string, lang: Lang, long = true) {
  const d = new Date(`${date}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
    : { day: 'numeric', month: 'short', timeZone: 'UTC' };
  try {
    return d.toLocaleDateString(locale(lang), opts);
  } catch {
    return date;
  }
}

const fill = (s: string, vars: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------------------------------------------------------------- recipients

interface PersonRow {
  person_id: number;
  role_id: number;
  status: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  native_name: string | null;
  email: string | null;
  preferred_lang: string | null;
  role_name: string;
  team_name: string;
}

export interface ReminderRole { role_id: number; name: L10n; team: L10n; status: string }
export interface ReminderItem { id: number; title: L10n; start: string; end: string }

export interface ReminderRecipient {
  person_id: number;
  name: string;
  has_email: boolean;
  preferred_lang: string | null;
  /** languages the message is written in, in order */
  langs: Lang[];
  roles: ReminderRole[];
  items: ReminderItem[];
  subject: string;
  text: string;
  html: string;
  last_sent: { at: string; ok: boolean; error: string | null } | null;
}

/** Languages a person's message is written in. */
export function messageLangs(preferred: string | null | undefined, church: Lang[]): Lang[] {
  const primary = church[0] ?? 'en';
  if (preferred) {
    if (church.includes(preferred)) return [preferred];
    // one Chinese script converts to the other, so either counts as a church language
    if (isChinese(preferred) && church.some(isChinese)) return [preferred];
    return [primary];
  }
  if (church.length < 2) return [primary];
  const second = primary !== 'en' && church.includes('en') ? 'en' : church.find((l) => l !== primary)!;
  return [primary, second];
}

interface ServiceCtx {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  title: L10n;
  share_url: string | null;
}

function serviceCtx(serviceId: number, baseUrl: string): { svc: ServiceCtx; itemsByRole: Map<number, ReminderItem[]> } {
  const s = services.find(serviceId);
  if (!s) throw new NotFound(`service ${serviceId} not found`);
  const its = serviceItems.list('service_id = ?', [serviceId], 'position, id');
  const times = itemTimes(s, its);
  const itemsByRole = new Map<number, ReminderItem[]>();
  its.forEach((it, i) => {
    if (!it.role_id) return;
    let title: L10n = { ...it.title };
    if (it.kind === 'song' && it.ref_id) {
      const song = songs.find(it.ref_id);
      if (song) title = Object.fromEntries([...new Set([...Object.keys(title), ...Object.keys(song.title)])].map((l) => {
        const a = it.title[l]?.trim();
        const b = song.title[l]?.trim();
        return [l, a && b ? `${a} — ${b}` : a || b || ''];
      }));
    }
    const list = itemsByRole.get(it.role_id) ?? [];
    list.push({ id: it.id, title, start: times[i].start, end: times[i].end });
    itemsByRole.set(it.role_id, list);
  });
  const end = its.length ? times[times.length - 1].end : s.start_time;
  return {
    svc: {
      id: s.id, date: s.date, start_time: s.start_time, end_time: end, title: s.title,
      share_url: s.share_token ? `${baseUrl}/share/${s.share_token}` : null,
    },
    itemsByRole,
  };
}

function greetName(p: Pick<PersonRow, 'first_name' | 'preferred_name' | 'native_name'>, lang: Lang) {
  if (isChinese(lang) && p.native_name?.trim()) return p.native_name.trim();
  return (p.preferred_name || p.first_name).trim();
}

interface Content {
  svc: ServiceCtx;
  langs: Lang[];
  name: (lang: Lang) => string;
  roles: ReminderRole[];
  items: ReminderItem[];
  note?: string;
}

/** Plain-text and HTML reminder in one or more languages. */
export function renderReminder(c: Content): { subject: string; text: string; html: string } {
  const st = getSettings();
  const subjects: string[] = [];
  const texts: string[] = [];
  const htmls: string[] = [];
  for (const lang of c.langs) {
    const w = words(lang);
    const title = pickAny(c.svc.title, lang) || pickAny(GENERIC_TITLE, lang);
    const church = pickAny(st.church_name, lang);
    const when = `${fmtDate(c.svc.date, lang)}${w.at}${c.svc.start_time}`;
    const roleLines = c.roles.map((r) => {
      const team = pickAny(r.team, lang);
      const role = pickAny(r.name, lang);
      return team && team !== role ? (langInfo(lang).cjk ? `${role}（${team}）` : `${role} (${team})`) : role;
    });
    const note = c.note === undefined ? w.note : c.note.trim();
    subjects.push(fill(w.subject, { title, date: fmtDate(c.svc.date, lang, false) }));

    const t: string[] = [fill(w.greeting, { name: c.name(lang) }), '', w.intro, '', `  ${title}`, `  ${when}`, ''];
    const sep = langInfo(lang).cjk ? '；' : '; ';
    t.push(`${roleLines.length > 1 ? w.roles : w.role}${w.colon}${roleLines.join(sep)}`);
    if (c.items.length) {
      t.push('', `${w.items}${w.colon.trim()}`);
      for (const it of c.items) t.push(`  ${it.start}  ${pickAny(it.title, lang)}`);
    }
    if (note) t.push('', note);
    if (c.svc.share_url) t.push('', `${w.share}${w.colon}${c.svc.share_url}`);
    t.push('', w.closing, '', w.signoff, church);
    if (st.church_contact.trim()) t.push(st.church_contact.trim());
    texts.push(t.join('\n'));

    const font = langInfo(lang).cjk ? `Georgia,'Songti SC','SimSun',serif` : `Georgia,'Times New Roman',serif`;
    const h: string[] = [];
    h.push(`<div lang="${esc(langInfo(lang).htmlLang)}" style="font-family:${font};font-size:16px;line-height:1.55;color:#1E2430">`);
    h.push(`<p style="margin:0 0 12px">${esc(fill(w.greeting, { name: c.name(lang) }))}</p>`);
    h.push(`<p style="margin:0 0 12px">${esc(w.intro)}</p>`);
    h.push(`<div style="border-left:3px solid #A8893C;padding:6px 14px;margin:0 0 14px;background:#FBF8F1">`
      + `<div style="font-size:19px;font-weight:bold">${esc(title)}</div>`
      + `<div style="color:#4A5262">${esc(when)}</div></div>`);
    h.push(`<p style="margin:0 0 10px"><strong>${esc(roleLines.length > 1 ? w.roles : w.role)}${esc(w.colon.trim())}</strong> ${esc(roleLines.join(sep))}</p>`);
    if (c.items.length) {
      h.push(`<p style="margin:0 0 4px"><strong>${esc(w.items)}${esc(w.colon.trim())}</strong></p><table style="border-collapse:collapse;margin:0 0 12px">`);
      for (const it of c.items) {
        h.push(`<tr><td style="padding:2px 14px 2px 0;color:#7A6224;font-family:Consolas,monospace;vertical-align:top">${esc(it.start)}</td>`
          + `<td style="padding:2px 0">${esc(pickAny(it.title, lang))}</td></tr>`);
      }
      h.push('</table>');
    }
    if (note) h.push(`<p style="margin:0 0 12px;font-style:italic">${esc(note)}</p>`);
    if (c.svc.share_url) {
      h.push(`<p style="margin:0 0 12px">${esc(w.share)}${esc(w.colon)}<a href="${esc(c.svc.share_url)}" style="color:#2F4A7A">${esc(c.svc.share_url)}</a></p>`);
    }
    h.push(`<p style="margin:0 0 12px">${esc(w.closing)}</p>`);
    h.push(`<p style="margin:0">${esc(w.signoff)}<br><strong>${esc(church)}</strong>`
      + (st.church_contact.trim() ? `<br><span style="color:#4A5262;font-size:14px">${esc(st.church_contact.trim())}</span>` : '') + '</p>');
    h.push('</div>');
    htmls.push(h.join(''));
  }
  const subject = [...new Set(subjects)].join(' / ');
  const text = texts.join('\n\n— — —\n\n');
  const html = wrapHtml(htmls.join('<hr style="border:0;border-top:1px solid #A8893C;margin:26px 0">'), c.langs[0]);
  return { subject, text, html };
}

function wrapHtml(inner: string, lang: Lang) {
  return `<!doctype html><html lang="${esc(langInfo(lang).htmlLang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>`
    + `<body style="margin:0;padding:0;background:#F3EEE2">`
    + `<div style="background:#F3EEE2;padding:24px 12px"><div style="max-width:600px;margin:0 auto;background:#FFFDF8;border:1px solid #E2D9C3;border-top:3px solid #A8893C;border-radius:4px;padding:26px 28px">`
    + inner + '</div></div></body></html>';
}

function lastSent(serviceId: number) {
  const rows = all<{ person_id: number; at: string; ok: number; error: string | null }>(
    `SELECT person_id, at, ok, error FROM email_log WHERE id IN (
       SELECT MAX(id) FROM email_log WHERE service_id = ? AND kind = 'reminder' AND person_id IS NOT NULL GROUP BY person_id)`,
    serviceId,
  );
  return new Map(rows.map((r) => [r.person_id, { at: r.at, ok: !!r.ok, error: r.error }]));
}

/** Everyone serving at a service (not declined), one entry per person, with their rendered message. */
export function reminderRecipients(serviceId: number, opts: { baseUrl: string; note?: string }): { svc: ServiceCtx; recipients: (ReminderRecipient & { email: string | null })[] } {
  const { svc, itemsByRole } = serviceCtx(serviceId, opts.baseUrl);
  const church = getSettings().languages;
  const rows = all<PersonRow>(
    `SELECT a.person_id, a.role_id, a.status, p.first_name, p.last_name, p.preferred_name, p.native_name, p.email, p.preferred_lang,
            r.name AS role_name, t.name AS team_name
     FROM assignments a JOIN people p ON p.id = a.person_id JOIN roles r ON r.id = a.role_id JOIN teams t ON t.id = r.team_id
     WHERE a.service_id = ? AND a.status != 'declined'
     ORDER BY t.sort, t.id, r.sort, r.id, p.first_name, p.last_name`,
    serviceId,
  );
  const sent = lastSent(serviceId);
  const byPerson = new Map<number, PersonRow[]>();
  for (const r of rows) byPerson.set(r.person_id, [...(byPerson.get(r.person_id) ?? []), r]);
  const recipients = [...byPerson.values()].map((rs) => {
    const p = rs[0];
    const roles: ReminderRole[] = rs.map((r) => ({ role_id: r.role_id, name: JSON.parse(r.role_name), team: JSON.parse(r.team_name), status: r.status }));
    const seen = new Set<number>();
    const its = rs.flatMap((r) => itemsByRole.get(r.role_id) ?? []).filter((it) => !seen.has(it.id) && seen.add(it.id))
      .sort((a, b) => a.start.localeCompare(b.start));
    const langs = messageLangs(p.preferred_lang, church);
    const msg = renderReminder({ svc, langs, name: (l) => greetName(p, l), roles, items: its, note: opts.note });
    const latin = `${p.preferred_name || p.first_name} ${p.last_name ?? ''}`.trim();
    return {
      person_id: p.person_id,
      name: p.native_name ? `${latin} ${p.native_name}` : latin,
      email: p.email?.trim() || null,
      has_email: !!p.email?.trim(),
      preferred_lang: p.preferred_lang,
      langs,
      roles,
      items: its,
      ...msg,
      last_sent: sent.get(p.person_id) ?? null,
    };
  });
  return { svc, recipients };
}

/** Preview for the dialog: no addresses, only whether one is on file. */
export function reminderPreview(serviceId: number, opts: { baseUrl: string; note?: string }) {
  const { svc, recipients } = reminderRecipients(serviceId, opts);
  return {
    service: { id: svc.id, date: svc.date, start_time: svc.start_time, end_time: svc.end_time, title: svc.title },
    smtp_configured: smtpConfigured(),
    share_url: svc.share_url,
    default_note: defaultNotes(),
    recipients: recipients.map(({ email: _e, ...r }) => r),
  };
}

// ---------------------------------------------------------------- sending

export function logEmail(e: { user_id?: number | null; service_id?: number | null; person_id?: number | null; to_addr: string; subject: string; kind: string; ok: boolean; error?: string | null }) {
  run(
    'INSERT INTO email_log (user_id, service_id, person_id, to_addr, subject, kind, ok, error) VALUES (?,?,?,?,?,?,?,?)',
    e.user_id ?? null, e.service_id ?? null, e.person_id ?? null, e.to_addr, e.subject.slice(0, 300), e.kind, e.ok ? 1 : 0, e.error ?? null,
  );
}

export interface SendResult {
  person_id: number;
  name: string;
  ok: boolean;
  /** true when nothing was attempted (no address, or stopped after a fatal error) */
  skipped?: boolean;
  code?: string;
  error?: string;
}

const inFlight = new Set<number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendReminders(
  serviceId: number,
  opts: { baseUrl: string; userId: number; personIds?: number[]; note?: string; delayMs?: number },
) {
  if (!smtpConfigured()) throw new MailError('not_configured', 'E-mail is not set up yet — an administrator can add the SMTP server under Settings → E-mail.');
  if (inFlight.has(serviceId)) throw Object.assign(new Error('Reminders for this service are already being sent.'), { status: 409 });
  inFlight.add(serviceId);
  try {
    const { recipients } = reminderRecipients(serviceId, opts);
    const wanted = opts.personIds ? new Set(opts.personIds) : null;
    const chosen = recipients.filter((r) => (wanted ? wanted.has(r.person_id) : r.has_email));
    const results: SendResult[] = [];
    let fatal: MailError | null = null;
    let first = true;
    for (const r of chosen) {
      if (!r.email) {
        results.push({ person_id: r.person_id, name: r.name, ok: false, skipped: true, code: 'no_email', error: 'No e-mail address on file.' });
        continue;
      }
      if (fatal) {
        results.push({ person_id: r.person_id, name: r.name, ok: false, skipped: true, code: fatal.code, error: `Not sent: ${fatal.message}` });
        continue;
      }
      if (!first) await sleep(opts.delayMs ?? 400);
      first = false;
      try {
        await sendMail({ to: r.email, subject: r.subject, text: r.text, html: r.html });
        logEmail({ user_id: opts.userId, service_id: serviceId, person_id: r.person_id, to_addr: r.email, subject: r.subject, kind: 'reminder', ok: true });
        results.push({ person_id: r.person_id, name: r.name, ok: true });
      } catch (err) {
        const me = mapMailError(err);
        logEmail({ user_id: opts.userId, service_id: serviceId, person_id: r.person_id, to_addr: r.email, subject: r.subject, kind: 'reminder', ok: false, error: me.message });
        results.push({ person_id: r.person_id, name: r.name, ok: false, code: me.code, error: me.message });
        if (isFatal(me.code)) fatal = me;
      }
    }
    return {
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
      results,
    };
  } finally {
    inFlight.delete(serviceId);
  }
}

/** Bilingual test message (church languages, up to two) to check the SMTP settings. */
export async function sendTestEmail(to: string, userId: number) {
  const langs = getSettings().languages.slice(0, 2);
  const church = getSettings().church_name;
  const subject = [...new Set(langs.map((l) => words(l).test_subject))].join(' / ');
  const text = langs.map((l) => `${words(l).test_body}\n\n${pickAny(church, l)}`).join('\n\n— — —\n\n');
  const html = wrapHtml(langs.map((l) => `<p lang="${esc(langInfo(l).htmlLang)}" style="font-family:Georgia,serif;font-size:16px;color:#1E2430;margin:0 0 12px">`
    + `${esc(words(l).test_body)}<br><strong>${esc(pickAny(church, l))}</strong></p>`).join(''), langs[0] ?? 'en');
  try {
    await sendMail({ to, subject, text, html });
    logEmail({ user_id: userId, to_addr: to, subject, kind: 'test', ok: true });
    return { ok: true };
  } catch (err) {
    const me = mapMailError(err);
    logEmail({ user_id: userId, to_addr: to, subject, kind: 'test', ok: false, error: me.message });
    throw me;
  }
}

/** Mask an address for display: "grace@example.org" → "g•••@example.org". */
export const maskEmail = (a: string) => a.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');

export function emailLog(opts: { serviceId?: number; limit?: number }) {
  const rows = all<{ id: number; at: string; user_name: string | null; service_id: number | null; person_id: number | null; person_name: string | null; to_addr: string; subject: string; kind: string; ok: number; error: string | null }>(
    `SELECT l.id, l.at, u.display_name AS user_name, l.service_id, l.person_id,
            TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) AS person_name,
            l.to_addr, l.subject, l.kind, l.ok, l.error
     FROM email_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN people p ON p.id = l.person_id
     WHERE (? IS NULL OR l.service_id = ?) ORDER BY l.id DESC LIMIT ?`,
    opts.serviceId ?? null, opts.serviceId ?? null, Math.min(Math.max(opts.limit ?? 100, 1), 1000),
  );
  return rows.map((r) => ({ ...r, ok: !!r.ok, to_addr: maskEmail(r.to_addr) }));
}

export const serviceExists = (id: number) => !!get('SELECT 1 FROM services WHERE id = ?', id);
