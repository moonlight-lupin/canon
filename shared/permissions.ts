// Roles and permissions (0.13): one model for the web app, the server and AI agents.
//
// A role gives each module none / read / edit, plus a few powers that cut across modules: seeing members' contact
// details and notes, seeing fields marked sensitive, and reopening verified cash counts. Canon ships ready-made roles
// churches recognise; an administrator can change them (not the Administrator role) or add their own.
//
// Which module a request belongs to is decided here, once, from its path (routeAccess): the server's sign-in gate
// checks every request against it, and the web app uses the same table to know whether the page it shows may be
// edited. A path that is in no module is for administrators only (fail closed).
import type { L10n } from './types.ts';

export type Access = 'none' | 'read' | 'edit';
export const PERM_MODULES = ['services', 'templates', 'library', 'volunteers', 'members', 'coworkers', 'groups', 'meetings', 'records', 'contributions', 'lending', 'equipment'] as const;
export type PermModule = (typeof PERM_MODULES)[number];

export const MODULE_LABEL: Record<PermModule, string> = {
  services: 'Services', templates: 'Templates', library: 'Library', volunteers: 'Volunteers and rota', members: 'Members',
  coworkers: 'Co-workers', groups: 'Groups', meetings: 'Meetings and calendar', records: 'Service records and reports', contributions: 'Offerings',
  lending: 'Lending library', equipment: 'Asset register',
};

export interface RoleDef {
  key: string;
  name: L10n;
  description: L10n;
  /** shipped with Canon (can be changed, not deleted) */
  builtin: boolean;
  /** everything, including settings, accounts and roles */
  admin: boolean;
  access: Record<PermModule, Access>;
  /** members' phone, e-mail, address, notes, reasons for absence and birth year */
  member_details: boolean;
  /** the church's own member fields marked sensitive */
  sensitive_fields: boolean;
  /** reopen a verified cash count, delete a service record */
  reopen_counts: boolean;
  sort: number;
}

const all = (a: Access): Record<PermModule, Access> => Object.fromEntries(PERM_MODULES.map((m) => [m, a])) as Record<PermModule, Access>;
const with_ = (base: Access, over: Partial<Record<PermModule, Access>>) => ({ ...all(base), ...over });

/** The ready-made roles. admin, editor and viewer are the three roles accounts had before 0.13 (same access). */
export const BUILTIN_ROLES: Omit<RoleDef, 'builtin'>[] = [
  {
    key: 'admin', name: { en: 'Administrator', zh: '管理员' }, description: { en: 'Everything, including settings, accounts and roles.', zh: '所有功能，包括设置、帐户和角色。' },
    admin: true, access: all('edit'), member_details: true, sensitive_fields: true, reopen_counts: true, sort: 0,
  },
  {
    key: 'pastor', name: { en: 'Pastor / Elder', zh: '牧者 / 长老' }, description: { en: 'Pastoral care and worship: members with their details and notes, groups, meetings and services; sees the records and offerings.', zh: '牧养与崇拜：会友及其资料和备注、群组、聚会活动和主日聚会；可查看记录和奉献。' },
    admin: false, access: with_('edit', { templates: 'read', volunteers: 'read', records: 'read', contributions: 'read', equipment: 'read' }), member_details: true, sensitive_fields: true, reopen_counts: false, sort: 10,
  },
  {
    key: 'editor', name: { en: 'Editor', zh: '编辑' }, description: { en: 'Plans services and edits the registers, library, rota and records (but not settings or accounts).', zh: '策划聚会，编辑名册、资料库、事奉表和记录（但不包括设置或帐户）。' },
    admin: false, access: all('edit'), member_details: true, sensitive_fields: true, reopen_counts: false, sort: 20,
  },
  {
    key: 'planner', name: { en: 'Service planner', zh: '聚会策划' }, description: { en: 'Services, templates, the library and the rota; members by name.', zh: '主日聚会、模板、资料库和事奉表；会友只看姓名。' },
    admin: false, access: with_('read', { services: 'edit', templates: 'edit', library: 'edit', volunteers: 'edit', contributions: 'none' }), member_details: false, sensitive_fields: false, reopen_counts: false, sort: 30,
  },
  {
    key: 'treasurer', name: { en: 'Treasurer', zh: '财务' }, description: { en: 'Service records and offerings: enters, verifies and reopens cash counts; reads the rest.', zh: '聚会记录和奉献：输入、核实和重开现金点算；其余只能查看。' },
    admin: false, access: with_('read', { records: 'edit', contributions: 'edit', equipment: 'edit' }), member_details: false, sensitive_fields: false, reopen_counts: true, sort: 40,
  },
  {
    key: 'secretary', name: { en: 'Secretary', zh: '文书' }, description: { en: 'The registers: members, co-workers, groups, meetings and service records (not offerings).', zh: '名册：会友、同工、群组、聚会活动和聚会记录（不包括奉献）。' },
    admin: false, access: with_('read', { members: 'edit', coworkers: 'edit', groups: 'edit', meetings: 'edit', records: 'edit', contributions: 'none', lending: 'edit' }), member_details: true, sensitive_fields: false, reopen_counts: false, sort: 50,
  },
  {
    key: 'viewer', name: { en: 'Read-only', zh: '只读' }, description: { en: 'Can view and print; no money, no members’ contact details or notes. Linked to a member who leads a group or a meeting, can record those meetings.', zh: '可查看和打印；不看奉献、会友联络资料或备注。若连结到带领某个群组或聚会活动的会友，可记录那些聚会活动。' },
    admin: false, access: with_('read', { contributions: 'none' }), member_details: false, sensitive_fields: false, reopen_counts: false, sort: 90,
  },
  {
    key: 'guest', name: { en: 'External guest (read-only)', zh: '外部访客（只读）' }, description: { en: 'For someone outside the church, such as an auditor: reads what this role allows, never members’ contact details or notes, and changes nothing. The only account that isn’t linked to a member.', zh: '供教会以外的人使用，例如审计员：只能查看此角色允许的内容，绝不看会友联络资料或备注，也不能更改任何内容。唯一不必连结到会友的帐户。' },
    admin: false, access: with_('none', { services: 'read', library: 'read', records: 'read', contributions: 'read', equipment: 'read' }), member_details: false, sensitive_fields: false, reopen_counts: false, sort: 95,
  },
  {
    key: 'librarian', name: { en: 'Librarian', zh: '图书管理员' }, description: { en: 'The lending library: the catalogue, copies and labels, lending and returns, reminders. Borrowers by name only.', zh: '图书馆：目录、副本与标签、借出与归还、提醒。借阅者只看姓名。' },
    admin: false, access: with_('none', { lending: 'edit' }), member_details: false, sensitive_fields: false, reopen_counts: false, sort: 60,
  },
  {
    key: 'keeper', name: { en: 'Asset keeper', zh: '资产管理员' }, description: { en: 'The asset register: equipment, where it is and who looks after it, photos and receipts, maintenance and labels.', zh: '资产登记：设备、存放位置与负责人、照片与收据、维修保养和标签。' },
    admin: false, access: with_('none', { equipment: 'edit' }), member_details: false, sensitive_fields: false, reopen_counts: false, sort: 70,
  },
];

/** The external guest role: read-only, and the only role whose accounts are not linked to a member. */
export const GUEST_ROLE = 'guest';

export const rank = (a: Access) => (a === 'edit' ? 2 : a === 'read' ? 1 : 0);
/** Does this role give at least this access to this module? */
export const allows = (r: Pick<RoleDef, 'admin' | 'access'> | null | undefined, m: PermModule, need: Access) =>
  !!r && (r.admin || rank(r.access?.[m] ?? 'none') >= rank(need));

/**
 * Who may make a request, from its path (relative to /api, after sign-in): a module (GET = read, anything else =
 * edit), 'signed_in' (any account), or 'admin'. Paths that need a closer look (a service that is a meeting, a CSV
 * import by entity, a record's money) are refined where they are handled. Order matters: first match wins.
 */
type Rule = [RegExp, PermModule | 'signed_in' | 'admin' | 'csv'];
const RULES: Rule[] = [
  [/^\/congregations\/\d+$/, 'admin'],
  [/^\/people\/\d+\/(personal-data|erase)$/, 'admin'],
  [/^\/me\//, 'signed_in'],
  [/^\/(me|settings|dashboard|calendar|about|congregations|presentation\/defaults|reports\/archived-years)$/, 'signed_in'],
  [/^\/(users|access-roles|modules|backups|archives|security|member-views|storage|change-log|log-retention|mcp|email\/(settings|test)|offering-settings)(\/|\.|$)/, 'admin'],
  // read by editors' screens; changed by administrators (the route says so)
  [/^\/visitor-form-settings$/, 'records'],
  [/^\/services\/\d+\/record(\/|$)/, 'records'],
  [/^\/services\/\d+\/(visitor-form|visitor-cards)(\/|$)/, 'records'],
  [/^\/visitor-cards(\/|$)/, 'records'],
  [/^\/services\/\d+\/(assignments|reminders|warnings)(\/|$)/, 'volunteers'],
  [/^\/(services|items|meetings-of)(\/|$)/, 'services'],
  [/^\/(meetings|events)(\/|$)/, 'meetings'],
  [/^\/groups\/\d+\/meetings-ahead$/, 'meetings'],
  [/^\/(templates|templates-default|slide-themes|bulletin-templates|bulletin-blocks|backgrounds|template-files)(\/|$)/, 'templates'],
  [/^\/(songs|texts|hymnals|library|bible)(\/|$)/, 'library'],
  [/^\/(rota|roles|teams|unavailability|assignments|email\/log)(\/|$)/, 'volunteers'],
  [/^\/lending(\/|$)/, 'lending'],
  [/^\/equipment(\/|$)/, 'equipment'],
  [/^\/(people|households|member-fields)(\/|\.|$)/, 'members'],
  [/^\/coworkers(\/|$)/, 'coworkers'],
  [/^\/(groups|group-members)(\/|$)/, 'groups'],
  [/^\/reports\/offerings$/, 'contributions'],
  [/^\/reports\/serving$/, 'volunteers'],
  [/^\/reports\/(songs|scripture)$/, 'services'],
  [/^\/reports\/membership$/, 'members'],
  [/^\/(records|reports)(\/|$)/, 'records'],
  [/^\/csv(\/|$)/, 'csv'],
];

export type RouteNeed = { kind: 'signed_in' } | { kind: 'admin' } | { kind: 'module'; module: PermModule; access: Access } | { kind: 'csv'; access: Access };

export function routeAccess(method: string, path: string): RouteNeed {
  const access: Access = method === 'GET' || method === 'HEAD' ? 'read' : 'edit';
  for (const [re, who] of RULES) {
    if (!re.test(path)) continue;
    if (who === 'signed_in' || who === 'admin') return { kind: who };
    if (who === 'csv') return { kind: 'csv', access };
    return { kind: 'module', module: who, access };
  }
  return { kind: 'admin' };
}

/** Whether a path has a rule of its own (tests: a route without one would quietly be for administrators only). */
export const hasRule = (path: string) => RULES.some(([re]) => re.test(path));

/** The CSV import/export entities and the module each belongs to. */
export const CSV_MODULE: Record<string, PermModule> = {
  members: 'members', coworkers: 'coworkers', groups: 'groups', songs: 'library', texts: 'library', hymnal_index: 'library',
  templates: 'templates', team_members: 'volunteers', unavailability: 'volunteers', books: 'lending', equipment: 'equipment',
};

/** The web app's pages and the module whose access decides whether they may be edited. */
export function pageModule(pathname: string): PermModule | 'admin' | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p.startsWith('/services')) return 'services';
  if (p.startsWith('/meetings') || p.startsWith('/calendar')) return 'meetings';
  if (p.startsWith('/records') || p.startsWith('/reports')) return 'records';
  if (p.startsWith('/members')) return 'members';
  if (p.startsWith('/coworkers')) return 'coworkers';
  if (p.startsWith('/groups')) return 'groups';
  if (p.startsWith('/volunteers')) return 'volunteers';
  if (p.startsWith('/lending')) return 'lending';
  if (p.startsWith('/equipment')) return 'equipment';
  if (p.startsWith('/library')) return 'library';
  if (/^\/(templates|presentation|bulletin-templates|slide-templates)/.test(p)) return 'templates';
  if (p.startsWith('/settings')) return 'admin';
  return null;
}
