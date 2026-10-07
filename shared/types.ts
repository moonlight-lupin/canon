// Shared types used by the server, the web client and the MCP layer.

/**
 * Content language code (BCP-47 style): 'en', 'zh' (Simplified Chinese), 'zh-Hant', 'ms', 'ta', ...
 * The languages a church uses are configured in Settings → Languages; see shared/languages.ts.
 */
export type Lang = string;

/** A localised string: one entry per language that has a value. */
export type L10n = { [lang: string]: string | undefined };

/** a role's key (Settings → Roles & permissions); admin, editor and viewer are built in */
export type Role = string;

// ---------------------------------------------------------------- registers

export type MemberStatus = 'member' | 'regular' | 'visitor' | 'inactive' | 'transferred' | 'deceased';

export interface Household {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
}

export interface Person {
  /** home congregation */
  congregation_id?: number | null;
  id: number;
  first_name: string;
  last_name: string;
  /** Name in Chinese characters (or other script), e.g. 林明华 */
  native_name: string | null;
  preferred_name: string | null;
  gender: 'M' | 'F' | null;
  birth_date: string | null; // YYYY-MM-DD
  phone: string | null;
  email: string | null;
  address: string | null;
  household_id: number | null;
  household_role: 'head' | 'spouse' | 'child' | 'other' | null;
  status: MemberStatus;
  membership_date: string | null;
  baptism_date: string | null;
  baptism_type: 'infant' | 'adult' | null;
  profession_date: string | null;
  preferred_lang: Lang | null;
  /** honorific per language: Chinese titles follow the name (林明华弟兄), English ones precede it (Bro. Lim) */
  honorific: L10n | null;
  notes: string | null;
  /** the church's own fields (Settings → Member fields): key → value as text */
  custom?: Record<string, string>;
  created_at: string;
  updated_at: string;
  /** how many times it was saved (edit conflicts) */
  revision?: number;
  /** when the member's personal data was erased (PDPA): the row is an anonymous placeholder */
  erased_at?: string | null;
}

export type CoworkerCategory = 'pastor' | 'elder' | 'deacon' | 'ministry_staff' | 'admin_staff' | 'lay_leader';

export interface Coworker {
  id: number;
  person_id: number;
  position: string;
  category: CoworkerCategory;
  employment: 'full_time' | 'part_time' | 'volunteer';
  ministry_area: string | null;
  ordained: boolean;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
}

// ---------------------------------------------------------------- volunteers

export interface Team {
  id: number;
  name: L10n;
  description: string | null;
  color: string;
  sort: number;
}

export interface ServiceRole {
  id: number;
  team_id: number;
  name: L10n;
  needed: number;
  sort: number;
}

export interface Unavailability {
  id: number;
  person_id: number;
  start_date: string;
  end_date: string;
  reason: string | null;
}

export type AssignmentStatus = 'scheduled' | 'confirmed' | 'declined';

export interface Assignment {
  id: number;
  service_id: number;
  role_id: number;
  person_id: number;
  status: AssignmentStatus;
  notes: string | null;
}

// ---------------------------------------------------------------- library

export type SongCategory = 'hymn' | 'psalm' | 'song' | 'doxology' | 'response';

export interface Stanza {
  /** '1', '2', 'R' (refrain), 'C' (chorus), 'Amen' ... */
  label: string;
  text: L10n;
}

export interface Song {
  id: number;
  key: string | null;
  title: L10n;
  author: string | null;
  composer: string | null;
  tune: string | null;
  meter: string | null;
  year: number | null;
  category: SongCategory;
  psalm: number | null;
  public_domain: boolean;
  copyright: string | null;
  ccli: string | null;
  tags: string[];
  stanzas: Stanza[];
  /** Sing the refrain (label 'R') after every numbered stanza. */
  refrain_after_each: boolean;
  notes: string | null;
  /** where this song appears in the church's hymnals (joined from song_hymnals) */
  hymnals?: SongHymnalRef[];
}

/** A printed hymnbook, e.g. 赞美诗 Hymns of Praise (HP), Trinity Hymnal (TH). */
export interface Hymnal {
  id: number;
  name: L10n;
  /** short code shown before numbers, e.g. "HP" → "HP 123" */
  abbr: string;
  publisher: string | null;
  year: number | null;
  notes: string | null;
  sort: number;
}

export interface SongHymnalRef {
  hymnal_id: number;
  abbr: string;
  /** text, so "123a" or "S12" work */
  number: string;
}

/** One numbered part of a long text, e.g. Westminster Shorter Catechism Q.1. */
export interface TextPart {
  /** selection key, e.g. "1", "2", "I.1" */
  label: string;
  title?: L10n;
  /** responsive format like LiturgyText.body (L:/C:/A: lines) */
  body: L10n;
}

export type TextCategory =
  | 'call_to_worship'
  | 'invocation'
  | 'confession'
  | 'assurance'
  | 'creed'
  | 'catechism'
  | 'prayer'
  | 'sacrament'
  | 'benediction'
  | 'liturgy'
  | 'other';

/**
 * Liturgical text. Bodies may be responsive: a line starting with
 * "L: " is the leader, "C: " the congregation (rendered bold), "A: " all together.
 * Lines without a prefix are plain. Blank lines separate paragraphs / slides.
 */
export interface LiturgyText {
  id: number;
  key: string | null;
  category: TextCategory;
  title: L10n;
  body: L10n;
  source: string | null;
  tags: string[];
  public_domain: boolean;
  /**
   * Long texts (catechisms, confessions) are stored as numbered parts; a service item then
   * selects some of them via ServiceItem.stanzas (e.g. ["1","2","3"]). When parts is set,
   * `body` holds an optional introduction only.
   */
  parts: TextPart[] | null;
}

// ---------------------------------------------------------------- groups

export type GroupKind = 'committee' | 'fellowship' | 'cell_group' | 'sunday_school' | 'ministry' | 'other' | 'serving_team';

/** When a group meets, for creating its meetings ahead (0.12). every: weekly, every two weeks, or one weekday a month. */
export interface MeetingPattern {
  every?: 'week' | '2weeks' | 'month';
  /** 0 = Sunday … 6 = Saturday */
  weekday?: number;
  /** for 'month': 1–4 = first … fourth, 5 = last */
  nth?: number;
  time?: string;
  place?: string;
  /** how many weeks ahead to create meetings (0 = by hand only) */
  ahead_weeks?: number;
}

/** Committees (Session, Board of Deacons, Missions), fellowships 团契, cell groups 小组, ministries. */
export interface Group {
  congregation_id?: number | null;
  id: number;
  name: L10n;
  kind: GroupKind;
  description: string | null;
  color: string;
  /** free text, e.g. "Fridays 8pm, church hall" */
  meeting: string | null;
  active: boolean;
  sort: number;
  /** Sunday school classes: the pupils' ages */
  age_min?: number | null;
  age_max?: number | null;
  /** when the group meets, for creating its meetings ahead */
  pattern?: MeetingPattern;
}

export interface GroupMember {
  id: number;
  group_id: number;
  person_id: number;
  /** e.g. Chair, Secretary, Treasurer, Leader, Member */
  role: string | null;
  start_date: string | null;
  end_date: string | null;
  /** leads the group: a read-only account linked to this member can record the group's meetings */
  leads?: boolean;
}

// ---------------------------------------------------------------- services

export type ItemKind =
  | 'section'
  | 'song'
  | 'scripture'
  | 'text'
  | 'sermon'
  | 'prayer'
  | 'sacrament'
  | 'offering'
  | 'announcements'
  | 'music'
  | 'other';

export interface ServiceItem {
  id: number;
  service_id: number;
  position: number;
  kind: ItemKind;
  title: L10n;
  /** song id or text id depending on kind */
  ref_id: number | null;
  /** scripture reference, e.g. "Romans 8:28-39" */
  scripture_ref: string | null;
  /** labels to include: song stanzas, or text parts (catechism questions); null = all */
  stanzas: string[] | null;
  /** hymnal whose number is shown for a song (null = the first one the song has) */
  hymnal_id: number | null;
  /** bulletin: null = follow the bulletin template, 'full' = print the words, 'title' = title/reference only */
  bulletin_text: 'full' | 'title' | null;
  /** what the congregation does: stand 众立 / sit 众坐 / kneel; null = not printed */
  posture: Posture | null;
  /** scripture readings: Bible version per language, overriding the service / church default */
  bibles: Record<Lang, string>;
  /** QR codes / notes (bulletin blocks) projected on a slide after this item, e.g. PayNow during the offering */
  slide_blocks: number[];
  /** background picture for this item's slides (Library → Slide backgrounds); null = the slide template's */
  slide_background_id?: number | null;
  /** custom / pasted body text, overrides library text when set */
  body: L10n;
  duration_min: number;
  role_id: number | null;
  /** free-text leader, e.g. "Rev. Tan" when not tied to a role */
  leader: string | null;
  notes: string | null;
  in_bulletin: boolean;
  on_slides: boolean;
  /** a cover slide (title and who leads): null = content only, 'cover' = the cover only, 'both' = cover then content */
  slide_cover?: SlideCover | null;
}

export type SlideCover = 'cover' | 'both';

export type ServiceStatus = 'draft' | 'final';

export type Posture = 'stand' | 'sit' | 'kneel';

export interface Service {
  /** a service of worship, or a meeting of a group (fellowship, cell group, Sunday school class …) */
  kind?: 'service' | 'meeting';
  /** meetings: the group that meets (none for a one-off meeting) */
  group_id?: number | null;
  /** meetings: where it is held */
  place?: string | null;
  /** meetings: who leads it — a member (whose linked account can record the meeting) … */
  leader_id?: number | null;
  /** … or the name of someone outside the register */
  chair?: string | null;
  /** meetings: the topic (the passage is sermon_ref) */
  topic?: L10n;
  /** whether an offering is taken (services always; each meeting turns it on or off) */
  offering?: boolean;
  /** the congregation it belongs to (English / Chinese / … services of one church); null = the whole church */
  congregation_id?: number | null;
  /** a reference people choose, e.g. "EN-2026-12-25" (unique among services) */
  ref?: string | null;
  /** the visitor form's link and QR choices (shared/visitor-form.ts); set through its own endpoint */
  visitor_form?: { token?: string; bulletin?: boolean; slides?: boolean };
  /** the church's space it is held in (Settings → Spaces); double bookings show as clashes */
  space_id?: number | null;
  /** the attendees' bulletin link and its QR choices (server/repo/attendee-link.ts); set through its own endpoint */
  attendee?: { token?: string; bulletin?: boolean; slides?: boolean };
  id: number;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  title: L10n;
  service_type: string;
  preacher: string | null;
  sermon_title: L10n;
  sermon_ref: string | null;
  theme: L10n;
  /** languages printed/projected, in order. e.g. ['en','zh'] */
  languages: Lang[];
  status: ServiceStatus;
  notes: string | null;
  share_token: string | null;
  template_id: number | null;
  /** liturgical season override; null = computed from the date */
  season: Season | null;
  cover: CoverOptions;
  /** Bible version per language for this service, e.g. {en:'ESV'}; missing = church default */
  bibles: Record<Lang, string>;
  /** text for the bulletin template's weekly sections, keyed by section key (e.g. announcements, pastor_note) */
  bulletin_content: Record<string, L10n>;
  /** presentation choices; null = church default */
  slide_theme_id: number | null;
  bulletin_template_id: number | null;
  created_at: string;
  updated_at: string;
  /** how many times it was saved (edit conflicts) */
  revision?: number;
}

export type Season = 'advent' | 'christmas' | 'epiphany' | 'lent' | 'holy_week' | 'easter' | 'pentecost' | 'ordinary';

export interface CoverOptions {
  /** bulletin cover style; undefined = church default from settings */
  style?: 'plain' | 'cross' | 'logo' | 'verse';
  /** scripture reference for the "verse" style (verse of the week) */
  verse_ref?: string;
}

export interface ServiceFull extends Service {
  items: ServiceItem[];
  assignments: (Assignment & { person_name: string; role_name: L10n; team_id: number })[];
}

// ---------------------------------------------------------------- templates

/** Template item. Library items are referenced by `key` so templates survive re-seeding. */
export interface TemplateItem {
  kind: ItemKind;
  title: L10n;
  song_key?: string;
  text_key?: string;
  /** labels to include: song stanzas, or a text's parts (catechism questions, e.g. ["1","2","3","4"]); none = the usual */
  stanzas?: string[];
  scripture_ref?: string;
  body?: L10n;
  duration_min: number;
  /** role name in English, matched to a ServiceRole when the service is created */
  role?: string;
  leader?: string;
  notes?: string;
  in_bulletin?: boolean; // default true
  on_slides?: boolean; // default true for song/scripture/text, false otherwise
  posture?: Posture;
  bulletin_text?: 'full' | 'title';
  /** block names (matched when the service is created), shown on a slide after this item */
  slide_blocks?: string[];
  /** slide background picture, by its name in Library → Slide backgrounds */
  slide_bg?: string;
  slide_cover?: SlideCover;
}

export interface Template {
  congregation_id?: number | null;
  id: number;
  key: string | null;
  name: L10n;
  description: L10n;
  service_type: string;
  start_time: string;
  items: TemplateItem[];
  /** archived: left out of the pickers; services already using it keep it */
  hidden?: boolean;
  /** a reference people choose, e.g. "CN-10pmService" (unique among service templates) */
  ref?: string | null;
  /** the slide / bulletin template its new services start with (null = the church default) */
  slide_theme_id?: number | null;
  bulletin_template_id?: number | null;
  /** one of Canon's own templates (seeded): it can be archived, not deleted */
  builtin?: boolean;
}

// ---------------------------------------------------------------- MCP control

export type ModuleKey = 'members' | 'coworkers' | 'groups' | 'volunteers' | 'services' | 'library' | 'templates' | 'records' | 'contributions' | 'lending' | 'equipment' | 'admin';
export type ModuleAccess = 'off' | 'read' | 'write';
export type VisitorAccess = 'off' | 'names' | 'contact';
export const MODULES: ModuleKey[] = ['members', 'coworkers', 'groups', 'volunteers', 'services', 'library', 'templates', 'records', 'contributions', 'lending', 'equipment', 'admin'];
/** Modules only administrators' connections ever get (0.15.3: Administration). */
export const ADMIN_MODULES: ModuleKey[] = ['admin'];
/** Modules that live inside another: they are off whenever their parent is off. */
export const MODULE_PARENT: Partial<Record<ModuleKey, ModuleKey>> = { contributions: 'records' };
/** Modules agents may only ever read (offerings: agents never change money). */
export const READ_ONLY_MODULES: ModuleKey[] = ['contributions'];

/** The level an administrator's settings give a module, after nesting and read-only caps. */
export function configuredAccess(module: ModuleKey, modules: Partial<Record<ModuleKey, ModuleAccess>>): ModuleAccess {
  const parent = MODULE_PARENT[module];
  if (parent && configuredAccess(parent, modules) === 'off') return 'off';
  const lvl = modules[module] ?? 'off';
  return lvl === 'write' && READ_ONLY_MODULES.includes(module) ? 'read' : lvl;
}

export interface McpConfig {
  enabled: boolean;
  modules: Record<ModuleKey, ModuleAccess>;
  /** When false, member contact details, birth dates and addresses are redacted from MCP output. */
  /** members' contact details & birthdays (also co-workers' and households'): only while the Members register is on */
  expose_member_pii: boolean;
  /** new visitors on service records (only while Service records is on): none, names & follow-up, or with contact details */
  visitors: VisitorAccess;
  /** songs' sheet music (scans, photos, PDFs) — only while the Library is on; off by default (copies for the AI provider) */
  sheet_music: boolean;
}
