import { DEFAULT_VISITOR_FORM, type VisitorFormSettings } from '../../shared/visitor-form.ts';
import type { MemberField } from '../../shared/member-fields.ts';
import type { L10n, Lang, McpConfig } from '../../shared/types.ts';
import { langInfo } from '../../shared/languages.ts';
import { all, run } from '../db.ts';
import { logChange } from './changelog.ts';
import { DEFAULT_MODULES, type ModuleSwitches } from '../../shared/modules.ts';

export type PaperSize = 'a4-booklet' | 'a4' | 'a5' | 'letter-booklet' | 'letter';
export type CoverStyle = 'plain' | 'cross' | 'logo' | 'verse';

export interface SmtpSettings {
  host: string;
  port: number;
  /** true = implicit TLS (465); false = STARTTLS when offered (587) */
  secure: boolean;
  user: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  /** the password is stored separately (write-only, never returned by the API) */
  has_password?: boolean;
}

export interface Settings {
  church_name: L10n;
  church_address: string;
  church_contact: string;
  ccli_license: string;
  /** content languages the church uses, in display order; the first is the primary language */
  languages: Lang[];
  /** Bible translation per language, e.g. { en: 'KJV', zh: 'CUVS' } */
  bibles: Record<Lang, string>;
  /** languages printed/projected for new services (subset of `languages`, at most 3) */
  default_languages: Lang[];
  /** how multiple languages are laid out: side by side columns, or one after the other */
  bilingual_layout: 'parallel' | 'stacked';
  paper: PaperSize;
  slide_theme: 'dark' | 'light';
  default_start_time: string;
  /** show liturgical season colours on services, bulletins and slides */
  season_colours: boolean;
  bulletin_cover: CoverStyle;
  /** first-run onboarding finished (languages chosen, Bibles offered) */
  onboarded: boolean;
  /** database backups: folder ('' = ./backups), automatic schedule, how many to keep */
  /** encrypted: backups must be encrypted (a backup password was set); lib/backup-crypto.ts */
  backup: { dir: string; auto: 'off' | 'daily' | 'weekly'; keep: number; encrypted?: boolean };
  /** public https address for claude.ai / remote agents, e.g. https://canon.your-church.org ('' = none) */
  public_url: string;
  /** church defaults for presentation; null = built-in */
  default_slide_theme_id: number | null;
  default_bulletin_template_id: number | null;
  /** the service template New service starts from; null = the first one */
  default_service_template_id: number | null;
  /** service records: the currency counted and the funds offerings go to */
  offering: { currency: string; funds: string[]; signing?: 'paper' | 'screen'; min_counters?: number; /** on screen: counters approve from their own accounts */ own_accounts?: boolean };
  /** Settings → Visitor form (see shared/visitor-form.ts) */
  visitor_form: VisitorFormSettings;
  /** optional parts of Canon switched on or off (shared/modules.ts) */
  modules: ModuleSwitches;
  /** the lending library's rules (0.15) */
  lending: {
    loan_days: number; max_renewals: number; remind_days_before: number; send_reminders: boolean;
    /** members borrow, renew and return on their phones (only while its gates pass: repo/lending-self.ts) */
    self_service: boolean;
    /** the rules were saved at least once (a gate for self-service) */
    rules_saved: boolean;
  };
  /** Settings → Member fields: the church's own fields on the member register (shared/member-fields.ts) */
  member_fields: MemberField[];
  /** Settings → Security & privacy: what an administrator confirmed (Canon cannot see it), e.g. that the disk is encrypted */
  security: { disk_encryption: boolean; /** administrators must use two-step sign-in */ require_admin_2fa?: boolean; /** every account must */ require_all_2fa?: boolean };
  /** how many months the change log and the AI activity log keep (0 = everything) */
  /** months to keep logs (0 = all); visitors' contact details erased after visitor_contact_months; records archived after archive_years */
  retention: {
    change_log_months: number; mcp_audit_months: number; visitor_contact_months: number; archive_years: number;
    /** log entries (change log, AI activity, record views) archived after this many years; unset = as records, 0 = never */
    log_archive_years?: number | null;
  };
  /** Canon sits behind a tunnel / reverse proxy: honour X-Forwarded-* headers */
  trust_proxy: boolean;
  smtp: SmtpSettings;
  mcp: McpConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  church_name: { en: 'Our Church', zh: '我们的教会' },
  church_address: '',
  church_contact: '',
  ccli_license: '',
  languages: ['en', 'zh'],
  bibles: { en: 'KJV', zh: 'CUVS', 'zh-Hant': 'CUVT' },
  default_languages: ['en', 'zh'],
  bilingual_layout: 'parallel',
  paper: 'a4-booklet',
  slide_theme: 'dark',
  default_start_time: '10:00',
  season_colours: true,
  bulletin_cover: 'cross',
  onboarded: false,
  backup: { dir: '', auto: 'weekly', keep: 8 },
  public_url: '',
  default_slide_theme_id: null,
  default_bulletin_template_id: null,
  default_service_template_id: null,
  retention: { change_log_months: 24, mcp_audit_months: 12, visitor_contact_months: 24, archive_years: 5 },
  offering: { currency: 'SGD', funds: ['General', 'Missions', 'Building'], signing: 'paper', min_counters: 2 },
  visitor_form: DEFAULT_VISITOR_FORM,
  modules: DEFAULT_MODULES,
  lending: { loan_days: 21, max_renewals: 2, remind_days_before: 3, send_reminders: false, self_service: false, rules_saved: false },
  member_fields: [],
  security: { disk_encryption: false, require_admin_2fa: false, require_all_2fa: false },
  trust_proxy: false,
  smtp: { host: '', port: 587, secure: false, user: '', from_name: '', from_email: '', reply_to: '' },
  mcp: {
    enabled: false,
    modules: { members: 'off', coworkers: 'read', groups: 'read', volunteers: 'read', services: 'write', library: 'write', templates: 'read', records: 'off', contributions: 'off', lending: 'off', equipment: 'off' },
    expose_member_pii: false,
    visitors: 'names',
  },
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  const rows = all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
  const raw: Record<string, unknown> = {};
  for (const r of rows) {
    if (r.key.startsWith('_')) continue; // internal meta values (getMeta) are raw strings, not JSON settings
    raw[r.key] = JSON.parse(r.value);
    if (r.key in s) s[r.key] = raw[r.key];
  }
  const out = s as unknown as Settings;
  // v0.1 stored one Bible per language as bible_en / bible_zh
  if (!('bibles' in raw)) {
    out.bibles = { ...DEFAULT_SETTINGS.bibles };
    if (typeof raw.bible_en === 'string') out.bibles.en = raw.bible_en;
    if (typeof raw.bible_zh === 'string') out.bibles.zh = raw.bible_zh;
  }
  // v0.1 churches were set up before onboarding existed
  if (!('onboarded' in raw) && 'church_name' in raw) out.onboarded = true;
  out.mcp = { ...DEFAULT_SETTINGS.mcp, ...out.mcp, modules: { ...DEFAULT_SETTINGS.mcp.modules, ...out.mcp.modules } };
  // before 0.15.1 one switch shared every contact detail: visitors' followed it
  if (!(raw.mcp as { visitors?: string } | undefined)?.visitors) out.mcp.visitors = out.mcp.expose_member_pii ? 'contact' : 'names';
  out.smtp = { ...DEFAULT_SETTINGS.smtp, ...out.smtp, has_password: !!getMeta('smtp_password') };
  out.backup = { ...DEFAULT_SETTINGS.backup, ...out.backup };
  out.retention = { ...DEFAULT_SETTINGS.retention, ...out.retention };
  out.visitor_form = { ...DEFAULT_SETTINGS.visitor_form, ...out.visitor_form };
  out.modules = { ...DEFAULT_MODULES, ...out.modules };
  out.lending = { ...DEFAULT_SETTINGS.lending, ...out.lending };
  out.default_languages = out.default_languages.filter((l) => out.languages.includes(l));
  if (!out.default_languages.length) out.default_languages = out.languages.slice(0, 2);
  cache = out;
  return out;
}

/** Forget the cached settings (after the database was replaced by a restored backup). */
export function clearSettingsCache() {
  cache = null;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const before = getSettings();
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
    const value = k === 'smtp' ? { ...(v as SmtpSettings), has_password: undefined } : v;
    run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, JSON.stringify(value));
  }
  cache = null;
  const after = getSettings();
  // change log (only when someone is making the change; never any password)
  const pick = (s: Settings) => Object.fromEntries(Object.keys(patch).filter((k) => !/password/i.test(k)).map((k) => [k, k === 'smtp' ? { ...s.smtp, has_password: undefined } : s[k as keyof Settings]]));
  logChange({ entity: 'settings', entity_id: null, action: 'update', before: pick(before), after: pick(after) });
  return after;
}

/** Bible translation configured for a language (falls back to the catalog's first PD Bible). */
export function bibleFor(lang: Lang): string | undefined {
  return getSettings().bibles[lang] ?? langInfo(lang).bibles[0]?.code;
}

/** Raw internal key/value store for things that aren't user settings (e.g. seed version). */
export function getMeta(key: string): string | undefined {
  return all<{ value: string }>('SELECT value FROM settings WHERE key = ?', `_${key}`)[0]?.value;
}
export function setMeta(key: string, value: string) {
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', `_${key}`, value);
  cache = null;
}
export function deleteMeta(key: string) {
  run('DELETE FROM settings WHERE key = ?', `_${key}`);
  cache = null;
}
