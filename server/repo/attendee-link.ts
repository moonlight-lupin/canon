// The bulletin link for attendees (0.15.2): one public, read-only page per service with the order of service, the
// words, readings and announcements — and no serving team, notes or contact details. Switched on per service; its QR
// code can go on that week's bulletin and on a slide, like the visitor form's. Separate from the team's share link.
import crypto from 'node:crypto';
import type { L10n } from '../../shared/types.ts';
import type { RenderedService } from '../../shared/render-types.ts';
import { ATTENDEE_QR_BLOCK_ID } from '../../shared/visitor-form.ts';
import { get } from '../db.ts';
import { NotFound } from '../lib/table.ts';
import { addressForOthers } from '../lib/lan.ts';
import { publicUrl } from '../lib/public-url.ts';
import { services } from './services.ts';

export interface AttendeeLink { token?: string; bulletin?: boolean; slides?: boolean }

export interface AttendeeLinkInfo extends AttendeeLink {
  url: string | null;
  public_address: boolean;
  /** the link points at this computer only (no network address found): phones cannot open it */
  local_only: boolean;
}

const isLocalOnly = (url: string) => /^https?:\/\/(localhost|127\.|\[::1\]|0\.0\.0\.0)/i.test(url);

export const attendeeUrl = (token: string, origin?: string) => `${addressForOthers(origin)}/b/${token}`;

function linkOf(serviceId: number): AttendeeLink {
  const r = get<{ attendee: string | null }>('SELECT attendee FROM services WHERE id = ?', serviceId);
  if (!r) throw new NotFound(`service ${serviceId} not found`);
  try {
    return JSON.parse(r.attendee || '{}') as AttendeeLink;
  } catch {
    return {};
  }
}

export function attendeeInfo(serviceId: number, origin?: string): AttendeeLinkInfo {
  const a = linkOf(serviceId);
  const url = a.token ? attendeeUrl(a.token, origin) : null;
  return { ...a, url, public_address: !!publicUrl(), local_only: !!url && isLocalOnly(url) };
}

/** Switch the link on (a new link each time it is switched on again) or off, and choose where its QR code shows. */
export function setAttendee(serviceId: number, p: { enabled: boolean; bulletin?: boolean; slides?: boolean }, origin?: string): AttendeeLinkInfo {
  services.get(serviceId);
  const cur = linkOf(serviceId);
  const next: AttendeeLink = p.enabled
    ? { token: cur.token ?? crypto.randomBytes(18).toString('base64url'), bulletin: p.bulletin ?? cur.bulletin ?? false, slides: p.slides ?? cur.slides ?? false }
    : {};
  services.update(serviceId, { attendee: next });
  return attendeeInfo(serviceId, origin);
}

export function serviceByAttendeeToken(token: string): number {
  const r = /^[\w-]{10,60}$/.test(token) ? get<{ id: number }>("SELECT id FROM services WHERE json_extract(attendee, '$.token') = ?", token) : undefined;
  if (!r) throw new NotFound('This bulletin link is not available.');
  return r.id;
}

/** What attendees see: the service without the serving team, the team's notes or anything about people beyond the leaders' names. */
export function forAttendees(r: RenderedService): RenderedService {
  return {
    ...r,
    roster: [],
    next_roster: null,
    notes: null,
    items: r.items.map((it) => ({ ...it, notes: null })),
  } as RenderedService;
}

/** The link's QR code on the bulletin's back page and on a slide, when the planner chose it. */
export function attendeeQrBlock(serviceId: number) {
  const a = linkOf(serviceId);
  if (!a.token || (!a.bulletin && !a.slides)) return null;
  return {
    id: ATTENDEE_QR_BLOCK_ID,
    value: attendeeUrl(a.token),
    caption: { en: 'This bulletin on your phone', zh: '在手机上看这份次序单' } as L10n,
    bulletin: !!a.bulletin,
    slides: !!a.slides,
  };
}
