// Input validation schemas shared by the REST API and the MCP tools.
import { z } from 'zod';
import { LANG_CODE_RE, MAX_SERVICE_LANGS } from './languages.ts';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const time = z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM');
const optDate = date.nullable().optional();
const optStr = z.string().max(4000).nullable().optional();

/** Localised text: { "en": "...", "zh": "...", "zh-Hant": "...", ... } */
export const L10nSchema = z.record(z.string().regex(LANG_CODE_RE, 'language code'), z.string().max(20000));
export const LangSchema = z.string().regex(LANG_CODE_RE, 'language code');

export const HouseholdInput = z.object({
  name: z.string().min(1).max(200),
  address: optStr,
  phone: optStr,
  notes: optStr,
});

export const PersonInput = z.object({
  first_name: z.string().min(1).max(200),
  last_name: z.string().max(200).optional(),
  native_name: optStr,
  preferred_name: optStr,
  gender: z.enum(['M', 'F']).nullable().optional(),
  birth_date: optDate,
  phone: optStr,
  email: z.string().max(320).nullable().optional(),
  address: optStr,
  household_id: z.number().int().nullable().optional(),
  household_role: z.enum(['head', 'spouse', 'child', 'other']).nullable().optional(),
  status: z.enum(['member', 'regular', 'visitor', 'inactive', 'transferred', 'deceased']).optional(),
  membership_date: optDate,
  baptism_date: optDate,
  baptism_type: z.enum(['infant', 'adult']).nullable().optional(),
  profession_date: optDate,
  preferred_lang: LangSchema.nullable().optional(),
  honorific: L10nSchema.nullable().optional(),
  notes: optStr,
});

export const CoworkerInput = z.object({
  person_id: z.number().int(),
  position: z.string().min(1).max(200),
  category: z.enum(['pastor', 'elder', 'deacon', 'ministry_staff', 'admin_staff', 'lay_leader']),
  employment: z.enum(['full_time', 'part_time', 'volunteer']).optional(),
  ministry_area: optStr,
  ordained: z.boolean().optional(),
  start_date: optDate,
  end_date: optDate,
  notes: optStr,
});

export const TeamInput = z.object({
  name: L10nSchema,
  description: optStr,
  color: z.string().max(20).optional(),
  sort: z.number().int().optional(),
});
export const RoleInput = z.object({
  team_id: z.number().int(),
  name: L10nSchema,
  needed: z.number().int().min(0).max(50).optional(),
  sort: z.number().int().optional(),
});
export const UnavailabilityInput = z.object({
  person_id: z.number().int(),
  start_date: date,
  end_date: date,
  reason: optStr,
});

export const StanzaSchema = z.object({ label: z.string().max(20), text: L10nSchema });
export const SongInput = z.object({
  key: z.string().max(100).nullable().optional(),
  title: L10nSchema,
  author: optStr,
  composer: optStr,
  tune: optStr,
  meter: optStr,
  year: z.number().int().nullable().optional(),
  category: z.enum(['hymn', 'psalm', 'song', 'doxology', 'response']).optional(),
  psalm: z.number().int().min(1).max(150).nullable().optional(),
  public_domain: z.boolean().optional(),
  copyright: optStr,
  ccli: optStr,
  tags: z.array(z.string().max(50)).optional(),
  stanzas: z.array(StanzaSchema).optional(),
  refrain_after_each: z.boolean().optional(),
  notes: optStr,
});

export const TextCategorySchema = z.enum([
  'call_to_worship', 'invocation', 'confession', 'assurance', 'creed', 'catechism',
  'prayer', 'sacrament', 'benediction', 'liturgy', 'other',
]);
export const TextPartSchema = z.object({
  label: z.string().min(1).max(20),
  title: L10nSchema.optional(),
  body: L10nSchema,
});
export const TextInput = z.object({
  key: z.string().max(100).nullable().optional(),
  category: TextCategorySchema,
  title: L10nSchema,
  body: L10nSchema,
  source: optStr,
  tags: z.array(z.string().max(50)).optional(),
  public_domain: z.boolean().optional(),
  parts: z.array(TextPartSchema).max(500).nullable().optional(),
});

export const HymnalInput = z.object({
  name: L10nSchema,
  abbr: z.string().min(1).max(12),
  publisher: optStr,
  year: z.number().int().nullable().optional(),
  notes: optStr,
  sort: z.number().int().optional(),
});
/** Where a song appears: [{ hymnal_id, number }] */
export const SongHymnalsInput = z.array(z.object({ hymnal_id: z.number().int(), number: z.string().min(1).max(12) })).max(50);

export const GroupKindSchema = z.enum(['committee', 'fellowship', 'cell_group', 'ministry', 'other']);
export const GroupInput = z.object({
  name: L10nSchema,
  kind: GroupKindSchema,
  description: optStr,
  color: z.string().max(20).optional(),
  meeting: optStr,
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
});
export const GroupMemberInput = z.object({
  person_id: z.number().int(),
  role: z.string().max(100).nullable().optional(),
  start_date: optDate,
  end_date: optDate,
});
export const TeamMemberInput = z.object({ person_id: z.number().int(), is_leader: z.boolean().optional() });

export const ItemKindSchema = z.enum([
  'section', 'song', 'scripture', 'text', 'sermon', 'prayer', 'sacrament', 'offering', 'announcements', 'music', 'other',
]);

export const ServiceItemInput = z.object({
  kind: ItemKindSchema,
  title: L10nSchema.optional(),
  ref_id: z.number().int().nullable().optional(),
  scripture_ref: z.string().max(200).nullable().optional(),
  stanzas: z.array(z.string()).nullable().optional(),
  hymnal_id: z.number().int().nullable().optional(),
  bulletin_text: z.enum(['full', 'title']).nullable().optional(),
  posture: z.enum(['stand', 'sit', 'kneel']).nullable().optional(),
  bibles: z.record(LangSchema, z.string().max(20)).optional(),
  slide_blocks: z.array(z.number().int()).max(6).optional(),
  body: L10nSchema.optional(),
  duration_min: z.number().min(0).max(240).optional(),
  role_id: z.number().int().nullable().optional(),
  leader: optStr,
  notes: optStr,
  in_bulletin: z.boolean().optional(),
  on_slides: z.boolean().optional(),
});

export const ServiceInput = z.object({
  date,
  start_time: time.optional(),
  title: L10nSchema.optional(),
  service_type: z.string().max(50).optional(),
  preacher: optStr,
  sermon_title: L10nSchema.optional(),
  sermon_ref: z.string().max(200).nullable().optional(),
  theme: L10nSchema.optional(),
  languages: z.array(LangSchema).min(1).max(MAX_SERVICE_LANGS).optional(),
  status: z.enum(['draft', 'final']).optional(),
  notes: optStr,
  season: z.enum(['advent', 'christmas', 'epiphany', 'lent', 'holy_week', 'easter', 'pentecost', 'ordinary']).nullable().optional(),
  cover: z.object({ style: z.enum(['plain', 'cross', 'logo', 'verse']).optional(), verse_ref: z.string().max(200).optional() }).optional(),
  slide_theme_id: z.number().int().nullable().optional(),
  bibles: z.record(LangSchema, z.string().max(20)).optional(),
  bulletin_template_id: z.number().int().nullable().optional(),
});

export const TemplateItemSchema = z.object({
  kind: ItemKindSchema,
  title: L10nSchema,
  song_key: z.string().optional(),
  text_key: z.string().optional(),
  scripture_ref: z.string().optional(),
  body: L10nSchema.optional(),
  duration_min: z.number().min(0).max(240),
  role: z.string().optional(),
  leader: z.string().optional(),
  notes: z.string().optional(),
  in_bulletin: z.boolean().optional(),
  on_slides: z.boolean().optional(),
  posture: z.enum(['stand', 'sit', 'kneel']).optional(),
  bulletin_text: z.enum(['full', 'title']).optional(),
  slide_blocks: z.array(z.string().max(100)).max(6).optional(),
});
export const TemplateInput = z.object({
  key: z.string().max(100).nullable().optional(),
  name: L10nSchema,
  description: L10nSchema.optional(),
  service_type: z.string().max(50).optional(),
  start_time: time.optional(),
  items: z.array(TemplateItemSchema).optional(),
});

export const McpConfigSchema = z.object({
  enabled: z.boolean(),
  modules: z.object({
    members: z.enum(['off', 'read', 'write']),
    coworkers: z.enum(['off', 'read', 'write']),
    groups: z.enum(['off', 'read', 'write']),
    volunteers: z.enum(['off', 'read', 'write']),
    services: z.enum(['off', 'read', 'write']),
    library: z.enum(['off', 'read', 'write']),
    templates: z.enum(['off', 'read', 'write']),
  }),
  expose_member_pii: z.boolean(),
});
