// Slide themes and bulletin templates: CRUD, built-in protection, background pictures, compiled theme CSS,
// and resolving which theme / template a service uses.
import { cleanRef } from './refs.ts';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import type { L10n, Service } from '../../shared/types.ts';
import {
  BLOCK_KINDS, DEFAULT_BULLETIN_OPTIONS, MAX_QR_TEXT, blockImageKey, normaliseBlockData, normaliseBulletinOptions,
  type BulletinBlock, type BulletinBlockKind, type BulletinOptions, type BulletinTemplate,
} from '../../shared/presentation.ts';
import {
  CssError, compileThemeCss, normaliseThemeVars, scopeCss, themeBgKey, themeBgUrl, type SlideTheme,
  type SlideThemeVars,
} from '../../shared/slide-theme.ts';
import { all, get, run, tx } from '../db.ts';
import { BadRequest, NotFound, table } from '../lib/table.ts';
import { PICTURE_TYPES, realType } from '../lib/image.ts';
import { getMeta, getSettings, setMeta, updateSettings } from './settings.ts';

export const slideThemes = table<SlideTheme>({
  name: 'slide_themes',
  cols: ['name', 'base', 'vars', 'css', 'sort', 'hidden', 'ref'],
  json: ['name', 'vars'],
  bool: ['hidden'],
  touch: true,
});

export const bulletinTemplates = table<BulletinTemplate>({
  name: 'bulletin_templates',
  cols: ['name', 'description', 'options', 'sort', 'hidden', 'ref'],
  json: ['name', 'description', 'options'],
  bool: ['hidden'],
  touch: true,
});

// ---------------------------------------------------------------- built-ins (stable key → id, kept in settings meta)

export interface Builtins {
  slide: Record<string, number>;
  bulletin: Record<string, number>;
}
export function builtins(): Builtins {
  try {
    const b = JSON.parse(getMeta('presentation_builtins') ?? '{}') as Partial<Builtins>;
    return { slide: b.slide ?? {}, bulletin: b.bulletin ?? {} };
  } catch {
    return { slide: {}, bulletin: {} };
  }
}
export const setBuiltins = (b: Builtins) => setMeta('presentation_builtins', JSON.stringify(b));
const keyOf = (kind: keyof Builtins, id: number) => Object.entries(builtins()[kind]).find(([, v]) => v === id)?.[0] ?? null;

const hasText = (l?: L10n) => !!l && Object.values(l).some((v) => v?.trim());
const nextSort = (tbl: string) => Math.max(0, get<{ s: number | null }>(`SELECT MAX(sort) s FROM ${tbl}`)?.s ?? 0) + 1;
const copyName = (n: L10n): L10n =>
  Object.fromEntries(Object.entries(n).filter(([, v]) => v?.trim()).map(([l, v]) => [l, l === 'zh' || l === 'zh-Hant' ? `${v}（副本）` : `${v} (copy)`]));

// ---------------------------------------------------------------- slide themes

function decorateTheme(t: SlideTheme): SlideTheme {
  return { ...t, vars: normaliseThemeVars(t.vars), builtin: keyOf('slide', t.id) };
}
export const listThemes = () => slideThemes.list('', [], 'sort, id').map(decorateTheme);
export const getTheme = (id: number) => decorateTheme(slideThemes.get(id));

/** Validate the custom CSS; a problem becomes a 400 with the line number. */
function checkCss(css: string) {
  try {
    scopeCss(css, 'check');
  } catch (e) {
    if (e instanceof CssError) throw new BadRequest(`Custom CSS — ${e.message}`);
    throw e;
  }
}
function checkVars(v: unknown, base?: SlideThemeVars): SlideThemeVars {
  try {
    return normaliseThemeVars(v, base);
  } catch (e) {
    throw new BadRequest((e as Error).message);
  }
}

export interface ThemeInput {
  name?: L10n;
  base?: 'dark' | 'light';
  vars?: Partial<SlideThemeVars>;
  css?: string;
}

export function createTheme(input: ThemeInput): SlideTheme {
  if (!hasText(input.name)) throw new BadRequest('Give the theme a name');
  const css = input.css ?? '';
  checkCss(css);
  const vars = { ...checkVars(input.vars), bg_image: null };
  const t = slideThemes.insert({ name: input.name, base: input.base ?? 'dark', vars, css: css || undefined, sort: nextSort('slide_themes') });
  return getTheme(t.id);
}

function assertEditableTheme(id: number) {
  slideThemes.get(id);
  if (keyOf('slide', id)) throw new BadRequest("Built-in themes can't be changed. Use Duplicate to make your own copy, then edit that.");
}

export function updateTheme(id: number, patch: ThemeInput): SlideTheme {
  assertEditableTheme(id);
  const cur = getTheme(id);
  if (patch.name !== undefined && !hasText(patch.name)) throw new BadRequest('Give the theme a name');
  if (patch.css !== undefined) checkCss(patch.css);
  // the background picture is managed by its own upload route, never by the client's vars
  const vars = patch.vars ? { ...checkVars(patch.vars, cur.vars), bg_image: cur.vars.bg_image } : undefined;
  // (the table helper stores '' as NULL, so an emptied CSS box is written directly)
  if (patch.css === '') run("UPDATE slide_themes SET css = '' WHERE id = ?", id);
  slideThemes.update(id, { name: patch.name, base: patch.base, css: patch.css || undefined, vars });
  return getTheme(id);
}

export function duplicateTheme(id: number): SlideTheme {
  const src = getTheme(id);
  return tx(() => {
    const t = slideThemes.insert({ name: copyName(src.name), base: src.base, vars: { ...src.vars, bg_image: null }, css: src.css || undefined, sort: nextSort('slide_themes') });
    const bg = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', themeBgKey(id));
    if (bg && src.vars.bg_image) {
      run(`INSERT OR REPLACE INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))`, themeBgKey(t.id), bg.mime, bg.data);
      slideThemes.update(t.id, { vars: { ...src.vars } });
    }
    return getTheme(t.id);
  });
}

export function deleteTheme(id: number) {
  const cur = slideThemes.get(id);
  if (keyOf('slide', id)) throw new BadRequest("Built-in templates can't be deleted. Archive it instead.");
  if (!cur.hidden) throw new BadRequest('Archive the template first; archived templates can then be deleted.');
  tx(() => {
    slideThemes.remove(id);
    run('DELETE FROM assets WHERE key = ?', themeBgKey(id));
  });
  if (getSettings().default_slide_theme_id === id) updateSettings({ default_slide_theme_id: null });
}

export function setThemeBackground(id: number, _declared: string, data: Buffer): SlideTheme {
  assertEditableTheme(id);
  // checked here, whoever calls (the route, an imported template file): stored as what its bytes are
  const mime = realType(data, PICTURE_TYPES, 'Upload a PNG, JPEG or WebP picture');
  const version = crypto.createHash('sha256').update(data).digest('base64url').slice(0, 12);
  tx(() => {
    run(
      `INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      themeBgKey(id), mime, data,
    );
    slideThemes.update(id, { vars: { ...getTheme(id).vars, bg_image: version } });
  });
  return getTheme(id);
}

export function removeThemeBackground(id: number): SlideTheme {
  assertEditableTheme(id);
  tx(() => {
    run('DELETE FROM assets WHERE key = ?', themeBgKey(id));
    slideThemes.update(id, { vars: { ...getTheme(id).vars, bg_image: null } });
  });
  return getTheme(id);
}

/** The compiled CSS for a theme: its settings as custom properties plus its scoped custom CSS. */
export function themeCss(id: number): string {
  const t = getTheme(id);
  const bg = t.vars.bg_image ? themeBgUrl(id, t.vars.bg_image) : null;
  return compileThemeCss(String(id), t.vars, t.css, bg);
}

/** A stored asset (theme background pictures). */
export const assetRow = (key: string) => get<{ mime: string; data: Uint8Array; updated_at: string }>('SELECT mime, data, updated_at FROM assets WHERE key = ?', key);

const ids = (tbl: string) => new Set(all<{ id: number }>(`SELECT id FROM ${tbl} ORDER BY sort, id`).map((r) => r.id));

/**
 * The theme a service projects with: its own choice → the church default → the built-in matching the old
 * dark/light setting (Ink / Papyrus) → the first theme. null when no themes exist.
 */
export function resolveSlideThemeId(svc: Pick<Service, 'slide_theme_id'> | null): number | null {
  const have = ids('slide_themes');
  if (svc?.slide_theme_id && have.has(svc.slide_theme_id)) return svc.slide_theme_id;
  const s = getSettings();
  if (s.default_slide_theme_id && have.has(s.default_slide_theme_id)) return s.default_slide_theme_id;
  const b = builtins().slide;
  const legacy = s.slide_theme === 'light' ? b.papyrus : b.ink;
  if (legacy && have.has(legacy)) return legacy;
  return [...have][0] ?? null;
}

// ---------------------------------------------------------------- bulletin templates

function decorateTemplate(t: BulletinTemplate): BulletinTemplate {
  return { ...t, options: normaliseBulletinOptions(t.options), builtin: keyOf('bulletin', t.id) };
}
export const listTemplates = () => bulletinTemplates.list('', [], 'sort, id').map(decorateTemplate);
export const getTemplate = (id: number) => decorateTemplate(bulletinTemplates.get(id));

export interface TemplateInput {
  name?: L10n;
  description?: L10n;
  options?: unknown;
}

export function createTemplate(input: TemplateInput): BulletinTemplate {
  if (!hasText(input.name)) throw new BadRequest('Give the template a name');
  const t = bulletinTemplates.insert({
    name: input.name, description: input.description ?? {}, options: normaliseBulletinOptions(input.options), sort: nextSort('bulletin_templates'),
  });
  return getTemplate(t.id);
}

export function updateTemplate(id: number, patch: TemplateInput): BulletinTemplate {
  const cur = getTemplate(id);
  if (cur.builtin) throw new BadRequest("Built-in templates can't be changed. Use Duplicate to make your own copy, then edit that.");
  if (patch.name !== undefined && !hasText(patch.name)) throw new BadRequest('Give the template a name');
  bulletinTemplates.update(id, {
    name: patch.name,
    description: patch.description,
    options: patch.options !== undefined ? normaliseBulletinOptions(patch.options, cur.options) : undefined,
  });
  return getTemplate(id);
}

export function duplicateTemplate(id: number): BulletinTemplate {
  const src = getTemplate(id);
  const t = bulletinTemplates.insert({ name: copyName(src.name), description: src.description, options: src.options, sort: nextSort('bulletin_templates') });
  return getTemplate(t.id);
}

export function deleteTemplate(id: number) {
  const cur = getTemplate(id);
  if (cur.builtin) throw new BadRequest("Built-in templates can't be deleted. Archive it instead.");
  if (!cur.hidden) throw new BadRequest('Archive the template first; archived templates can then be deleted.');
  bulletinTemplates.remove(id);
  if (getSettings().default_bulletin_template_id === id) updateSettings({ default_bulletin_template_id: null });
}

export interface ResolvedBulletin {
  template_id: number | null;
  name: L10n;
  options: BulletinOptions;
}

/** The template a service prints with: its own choice → the church default → "Full words booklet" → built-in defaults. */
export function resolveBulletinTemplate(svc: Pick<Service, 'bulletin_template_id'> | null): ResolvedBulletin {
  const s = getSettings();
  const candidates = [svc?.bulletin_template_id, s.default_bulletin_template_id, builtins().bulletin.full];
  for (const id of candidates) {
    if (!id) continue;
    const t = bulletinTemplates.find(id);
    if (t) return { template_id: t.id, name: t.name, options: normaliseBulletinOptions(t.options) };
  }
  return { template_id: null, name: { en: 'Full words booklet', zh: '完整歌词经文本' }, options: DEFAULT_BULLETIN_OPTIONS };
}

// ---------------------------------------------------------------- church defaults

/**
 * Hide a template from the pickers (or show it again). Services that already use it keep it. The church default
 * can't be hidden: choose another default first.
 */
export function setThemeHidden(id: number, hidden: boolean): SlideTheme {
  slideThemes.get(id);
  if (hidden && resolveSlideThemeId(null) === id) throw new BadRequest("This is the church default, so it can't be archived. Set another template as the church default first.");
  slideThemes.update(id, { hidden });
  return getTheme(id);
}
export function setTemplateHidden(id: number, hidden: boolean): BulletinTemplate {
  bulletinTemplates.get(id);
  if (hidden && resolveBulletinTemplate(null).template_id === id) throw new BadRequest("This is the church default, so it can't be archived. Set another template as the church default first.");
  bulletinTemplates.update(id, { hidden });
  return getTemplate(id);
}

export function setDefaults(p: { slide_theme_id?: number | null; bulletin_template_id?: number | null }) {
  if (p.slide_theme_id != null && !slideThemes.find(p.slide_theme_id)) throw new NotFound(`slide theme ${p.slide_theme_id} not found`);
  if (p.bulletin_template_id != null && !bulletinTemplates.find(p.bulletin_template_id)) throw new NotFound(`bulletin template ${p.bulletin_template_id} not found`);
  const patch: { default_slide_theme_id?: number | null; default_bulletin_template_id?: number | null } = {};
  if (p.slide_theme_id !== undefined) patch.default_slide_theme_id = p.slide_theme_id;
  if (p.bulletin_template_id !== undefined) patch.default_bulletin_template_id = p.bulletin_template_id;
  // a hidden template made the default comes back into the pickers
  if (p.slide_theme_id) slideThemes.update(p.slide_theme_id, { hidden: false });
  if (p.bulletin_template_id) bulletinTemplates.update(p.bulletin_template_id, { hidden: false });
  const s = updateSettings(patch);
  return {
    default_slide_theme_id: s.default_slide_theme_id,
    default_bulletin_template_id: s.default_bulletin_template_id,
    effective_slide_theme_id: resolveSlideThemeId(null),
    effective_bulletin_template_id: resolveBulletinTemplate(null).template_id,
  };
}

// ---------------------------------------------------------------- bulletin blocks (QR codes, pictures, notes)

export const bulletinBlocks = table<BulletinBlock>({
  name: 'bulletin_blocks',
  cols: ['kind', 'name', 'data', 'sort'],
  json: ['data'],
  touch: true,
});

const decorateBlock = (b: BulletinBlock): BulletinBlock => ({ ...b, data: normaliseBlockData(b.kind, b.data, b.data) });
export const listBlocks = () => bulletinBlocks.list('', [], 'sort, id').map(decorateBlock);
export const getBlock = (id: number) => decorateBlock(bulletinBlocks.get(id));

export interface BlockInput {
  kind?: BulletinBlockKind;
  name?: string;
  data?: unknown;
}

export function createBlock(input: BlockInput): BulletinBlock {
  const kind = input.kind;
  if (!kind || !BLOCK_KINDS.includes(kind)) throw new BadRequest('Choose a block type: QR code, picture or note');
  const name = input.name?.trim();
  if (!name) throw new BadRequest('Give the block a name');
  const b = bulletinBlocks.insert({ kind, name: name.slice(0, 120), data: normaliseBlockData(kind, input.data, { image: null }), sort: nextSort('bulletin_blocks') });
  return getBlock(b.id);
}

export function updateBlock(id: number, patch: BlockInput): BulletinBlock {
  const cur = getBlock(id);
  if (patch.kind && patch.kind !== cur.kind) throw new BadRequest("A block's type can't be changed — make a new block instead.");
  if (patch.name !== undefined && !patch.name.trim()) throw new BadRequest('Give the block a name');
  bulletinBlocks.update(id, {
    name: patch.name?.trim().slice(0, 120),
    data: patch.data !== undefined ? normaliseBlockData(cur.kind, patch.data, cur.data) : undefined,
  });
  return getBlock(id);
}

export function deleteBlock(id: number) {
  bulletinBlocks.get(id);
  tx(() => {
    bulletinBlocks.remove(id);
    run('DELETE FROM assets WHERE key = ?', blockImageKey(id));
  });
}

export function setBlockImage(id: number, _declared: string, data: Buffer): BulletinBlock {
  const cur = getBlock(id);
  if (cur.kind !== 'image') throw new BadRequest('Only picture blocks take an upload');
  // checked here, whoever calls (the route, a template or library file): stored as what its bytes are
  const mime = realType(data, PICTURE_TYPES, 'Upload a PNG, JPEG or WebP picture');
  const version = crypto.createHash('sha256').update(data).digest('base64url').slice(0, 12);
  tx(() => {
    run(
      `INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      blockImageKey(id), mime, data,
    );
    bulletinBlocks.update(id, { data: { ...cur.data, image: version } });
  });
  return getBlock(id);
}

export function removeBlockImage(id: number): BulletinBlock {
  const cur = getBlock(id);
  tx(() => {
    run('DELETE FROM assets WHERE key = ?', blockImageKey(id));
    bulletinBlocks.update(id, { data: { ...cur.data, image: null } });
  });
  return getBlock(id);
}

/** A QR code (error correction M, quiet zone 2) as SVG text or a PNG for Word / downloads. */
export async function qrSvg(text: string): Promise<string> {
  if (!text) throw new BadRequest('Type a web address or some text for the QR code');
  if (text.length > MAX_QR_TEXT) throw new BadRequest(`The QR text is too long (${MAX_QR_TEXT} characters at most)`);
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
}
export async function qrPng(text: string, width = 600): Promise<Buffer> {
  if (!text) throw new BadRequest('Type a web address or some text for the QR code');
  if (text.length > MAX_QR_TEXT) throw new BadRequest(`The QR text is too long (${MAX_QR_TEXT} characters at most)`);
  return QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 2, width });
}

/** Set or clear a slide / bulletin template's reference (also on built-in templates: it is only a name). */
export function setThemeRef(id: number, ref: unknown): SlideTheme {
  slideThemes.get(id);
  slideThemes.update(id, { ref: cleanRef('slide_template', ref, id) ?? null });
  return getTheme(id);
}
export function setTemplateRef(id: number, ref: unknown): BulletinTemplate {
  bulletinTemplates.get(id);
  bulletinTemplates.update(id, { ref: cleanRef('bulletin_template', ref, id) ?? null });
  return getTemplate(id);
}
