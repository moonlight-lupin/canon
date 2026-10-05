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
}

export const DEFAULT_VISITOR_FORM: VisitorFormSettings = {
  enabled: false,
  prayer: false,
  welcome: { en: 'Welcome! We are glad you joined us. Tell us a little about yourself.', zh: '欢迎您！很高兴您来参加聚会，请告诉我们一些关于您的资料。' },
  consent: {
    en: 'I agree that the church may keep these details to welcome me and get in touch, and will not share them outside the church.',
    zh: '我同意教会保存这些资料，用来欢迎及联络我，并不会向教会以外的人透露。',
  },
  days_after: 3,
};

/** One service's form: its link (token) and where its QR code is shown. */
export interface ServiceVisitorForm {
  /** the secret part of the form's link; absent = no form for this service */
  token?: string;
  /** print the QR code on the bulletin's back page */
  bulletin?: boolean;
  /** show the QR code on a slide after the Announcements item (else after the last item) */
  slides?: boolean;
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
  consent: boolean;
  lang: string | null;
}

export const CARD_LIMITS = { name: 120, contact: 200, source: 200, prayer: 1500 } as const;
/** The virtual block id used for the visitor-form QR on the bulletin and slides (real blocks have positive ids). */
export const VISITOR_QR_BLOCK_ID = -1;
