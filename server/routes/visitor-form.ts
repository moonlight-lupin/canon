// The public visitor form: GET /v/<token> shows it, POST /v/<token> sends it. No sign-in, no app, no scripts — a
// plain page that works on any phone. Only the church name and the service's title and date are shown; the entry
// goes to the review queue (visitor cards). Protection: a link that cannot be guessed, a short open window around
// the service, a hidden trap field, a signed time stamp (too fast or too old is refused), per-address limits, small
// field limits, and a strict Content-Security-Policy.
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { CARD_LIMITS } from '../../shared/visitor-form.ts';
import type { L10n } from '../../shared/types.ts';
import { get } from '../db.ts';
import { getSettings } from '../repo/settings.ts';
import { formOpen, formSettings, serviceByFormToken, submitCard } from '../repo/visitor-form.ts';

export const visitorFormRouter = express.Router();

const KEY = crypto.randomBytes(32);
const sign = (s: string) => crypto.createHmac('sha256', KEY).update(s).digest('base64url').slice(0, 22);
const MIN_MS = 2_000;
const MAX_MS = 3 * 3600_000;

// per address: at most 6 entries in 10 minutes
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= 6) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 600_000)) hits.delete(k);
  return false;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Words = Record<string, { en: string; zh: string }>;
const W: Words = {
  name: { en: 'Your name', zh: '您的姓名' },
  contact: { en: 'Phone or e-mail (optional)', zh: '电话或电邮（可不填）' },
  source: { en: 'How did you hear about us? (optional)', zh: '您怎样知道这个聚会？（可不填）' },
  wants: { en: 'I would like someone from the church to contact me', zh: '我希望教会有人与我联络' },
  prayer: { en: 'Prayer request (optional)', zh: '代祷事项（可不填）' },
  send: { en: 'Send', zh: '提交' },
  thanks: { en: 'Thank you! We are glad you came.', zh: '谢谢您！很高兴您来参加聚会。' },
  thanks2: { en: 'Someone from the church will read this soon.', zh: '教会同工会尽快查看。' },
  closed: { en: 'This form is closed. Please speak to someone at the welcome desk.', zh: '这份表格已经关闭，请向招待处的同工查询。' },
  gone: { en: 'This form is not available.', zh: '这份表格无法使用。' },
  slow: { en: 'Too many entries from here just now. Please try again in a few minutes.', zh: '刚才从这里提交的次数太多，请几分钟后再试。' },
  again: { en: 'Please check the form and send it again.', zh: '请检查表格后再提交一次。' },
  needName: { en: 'Please write your name.', zh: '请填写您的姓名。' },
  needConsent: { en: 'Please tick the box to agree, or leave your contact details and prayer request empty.', zh: '请勾选同意，或不要填写联络资料和代祷事项。' },
};

/** Labels in the service's languages: Chinese first when the service has it, with English below. */
function say(k: keyof typeof W, langs: string[]): string {
  const w = W[k];
  const zh = langs.some((l) => l === 'zh' || l.startsWith('zh-'));
  const en = langs.includes('en') || !zh;
  return [zh ? w.zh : '', en ? w.en : ''].filter(Boolean).map(esc).join('<br><span class="en">') + (zh && en ? '</span>' : '');
}
const pickL10n = (v: L10n, langs: string[]) => {
  const zh = langs.some((l) => l.startsWith('zh')) ? v.zh ?? v['zh-Hant'] : '';
  const en = langs.includes('en') || !zh ? v.en : '';
  return [zh, en].filter(Boolean).map(esc).join('<br>');
};

const CSS = `*{box-sizing:border-box}body{margin:0;font:17px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f3eee2;color:#1e2430}
main{max-width:520px;margin:0 auto;padding:18px 16px 40px}.card{background:#fff;border:1px solid #ddd4c0;border-radius:14px;padding:20px}
.church{text-align:center;margin:6px 0 14px}.church img{max-height:64px;max-width:200px}.church h1{font:600 1.25rem Georgia,"Songti SC",serif;margin:6px 0 0}
.svc{text-align:center;color:#4a505c;font-size:.95rem;margin-bottom:14px}.welcome{margin:0 0 16px}
label{display:block;font-weight:600;font-size:.95rem;margin:14px 0 6px}.en{font-weight:400;color:#4a505c;font-size:.88em}
input[type=text],textarea{width:100%;font:inherit;padding:11px 12px;border:1px solid #c9bea4;border-radius:10px;background:#faf7f0}
textarea{min-height:96px;resize:vertical}.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:16px 0}
.check input{width:22px;height:22px;margin-top:2px;flex:none}button{margin-top:18px;width:100%;font:600 1.05rem system-ui,sans-serif;padding:13px;border:0;border-radius:10px;background:#2f4a7a;color:#f6f2e8}
.err{background:#f6e2df;border:1px solid #a3362e;border-radius:10px;padding:10px 12px;margin-bottom:12px}.done{text-align:center;padding:18px 4px}
.trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.small{font-size:.85rem;color:#7a7f88}`;

function page(res: Response, status: number, langs: string[], body: string) {
  const s = getSettings();
  const name = pickL10n(s.church_name, langs);
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.send(
    `<!doctype html><html lang="${langs.some((l) => l.startsWith('zh')) ? 'zh' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><title>${esc(s.church_name.en || s.church_name.zh || 'Church')}</title><style>${CSS}</style></head><body><main>` +
    `<div class="church">${get('SELECT 1 FROM assets WHERE key = ?', 'logo') ? '<img src="/api/assets/logo" alt="">' : ''}<h1>${name}</h1></div><div class="card">${body}</div></main></body></html>`,
  );
}

function formHtml(token: string, svc: ReturnType<typeof serviceByFormToken>, error?: string, keep: Record<string, string> = {}) {
  const f = formSettings();
  const L = svc.languages;
  const ts = String(Date.now());
  const v = (k: string) => esc(keep[k] ?? '');
  return (
    `<div class="svc">${pickL10n(svc.title, L)}<br>${esc(svc.date)} · ${esc(svc.start_time)}</div>` +
    (error ? `<div class="err">${error}</div>` : '') +
    `<p class="welcome">${pickL10n(f.welcome, L)}</p>` +
    `<form method="post" action="/v/${esc(token)}" autocomplete="on">` +
    `<input type="hidden" name="t" value="${ts}.${sign(ts + token)}"><input type="hidden" name="lang" value="${esc(L[0] ?? 'en')}">` +
    `<div class="trap" aria-hidden="true"><label>Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>` +
    `<label for="name">${say('name', L)}</label><input type="text" id="name" name="name" required maxlength="${CARD_LIMITS.name}" autocomplete="name" value="${v('name')}">` +
    `<label for="contact">${say('contact', L)}</label><input type="text" id="contact" name="contact" maxlength="${CARD_LIMITS.contact}" autocomplete="tel" value="${v('contact')}">` +
    `<label for="source">${say('source', L)}</label><input type="text" id="source" name="source" maxlength="${CARD_LIMITS.source}" value="${v('source')}">` +
    `<label class="check"><input type="checkbox" name="wants_contact" value="1"${keep.wants_contact ? ' checked' : ''}><span>${say('wants', L)}</span></label>` +
    (f.prayer ? `<label for="prayer">${say('prayer', L)}</label><textarea id="prayer" name="prayer" maxlength="${CARD_LIMITS.prayer}">${v('prayer')}</textarea>` : '') +
    `<label class="check"><input type="checkbox" name="consent" value="1"${keep.consent ? ' checked' : ''}><span class="small">${pickL10n(f.consent, L)}</span></label>` +
    `<button type="submit">${say('send', L)}</button></form>`
  );
}

const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? '?';

visitorFormRouter.get('/v/:token', (req, res) => {
  let svc: ReturnType<typeof serviceByFormToken>;
  try {
    svc = serviceByFormToken(req.params.token);
  } catch {
    return page(res, 404, ['en', 'zh'], `<p class="done">${say('gone', ['en', 'zh'])}</p>`);
  }
  if (!formOpen(svc.date)) return page(res, 410, svc.languages, `<p class="done">${say('closed', svc.languages)}</p>`);
  page(res, 200, svc.languages, formHtml(req.params.token, svc));
});

visitorFormRouter.post('/v/:token', express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 }), (req, res) => {
  const token = req.params.token;
  let svc: ReturnType<typeof serviceByFormToken>;
  try {
    svc = serviceByFormToken(token);
  } catch {
    return page(res, 404, ['en', 'zh'], `<p class="done">${say('gone', ['en', 'zh'])}</p>`);
  }
  const L = svc.languages;
  const b = (req.body ?? {}) as Record<string, string>;
  const thanks = `<div class="done"><p><strong>${say('thanks', L)}</strong></p><p class="small">${say('thanks2', L)}</p></div>`;
  // the trap field: people never see it, so a filled one is a bot — answer as if it worked, keep nothing
  if (b.website) return page(res, 200, L, thanks);
  const [ts, sig] = String(b.t ?? '').split('.');
  const age = Date.now() - Number(ts);
  if (!ts || sig !== sign(ts + token) || !(age >= MIN_MS && age <= MAX_MS)) return page(res, 400, L, formHtml(token, svc, say('again', L), b));
  if (limited(ipOf(req))) return page(res, 429, L, `<p class="done">${say('slow', L)}</p>`);
  try {
    submitCard(token, { ...b });
  } catch (e) {
    const msg = (e as Error).message;
    if (/closed/.test(msg)) return page(res, 410, L, `<p class="done">${say('closed', L)}</p>`);
    const shown = /your name/.test(msg) ? say('needName', L) : /tick the box/.test(msg) ? say('needConsent', L) : esc(msg);
    return page(res, 400, L, formHtml(token, svc, shown, b));
  }
  page(res, 200, L, thanks);
});
