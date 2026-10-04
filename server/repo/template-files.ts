// Slide and bulletin templates as a single file, to copy them to another computer or share them with another church.
// A file carries everything the template needs: a slide template its background picture, a bulletin template the
// QR codes / pictures / notes its page layout prints. Importing always makes a new template (nothing is overwritten);
// QR codes and notes are matched by name and type with the Library's, and added when missing.
import type { BulletinBlock, BulletinTemplate, SlideTheme } from '../../shared/presentation.ts';
import { blockImageKey, themeBgKey } from '../../shared/presentation.ts';
import { BadRequest } from '../lib/table.ts';
import {
  assetRow, createBlock, createTemplate, createTheme, getTemplate, getTheme, listBlocks, setBlockImage, setThemeBackground,
} from './presentation.ts';

export const TEMPLATE_FILE_VERSION = 1;
const MAX_PICTURE = 5 * 1024 * 1024;
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface Picture { mime: string; data: string } // base64
interface FileBlock { ref: number; kind: BulletinBlock['kind']; name: string; data: unknown; picture?: Picture }

export interface SlideTemplateFile {
  canon: 'slide-template';
  version: number;
  exported_at: string;
  template: { name: SlideTheme['name']; base: SlideTheme['base']; vars: Partial<SlideTheme['vars']>; css: string };
  background?: Picture;
}
export interface BulletinTemplateFile {
  canon: 'bulletin-template';
  version: number;
  exported_at: string;
  template: { name: BulletinTemplate['name']; description: BulletinTemplate['description']; options: BulletinTemplate['options'] };
  blocks: FileBlock[];
}
export type TemplateFile = SlideTemplateFile | BulletinTemplateFile;

const picture = (key: string): Picture | undefined => {
  const a = assetRow(key);
  return a?.data?.length ? { mime: a.mime, data: Buffer.from(a.data).toString('base64') } : undefined;
};

export function exportSlideTemplate(id: number): SlideTemplateFile {
  const t = getTheme(id);
  const { bg_image: _bg, ...vars } = t.vars;
  return {
    canon: 'slide-template', version: TEMPLATE_FILE_VERSION, exported_at: new Date().toISOString(),
    template: { name: t.name, base: t.base, vars, css: t.css ?? '' },
    background: t.vars.bg_image ? picture(themeBgKey(id)) : undefined,
  };
}

export function exportBulletinTemplate(id: number): BulletinTemplateFile {
  const t = getTemplate(id);
  const used = new Set(t.options.page_layout.flatMap((s) => s.blocks ?? []));
  const blocks = listBlocks().filter((b) => used.has(b.id)).map((b): FileBlock => ({
    ref: b.id, kind: b.kind, name: b.name, data: { ...b.data, image: undefined },
    picture: b.kind === 'image' && b.data.image ? picture(blockImageKey(b.id)) : undefined,
  }));
  return {
    canon: 'bulletin-template', version: TEMPLATE_FILE_VERSION, exported_at: new Date().toISOString(),
    template: { name: t.name, description: t.description, options: t.options },
    blocks,
  };
}

function readPicture(p: unknown): { mime: string; data: Buffer } | null {
  if (!p || typeof p !== 'object') return null;
  const { mime, data } = p as Picture;
  if (!PICTURE_TYPES.includes(mime) || typeof data !== 'string') return null;
  const buf = Buffer.from(data, 'base64');
  return buf.length && buf.length <= MAX_PICTURE ? { mime, data: buf } : null;
}

/** Make a new template from a file's contents. Returns which kind was made and its id. */
export function importTemplateFile(raw: unknown): { kind: 'slide' | 'bulletin'; id: number; added_blocks: string[] } {
  const f = raw as Partial<TemplateFile> | null;
  if (!f || typeof f !== 'object' || (f.canon !== 'slide-template' && f.canon !== 'bulletin-template') || !f.template) {
    throw new BadRequest('This is not a Canon template file.');
  }
  if ((f.version ?? 0) > TEMPLATE_FILE_VERSION) throw new BadRequest('This template was exported by a newer version of Canon. Update Canon first.');

  if (f.canon === 'slide-template') {
    const s = f as SlideTemplateFile;
    const t = createTheme({ name: s.template.name, base: s.template.base, vars: s.template.vars, css: s.template.css });
    const bg = readPicture(s.background);
    if (bg) setThemeBackground(t.id, bg.mime, bg.data);
    return { kind: 'slide', id: t.id, added_blocks: [] };
  }

  const b = f as BulletinTemplateFile;
  // the QR codes / pictures / notes the layout prints: the Library's own when one of the same name and type exists
  const have = listBlocks();
  const map = new Map<number, number>();
  const added: string[] = [];
  for (const fb of Array.isArray(b.blocks) ? b.blocks : []) {
    if (!fb || typeof fb.ref !== 'number' || typeof fb.name !== 'string') continue;
    const same = have.find((x) => x.kind === fb.kind && x.name.trim().toLowerCase() === fb.name.trim().toLowerCase());
    if (same) {
      map.set(fb.ref, same.id);
      continue;
    }
    const nb = createBlock({ kind: fb.kind, name: fb.name, data: fb.data });
    const pic = fb.kind === 'image' ? readPicture(fb.picture) : null;
    if (pic) setBlockImage(nb.id, pic.mime, pic.data);
    map.set(fb.ref, nb.id);
    added.push(fb.name);
  }
  const options = structuredClone(b.template.options);
  if (options && Array.isArray(options.page_layout)) {
    for (const s of options.page_layout) {
      if (s.blocks) s.blocks = s.blocks.map((r) => map.get(r)).filter((x): x is number => x != null);
    }
  }
  const t = createTemplate({ name: b.template.name, description: b.template.description, options });
  return { kind: 'bulletin', id: t.id, added_blocks: added };
}

/** A file name for a template: "slide-template-ink-dark.json". */
export function templateFileName(kind: 'slide' | 'bulletin', name: Record<string, string | undefined>) {
  const base = (name.en || Object.values(name).find(Boolean) || 'template').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'template';
  return `${kind}-template-${base.slice(0, 40)}.json`;
}

