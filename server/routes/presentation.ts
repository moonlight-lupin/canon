// REST routes for slide themes (with background pictures and compiled CSS) and bulletin templates.
// Mounted inside /api after authentication; viewers are read-only (requireUser), church defaults need an admin.
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { L10nSchema } from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as P from '../repo/presentation.ts';
import { exportBulletinTemplate, exportSlideTemplate, importTemplateFile, templateFileName } from '../repo/template-files.ts';
import { magicOk as rasterOk } from './design.ts';

export const presentationRoutes = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
const id = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Bad id'), { status: 400 });
  return n;
};
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

// Vars and options are normalised field by field in the repo; here we only check the outer shape.
const ThemeInput = z.object({
  name: L10nSchema.optional(),
  base: z.enum(['dark', 'light']).optional(),
  vars: z.record(z.string(), z.unknown()).optional(),
  css: z.string().max(50_000).optional(),
});
const TemplateInput = z.object({
  name: L10nSchema.optional(),
  description: L10nSchema.optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

// ---------------------------------------------------------------- slide themes

presentationRoutes.get('/slide-themes', h(() => P.listThemes()));
presentationRoutes.get('/slide-themes/:id', h((req) => P.getTheme(id(req))));
presentationRoutes.post('/slide-themes', h((req) => P.createTheme(ThemeInput.parse(req.body) as P.ThemeInput)));
presentationRoutes.patch('/slide-themes/:id', h((req) => P.updateTheme(id(req), ThemeInput.parse(req.body) as P.ThemeInput)));
presentationRoutes.delete('/slide-themes/:id', requireAdmin, h((req) => P.deleteTheme(id(req))));
presentationRoutes.post('/slide-themes/:id/duplicate', h((req) => P.duplicateTheme(id(req))));
presentationRoutes.put('/slide-themes/:id/ref', h((req) => P.setThemeRef(id(req), z.object({ ref: z.string().max(40).nullable() }).parse(req.body).ref)));
presentationRoutes.put('/slide-themes/:id/hidden', h((req) => P.setThemeHidden(id(req), z.object({ hidden: z.boolean() }).parse(req.body).hidden)));

/** Compiled, scoped CSS for one theme (custom properties + the admin's CSS). */
presentationRoutes.get('/slide-themes/:id/css', h((req, res) => {
  const css = P.themeCss(id(req));
  res.setHeader('Cache-Control', 'no-cache');
  res.type('text/css').send(css);
}));

// Background picture: raster only (PNG, JPEG, WebP), checked by magic bytes, 5 MB at most.
const MAX_BG = 5 * 1024 * 1024;
const BG_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
type BgType = (typeof BG_TYPES)[number];
function magicOk(type: BgType, b: Buffer): boolean {
  if (type === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
}
const rawImage = express.raw({ type: () => true, limit: MAX_BG });
function readImage(req: Request, res: Response, next: NextFunction) {
  rawImage(req, res, (err?: unknown) => {
    if (err) {
      const e = err as { type?: string };
      return next(e.type === 'entity.too.large' ? fail(413, 'The picture must be 5 MB or smaller') : err);
    }
    next();
  });
}

presentationRoutes.put('/slide-themes/:id/background', readImage, h((req) => {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() as BgType;
  if (!BG_TYPES.includes(type) || !Buffer.isBuffer(req.body)) throw fail(415, 'Upload a PNG, JPEG or WebP picture');
  const data = req.body as Buffer;
  if (!data.length) throw fail(400, 'The file is empty');
  if (!magicOk(type, data)) throw fail(415, 'The file does not match its picture type');
  return P.setThemeBackground(id(req), type, data);
}));
presentationRoutes.delete('/slide-themes/:id/background', h((req) => P.removeThemeBackground(id(req))));

/** Theme background pictures and bulletin block pictures (other assets, such as the logo, have their own public route). */
presentationRoutes.get('/assets/:key', (req, res, next) => {
  const key = String(req.params.key);
  if (!/^(slide-theme-\d+-bg|bulletin-block-\d+|slide-bg-\d+)$/.test(key)) return next();
  const row = P.assetRow(key);
  if (!row) {
    res.status(404).json({ error: 'No picture' });
    return;
  }
  res.setHeader('Cache-Control', req.query.v ? 'private, max-age=31536000, immutable' : 'no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.type(row.mime).send(Buffer.from(row.data));
});

// ---------------------------------------------------------------- bulletin templates

presentationRoutes.get('/bulletin-templates', h(() => P.listTemplates()));
presentationRoutes.get('/bulletin-templates/:id', h((req) => P.getTemplate(id(req))));
presentationRoutes.post('/bulletin-templates', h((req) => P.createTemplate(TemplateInput.parse(req.body))));
presentationRoutes.patch('/bulletin-templates/:id', h((req) => P.updateTemplate(id(req), TemplateInput.parse(req.body))));
presentationRoutes.delete('/bulletin-templates/:id', requireAdmin, h((req) => P.deleteTemplate(id(req))));
presentationRoutes.post('/bulletin-templates/:id/duplicate', h((req) => P.duplicateTemplate(id(req))));
presentationRoutes.put('/bulletin-templates/:id/ref', h((req) => P.setTemplateRef(id(req), z.object({ ref: z.string().max(40).nullable() }).parse(req.body).ref)));
presentationRoutes.put('/bulletin-templates/:id/hidden', h((req) => P.setTemplateHidden(id(req), z.object({ hidden: z.boolean() }).parse(req.body).hidden)));

// ---------------------------------------------------------------- bulletin blocks (QR codes, pictures, notes)
// Reading needs a session; writing needs an editor or admin (viewers are read-only in requireUser).

const BlockInput = z.object({
  kind: z.enum(['qr', 'image', 'text']).optional(),
  name: z.string().max(120).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Send a QR code: SVG (shown in the bulletin and editor) or PNG (Word export, downloads). */
async function sendQr(res: Response, text: string, ext: string, download: string | null) {
  const safe = (download ?? 'qr-code').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'qr-code';
  if (download !== null) res.setHeader('Content-Disposition', `attachment; filename="${safe}.${ext}"`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (ext === 'png') res.type('image/png').send(await P.qrPng(text));
  else res.type('image/svg+xml').send(await P.qrSvg(text));
}
const qrExt = (req: Request) => {
  const ext = String(req.params.ext);
  if (ext !== 'svg' && ext !== 'png') throw fail(404, 'Not found');
  return ext;
};

presentationRoutes.get('/bulletin-blocks', h(() => P.listBlocks()));
/** A QR code for any text: the live preview while typing, and "Download PNG / SVG". */
presentationRoutes.get('/bulletin-blocks/qr.:ext', h(async (req, res) => {
  const text = typeof req.query.text === 'string' ? req.query.text.trim() : '';
  res.setHeader('Cache-Control', 'private, max-age=300');
  await sendQr(res, text, qrExt(req), req.query.download ? 'qr-code' : null);
}));
presentationRoutes.get('/bulletin-blocks/:id', h((req) => P.getBlock(id(req))));
presentationRoutes.get('/bulletin-blocks/:id/qr.:ext', h(async (req, res) => {
  const b = P.getBlock(id(req));
  if (b.kind !== 'qr') throw fail(404, 'This block is not a QR code');
  res.setHeader('Cache-Control', req.query.v ? 'private, max-age=31536000, immutable' : 'no-cache');
  await sendQr(res, b.data.value ?? '', qrExt(req), req.query.download ? b.name : null);
}));
presentationRoutes.post('/bulletin-blocks', h((req) => P.createBlock(BlockInput.parse(req.body) as P.BlockInput)));
presentationRoutes.patch('/bulletin-blocks/:id', h((req) => P.updateBlock(id(req), BlockInput.parse(req.body) as P.BlockInput)));
presentationRoutes.delete('/bulletin-blocks/:id', h((req) => P.deleteBlock(id(req))));

// Block pictures (PayNow / bank QR codes, posters): PNG, JPEG or WebP checked by magic bytes, 2 MB at most.
const MAX_BLOCK_IMG = 2 * 1024 * 1024;
const rawBlockImage = express.raw({ type: () => true, limit: MAX_BLOCK_IMG });
function readBlockImage(req: Request, res: Response, next: NextFunction) {
  rawBlockImage(req, res, (err?: unknown) => {
    if (err) {
      const e = err as { type?: string };
      return next(e.type === 'entity.too.large' ? fail(413, 'The picture must be 2 MB or smaller') : err);
    }
    next();
  });
}
/** Why an upload can't be a block picture (null = fine). Exported for tests. */
export function blockImageProblem(type: string, data: unknown): { status: number; message: string } | null {
  if (!BG_TYPES.includes(type as BgType) || !Buffer.isBuffer(data)) return { status: 415, message: 'Upload a PNG, JPEG or WebP picture' };
  if (!data.length) return { status: 400, message: 'The file is empty' };
  if (data.length > MAX_BLOCK_IMG) return { status: 413, message: 'The picture must be 2 MB or smaller' };
  if (!rasterOk(type as BgType, data)) return { status: 415, message: 'The file does not match its picture type' };
  return null;
}
presentationRoutes.put('/bulletin-blocks/:id/image', readBlockImage, h((req) => {
  const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  const problem = blockImageProblem(type, req.body);
  if (problem) throw fail(problem.status, problem.message);
  return P.setBlockImage(id(req), type, req.body as Buffer);
}));
presentationRoutes.delete('/bulletin-blocks/:id/image', h((req) => P.removeBlockImage(id(req))));

// ---------------------------------------------------------------- church defaults

// ---------------------------------------------------------------- templates as files (copy to another computer or church)

const sendTemplateFile = (res: Response, name: string, body: unknown) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(JSON.stringify(body, null, 1));
};
presentationRoutes.get('/slide-themes/:id/export', h((req, res) => {
  const f = exportSlideTemplate(id(req));
  sendTemplateFile(res, templateFileName('slide', f.template.name), f);
}));
presentationRoutes.get('/bulletin-templates/:id/export', h((req, res) => {
  const f = exportBulletinTemplate(id(req));
  sendTemplateFile(res, templateFileName('bulletin', f.template.name), f);
}));
/** Import a template file (sent as a plain file body: it can hold pictures larger than the JSON limit). */
presentationRoutes.post('/template-files/import', express.raw({ type: () => true, limit: '30mb' }), h((req) => {
  let json: unknown;
  try {
    json = JSON.parse((req.body as Buffer).toString('utf8'));
  } catch {
    throw Object.assign(new Error('This is not a Canon template file.'), { status: 400 });
  }
  return importTemplateFile(json);
}));

presentationRoutes.put('/presentation/defaults', requireAdmin, h((req) => {
  const b = z.object({
    slide_theme_id: z.number().int().positive().nullable().optional(),
    bulletin_template_id: z.number().int().positive().nullable().optional(),
  }).parse(req.body);
  return P.setDefaults(b);
}));
