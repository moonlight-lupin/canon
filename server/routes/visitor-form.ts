// The public visitor form: GET /v/<token> shows it, POST /v/<token> sends it. No sign-in, no app, no scripts — a
// plain page that works on any phone. Only the church name and the service's title and date are shown; the entry
// goes to the review queue (visitor cards). Protection: a link that cannot be guessed, a short open window around
// the service, a hidden trap field, a signed time stamp (too fast or too old is refused), per-address limits, small
// field limits, and a strict Content-Security-Policy.
import { langInfo } from '../../shared/languages.ts';
import { st, contentIn } from '../lib/server-text.ts';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { CARD_LIMITS } from '../../shared/visitor-form.ts';
import type { L10n } from '../../shared/types.ts';
import { get } from '../db.ts';
import { getSettings } from '../repo/settings.ts';
import { formOpen, formSettings, serviceByFormToken, submitCard } from '../repo/visitor-form.ts';
import { addressKey, makeLimiter } from '../lib/rate-limit.ts';

export const visitorFormRouter = express.Router();

const KEY = crypto.randomBytes(32);
const sign = (s: string) => crypto.createHmac('sha256', KEY).update(s).digest('base64url').slice(0, 22);
const MIN_MS = 2_000;
const MAX_MS = 3 * 3600_000;

// per address: at most PER_ADDRESS entries in 10 minutes. Generous on purpose: through a public address, every
// phone on the church's Wi-Fi shares one address, and many visitors may fill in the form right after the service.
// (Each service also stops at 500 entries waiting for review.)
export const PER_ADDRESS = 40;
const perAddress = makeLimiter(PER_ADDRESS, 600_000);
const limited = (ip: string) => perAddress.limited(addressKey(ip));

/** For tests: forget the per-address counts. */
export const resetVisitorFormLimits = () => perAddress.reset();

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// the English wording; other languages are in locales/<code>/server.json (server/lib/server-text.ts)
const W = {
  name: 'Your name',
  contact: 'Phone or e-mail (optional)',
  source: 'How did you hear about us? (optional)',
  other: 'Other',
  about: 'Which describes you best? (optional)',
  otherBox: 'Please tell us',
  wants: 'I would like someone from the church to contact me',
  prayer: 'Prayer request (optional)',
  send: 'Send',
  thanks: 'Thank you! We are glad you came.',
  thanks2: 'Someone from the church will read this soon.',
  closed: 'This form is closed. Please speak to someone at the welcome desk.',
  gone: 'This form is not available.',
  slow: 'Too many entries from here just now. Please try again in a few minutes.',
  again: 'Please check the form and send it again.',
  needName: 'Please write your name.',
  needConsent: 'Please tick the box to agree, or leave your contact details and prayer request empty.',
} as const;

// the service's languages for a page: every language but English first (the visitors' own), English last, so
// a Chinese, Malay … service reads in its language with English underneath
const order = (langs: string[]) => {
  const L = [...new Set(langs.length ? langs : ['en'])];
  return [...L.filter((l) => l !== 'en'), ...L.filter((l) => l === 'en')];
};
const stack = (lines: string[]) => {
  const u = [...new Set(lines.filter(Boolean))];
  return u.map((x, i) => (i ? `<span class="en">${esc(x)}</span>` : esc(x))).join('<br>');
};

/** A label in the service's languages: the first plainly, the others smaller below. */
function say(k: keyof typeof W, langs: string[]): string {
  return stack(order(langs).map((l) => st(W[k], l)));
}
/** The church's own text (welcome, options, church name) in the service's languages, Chinese converted as needed. */
const pickL10n = (v: L10n, langs: string[]) => {
  const lines = order(langs).map((l) => contentIn(v, l));
  return stack(lines.some(Boolean) ? lines : [contentIn(v, 'en') || Object.values(v).find((x) => x?.trim()) || '']);
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
.trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}.small{font-size:.85rem;color:#7a7f88}
fieldset.opts{border:0;padding:0;margin:14px 0 0}fieldset.opts legend{font-weight:600;font-size:.95rem;margin-bottom:6px;padding:0}
.opt{display:flex;gap:10px;align-items:center;font-weight:400;margin:6px 0;padding:9px 12px;border:1px solid #ddd4c0;border-radius:10px;background:#faf7f0}
.opt input{width:20px;height:20px;flex:none;margin:0}fieldset.opts input[type=text]{margin-top:6px}`;

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
    `<!doctype html><html lang="${langInfo(order(langs)[0]).htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><title>${esc(contentIn(s.church_name, order(langs)[0]) || s.church_name.en || 'Church')}</title><style>${CSS}</style></head><body><main>` +
    `<div class="church">${get('SELECT 1 FROM assets WHERE key = ?', 'logo') ? '<img src="/api/assets/logo" alt="">' : ''}<h1>${name}</h1></div><div class="card">${body}</div></main></body></html>`,
  );
}

/** "How did you hear about us?": the church's options as large tap targets, then Other with a box (no scripts needed). */
function sourceField(options: L10n[], L: string[], keep: Record<string, string>) {
  const picked = keep.source_choice ?? '';
  if (!options.length) {
    return `<label for="source">${say('source', L)}</label><input type="text" id="source" name="source" maxlength="${CARD_LIMITS.source}" value="${esc(keep.source ?? '')}">`;
  }
  const radio = (value: string, label: string) =>
    `<label class="opt"><input type="radio" name="source_choice" value="${value}"${picked === value ? ' checked' : ''}><span>${label}</span></label>`;
  return `<fieldset class="opts"><legend>${say('source', L)}</legend>` +
    options.map((o, i) => radio(String(i), pickL10n(o, L))).join('') +
    radio('other', say('other', L)) +
    `<input type="text" name="source" maxlength="${CARD_LIMITS.source}" placeholder="${esc(stripTags(say('otherBox', L)))}" aria-label="${esc(stripTags(say('other', L)))}" value="${esc(keep.source ?? '')}">` +
    `</fieldset>`;
}
/** "Which describes you best?": the church's answers only (no Other); not asked when there are none. */
function aboutField(options: L10n[], L: string[], keep: Record<string, string>) {
  if (!options.length) return '';
  const picked = keep.about_choice ?? '';
  return `<fieldset class="opts"><legend>${say('about', L)}</legend>` +
    options.map((o, i) => `<label class="opt"><input type="radio" name="about_choice" value="${i}"${picked === String(i) ? ' checked' : ''}><span>${pickL10n(o, L)}</span></label>`).join('') +
    `</fieldset>`;
}
const stripTags = (s: string) => s.replace(/<br>/g, ' / ').replace(/<[^>]+>/g, '');

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
    aboutField(f.abouts, L, keep) +
    sourceField(f.sources, L, keep) +
    `<label class="check"><input type="checkbox" name="wants_contact" value="1"${keep.wants_contact ? ' checked' : ''}><span>${say('wants', L)}</span></label>` +
    (f.prayer ? `<label for="prayer">${say('prayer', L)}</label><textarea id="prayer" name="prayer" maxlength="${CARD_LIMITS.prayer}">${v('prayer')}</textarea>` : '') +
    `<label class="check"><input type="checkbox" name="consent" value="1"${keep.consent ? ' checked' : ''}><span class="small">${pickL10n(f.consent, L)}</span></label>` +
    `<button type="submit">${say('send', L)}</button></form>`
  );
}

const ipOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? '?';

visitorFormRouter.get('/v/:token', (req, res) => {
  if (getSettings().modules.visitor_form === false) return page(res, 404, getSettings().languages, `<p class="done">${say('gone', getSettings().languages)}</p>`);
  let svc: ReturnType<typeof serviceByFormToken>;
  try {
    svc = serviceByFormToken(req.params.token);
  } catch {
    return page(res, 404, getSettings().languages, `<p class="done">${say('gone', getSettings().languages)}</p>`);
  }
  if (!formOpen(svc.date)) return page(res, 410, svc.languages, `<p class="done">${say('closed', svc.languages)}</p>`);
  page(res, 200, svc.languages, formHtml(req.params.token, svc));
});

visitorFormRouter.post('/v/:token', express.urlencoded({ extended: false, limit: '8kb', parameterLimit: 20 }), (req, res) => {
  if (getSettings().modules.visitor_form === false) return page(res, 404, getSettings().languages, `<p class="done">${say('gone', getSettings().languages)}</p>`);
  const token = req.params.token;
  let svc: ReturnType<typeof serviceByFormToken>;
  try {
    svc = serviceByFormToken(token);
  } catch {
    return page(res, 404, getSettings().languages, `<p class="done">${say('gone', getSettings().languages)}</p>`);
  }
  const L = svc.languages;
  const b = (req.body ?? {}) as Record<string, string>;
  const thanks = `<div class="done"><p><strong>${say('thanks', L)}</strong></p><p class="small">${say('thanks2', L)}</p></div>`;
  // the trap field: people never see it, so a filled one is a bot — answer as if it worked, keep nothing
  if (b.website) return page(res, 200, L, thanks);
  const [ts, sig] = String(b.t ?? '').split('.');
  const age = Date.now() - Number(ts);
  if (!ts || sig !== sign(ts + token) || !(age >= MIN_MS && age <= MAX_MS)) return page(res, 400, L, formHtml(token, svc, say('again', L), b));
  if (limited(ipOf(req))) {
    res.setHeader('Retry-After', String(Math.max(1, perAddress.retryAfter(addressKey(ipOf(req))))));
    return page(res, 429, L, `<p class="done">${say('slow', L)}</p>`);
  }
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
