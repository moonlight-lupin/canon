// The visitor form: a short public form, one per service, that visitors fill in on their phone (from a QR code on
// the bulletin, a slide or a printed card). Entries wait as "visitor cards" until an editor accepts them into the
// service record's New visitors (or discards them). The church switches it on in Settings → Visitor form.
import type { L10n } from './types.ts';

/** Church-wide settings (Settings → Visitor form). */
export interface VisitorFormSettings {
  enabled: boolean;
  /** offer an optional prayer request box (sensitive: handled like contact details) */
  prayer: boolean;
  /** the welcome line at the top of the form */
  welcome: L10n;
  /** the consent sentence ticked when leaving contact details or a prayer request */
  consent: L10n;
  /** entries are accepted from the day before the service until this many days after it */
  days_after: number;
  /** answers offered for "How did you hear about us?" (an "Other" box is always added) */
  sources: L10n[];
  /** answers offered for "Which describes you best?" (none = the question is not asked); sensitive, like contact details */
  abouts: L10n[];
}

/** The answer kept for a chosen option: in the church's first language, so reports group the same answer together. */
export const sourceLabel = (o: L10n, firstLang = 'en') => (o[firstLang] || o.en || o.zh || Object.values(o).find(Boolean) || '').trim();
export const MAX_SOURCES = 12;

export const DEFAULT_VISITOR_FORM: VisitorFormSettings = {
  enabled: false,
  prayer: false,
  welcome: { en: 'Welcome! We are glad you joined us. Tell us a little about yourself.', zh: '欢迎您！很高兴您来参加聚会，请告诉我们一些关于您的资料。' },
  consent: {
    en: 'I agree that the church may keep these details to welcome me and get in touch, and will not share them outside the church.',
    zh: '我同意教会保存这些资料，用来欢迎及联络我，并不会向教会以外的人透露。',
  },
  days_after: 3,
  sources: [
    { en: 'A friend or family member invited me', zh: '亲友邀请' },
    { en: 'I live or work nearby', zh: '住在或在附近工作' },
    { en: 'Walked past', zh: '路过' },
    { en: 'Online search or map', zh: '网上搜索或地图' },
    { en: 'Social media', zh: '社交媒体' },
    { en: 'Church website', zh: '教会网站' },
    { en: 'A church event', zh: '教会活动' },
    { en: 'Moved from another church', zh: '从别的教会转来' },
  ],
  abouts: [
    { en: 'Interested in the Christian faith', zh: '慕道友' },
    { en: 'A believer, not yet baptised', zh: '已信主，未受洗' },
    { en: 'A baptised Christian', zh: '已受洗的基督徒' },
    { en: 'Visiting or travelling', zh: '路过或旅行中' },
    { en: 'Looking for a church home', zh: '寻找教会' },
  ],
};

/** One service's form: its link (token) and where its QR code is shown. */
export interface ServiceVisitorForm {
  /** the secret part of the form's link; absent = no form for this service */
  token?: string;
  /** print the QR code on the bulletin's back page */
  bulletin?: boolean;
  /** show the QR code on a slide after the Announcements item (else after the last item) */
  slides?: boolean;
  /** the address Canon was opened at when the form was switched on (used when no public address is set) */
  base?: string;
}

/** A visitor's entry waiting for review. */
export interface VisitorCard {
  id: number;
  service_id: number;
  created_at: string;
  name: string;
  contact: string | null;
  source: string | null;
  wants_contact: boolean;
  prayer: string | null;
  /** "Which describes you best?" — sensitive */
  about: string | null;
  consent: boolean;
  lang: string | null;
}

export const CARD_LIMITS = { name: 120, contact: 200, source: 200, prayer: 1500 } as const;
/** The virtual block id used for the visitor-form QR on the bulletin and slides (real blocks have positive ids). */
export const VISITOR_QR_BLOCK_ID = -1;
/** The same for the attendees' bulletin link (server/repo/attendee-link.ts). */
export const ATTENDEE_QR_BLOCK_ID = -2;
