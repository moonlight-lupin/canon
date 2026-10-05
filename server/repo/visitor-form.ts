// The visitor form (Settings → Visitor form): one short public form per service. Visitors' entries wait as visitor
// cards until an editor accepts them into the service record's New visitors, or discards them. Nothing a visitor
// sends is shown publicly; the public page shows only the church name and the service's title and date.
import crypto from 'node:crypto';
import { type ServiceVisitorForm, type VisitorCard, type VisitorFormSettings, CARD_LIMITS, DEFAULT_VISITOR_FORM, MAX_SOURCES, VISITOR_QR_BLOCK_ID, sourceLabel } from '../../shared/visitor-form.ts';
import type { L10n } from '../../shared/types.ts';
import { all, get, run } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { publicUrl } from '../lib/public-url.ts';
import { getSettings, updateSettings } from './settings.ts';
import { recordFor, saveRecord } from './records.ts';
import { services } from './services.ts';

export const formSettings = (): VisitorFormSettings => ({ ...DEFAULT_VISITOR_FORM, ...getSettings().visitor_form });

export function saveFormSettings(p: Partial<VisitorFormSettings>): VisitorFormSettings {
  const cur = formSettings();
  const next: VisitorFormSettings = {
    enabled: p.enabled ?? cur.enabled,
    prayer: p.prayer ?? cur.prayer,
    welcome: p.welcome ?? cur.welcome,
    consent: p.consent ?? cur.consent,
    days_after: Math.min(14, Math.max(0, Math.floor(p.days_after ?? cur.days_after))),
    sources: (p.sources ?? cur.sources).filter((o) => Object.values(o).some((v) => v?.trim())).slice(0, MAX_SOURCES),
    abouts: (p.abouts ?? cur.abouts).filter((o) => Object.values(o).some((v) => v?.trim())).slice(0, MAX_SOURCES),
  };
  updateSettings({ visitor_form: next });
  return next;
}

const serviceForm = (serviceId: number): ServiceVisitorForm => {
  const r = get<{ visitor_form: string | null }>('SELECT visitor_form FROM services WHERE id = ?', serviceId);
  if (!r) throw new NotFound(`service ${serviceId} not found`);
  try {
    return JSON.parse(r.visitor_form || '{}') as ServiceVisitorForm;
  } catch {
    return {};
  }
};

/** The form's web address: the public address when set (Settings → AI / MCP), else the address Canon was reached at. */
export function formUrl(token: string, origin?: string): string {
  const base = publicUrl() || (origin ?? '').replace(/\/+$/, '');
  return `${base}/v/${token}`;
}
/** "localhost" and the like only work on the computer itself: a phone cannot open them. */
const isLocalOnly = (url: string) => /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(url);

export interface ServiceFormInfo extends ServiceVisitorForm {
  enabled_church: boolean;
  url: string | null;
  public_address: boolean;
  /** the link points at this computer only (localhost): phones cannot open it */
  local_only: boolean;
  pending: number;
}

export function serviceFormInfo(serviceId: number, origin?: string): ServiceFormInfo {
  const f = serviceForm(serviceId);
  const url = f.token ? formUrl(f.token, f.base ?? origin) : null;
  return {
    ...f,
    enabled_church: formSettings().enabled,
    url,
    public_address: !!publicUrl(),
    local_only: !!url && isLocalOnly(url),
    pending: get<{ n: number }>('SELECT COUNT(*) AS n FROM visitor_cards WHERE service_id = ?', serviceId)?.n ?? 0,
  };
}

/** Turn a service's form on or off and choose where its QR code shows. Turning it off keeps the link for later. */
export function setServiceForm(serviceId: number, p: { enabled: boolean; bulletin?: boolean; slides?: boolean }, origin?: string): ServiceFormInfo {
  services.get(serviceId);
  const cur = serviceForm(serviceId);
  const next: ServiceVisitorForm = p.enabled
    ? {
        token: cur.token ?? crypto.randomBytes(18).toString('base64url'), bulletin: p.bulletin ?? cur.bulletin ?? false, slides: p.slides ?? cur.slides ?? false,
        // remember where Canon was opened, for the printed QR codes when no public address is set
        ...(origin && (!cur.base || isLocalOnly(cur.base)) ? { base: origin.replace(/\/+$/, '') } : cur.base ? { base: cur.base } : {}),
      }
    : {};
  services.update(serviceId, { visitor_form: next });
  return serviceFormInfo(serviceId, origin);
}

/** The service a form link belongs to (only while the church has the form switched on). */
export function serviceByFormToken(token: string): { id: number; date: string; start_time: string; title: L10n; languages: string[] } {
  if (!formSettings().enabled || !/^[\w-]{10,60}$/.test(token)) throw new NotFound('This form is not available.');
  const r = get<{ id: number; date: string; start_time: string; title: string; languages: string }>(
    "SELECT id, date, start_time, title, languages FROM services WHERE json_extract(visitor_form, '$.token') = ?", token,
  );
  if (!r) throw new NotFound('This form is not available.');
  return { id: r.id, date: r.date, start_time: r.start_time, title: JSON.parse(r.title), languages: JSON.parse(r.languages) };
}

const addDays = (d: string, n: number) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Whether entries are accepted today: from the day before the service until the set number of days after it. */
export function formOpen(serviceDate: string, today = new Date().toISOString().slice(0, 10)): boolean {
  return today >= addDays(serviceDate, -1) && today <= addDays(serviceDate, formSettings().days_after);
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const clipText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');

/** A visitor's entry from the public form: checked and kept for review. */
export function submitCard(token: string, input: Record<string, unknown>): VisitorCard {
  const svc = serviceByFormToken(token);
  if (!formOpen(svc.date)) throw new BadRequest('This form is closed.');
  const name = clip(input.name, CARD_LIMITS.name);
  if (!name) throw new BadRequest('Please write your name.');
  const contact = clip(input.contact, CARD_LIMITS.contact) || null;
  // "How did you hear about us?": one of the church's options (kept in its first language), or the visitor's own words
  const choice = typeof input.source_choice === 'string' ? input.source_choice : '';
  const options = formSettings().sources;
  const chosen = /^\d+$/.test(choice) ? options[Number(choice)] : undefined;
  const source = chosen ? sourceLabel(chosen, getSettings().languages[0]) : clip(input.source, CARD_LIMITS.source) || null;
  // "Which describes you best?": only one of the church's answers
  const aboutChoice = typeof input.about_choice === 'string' && /^\d+$/.test(input.about_choice) ? formSettings().abouts[Number(input.about_choice)] : undefined;
  const about = aboutChoice ? sourceLabel(aboutChoice, getSettings().languages[0]) : null;
  const prayer = formSettings().prayer ? clipText(input.prayer, CARD_LIMITS.prayer) || null : null;
  const consent = input.consent === true || input.consent === 'on' || input.consent === '1';
  if ((contact || prayer) && !consent) throw new BadRequest('Please tick the box to agree, or leave your contact details and prayer request empty.');
  const pending = get<{ n: number }>('SELECT COUNT(*) AS n FROM visitor_cards WHERE service_id = ?', svc.id)?.n ?? 0;
  if (pending >= 500) throw new BadRequest('This form cannot take more entries at the moment.');
  run(
    'INSERT INTO visitor_cards (service_id, name, contact, source, wants_contact, prayer, consent, lang, about) VALUES (?,?,?,?,?,?,?,?,?)',
    svc.id, name, contact, source ? source.slice(0, CARD_LIMITS.source) : null,
    input.wants_contact === true || input.wants_contact === 'on' || input.wants_contact === '1' ? 1 : 0,
    prayer, consent ? 1 : 0, clip(input.lang, 10) || null, about,
  );
  return cardsFor(svc.id).at(-1)!;
}

const decode = (r: Record<string, unknown>): VisitorCard => ({
  id: Number(r.id), service_id: Number(r.service_id), created_at: String(r.created_at), name: String(r.name),
  contact: (r.contact as string | null) ?? null, source: (r.source as string | null) ?? null, wants_contact: !!r.wants_contact,
  prayer: (r.prayer as string | null) ?? null, about: (r.about as string | null) ?? null, consent: !!r.consent, lang: (r.lang as string | null) ?? null,
});

export const cardsFor = (serviceId: number): VisitorCard[] =>
  all<Record<string, unknown>>('SELECT * FROM visitor_cards WHERE service_id = ? ORDER BY id', serviceId).map(decode);

/** Pending cards per service, for the records list. */
export const pendingCounts = (): Map<number, number> =>
  new Map(all<{ service_id: number; n: number }>('SELECT service_id, COUNT(*) AS n FROM visitor_cards GROUP BY service_id').map((r) => [r.service_id, r.n]));

function card(id: number): VisitorCard {
  const r = get<Record<string, unknown>>('SELECT * FROM visitor_cards WHERE id = ?', id);
  if (!r) throw new NotFound('This visitor card has already been dealt with.');
  return decode(r);
}

/** Accept a card: the visitor joins the service record's New visitors (with "via form"); the card is removed. */
export function acceptCard(id: number, who: { name: string; admin: boolean }) {
  const c = card(id);
  const rec = recordFor(c.service_id);
  const notes = [c.wants_contact ? 'Would like to be contacted' : '', 'via visitor form'].filter(Boolean).join(' · ');
  const visitors = [...rec.visitors, {
    name: c.name, ...(c.contact ? { contact: c.contact } : {}), ...(c.source ? { source: c.source } : {}),
    ...(c.prayer ? { prayer: c.prayer } : {}), ...(c.about ? { about: c.about } : {}), notes,
  }];
  const r = saveRecord(c.service_id, { visitors }, who);
  run('DELETE FROM visitor_cards WHERE id = ?', id);
  return r;
}

/** Discard a card (spam, a duplicate): it is deleted, nothing is kept. */
export function discardCard(id: number) {
  card(id);
  run('DELETE FROM visitor_cards WHERE id = ?', id);
  return { ok: true };
}

/** The QR block the bulletin / slides show for a service's form, or null. */
export function visitorQrBlock(serviceId: number) {
  if (!formSettings().enabled) return null;
  const f = serviceForm(serviceId);
  if (!f.token || (!f.bulletin && !f.slides)) return null;
  return {
    id: VISITOR_QR_BLOCK_ID,
    value: formUrl(f.token, f.base),
    caption: { en: 'New here? Scan to say hello', zh: '初次来访？请扫码留下资料' } as L10n,
    bulletin: !!f.bulletin,
    slides: !!f.slides,
  };
}
