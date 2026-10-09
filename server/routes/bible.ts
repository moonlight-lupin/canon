// REST routes for church-uploaded Bibles (Settings → Languages → Add a Bible). Mounted inside /api after
// authentication. Uploads, deletes and full exports are for administrators; the template is for anyone signed in.
//
//   POST   /api/bible/uploads?dry_run=1&code=ESV&name=…&language=en&notes=…&permission=1[&replace=1][&skip_errors=1][&lang=zh]
//          body = the file itself (CSV or JSON; send as application/octet-stream or text/csv; up to 20 MB).
//          `language` is the Bible's language; `lang` only chooses the language of the messages.
//   DELETE /api/bible/translations/:code
//   GET    /api/bible/translations/:code/usage
//   GET    /api/bible/translations/:code/export.csv
//   GET    /api/bible/template.csv
import express, { type Request, type Response } from 'express';
import { requireAdmin } from '../auth.ts';
import {
  bibleTemplateCsv, deleteTranslation, exportTranslationCsv, readMeta, translationRow, translationUsage, uploadBible,
} from '../repo/bible-upload.ts';
import { uiLang } from './csv.ts';
import { h } from './helpers.ts';
import { z } from 'zod';
import { setTranslationRights } from '../repo/bible.ts';
import { BIBLE_USES } from '../../shared/bible-rights.ts';
import { logChange } from '../repo/changelog.ts';
import { churchToday } from '../lib/dates.ts';

export const bibleRoutes = express.Router();

const flag = (v: unknown) => v === '1' || v === 'true';
const query = (req: Request) =>
  Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
const code = (req: Request) => String(req.params.code ?? '').trim().toUpperCase();

function sendCsv(res: Response, name: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
}

/** The raw upload, whatever its content type. A small JSON file sent as application/json arrives parsed. */
const rawBible = express.raw({ type: () => true, limit: '20mb' });
function bytes(req: Request): Uint8Array {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return Buffer.from(JSON.stringify(req.body), 'utf8');
  throw Object.assign(new Error('Send the Bible file itself as the request body.'), { status: 400 });
}

bibleRoutes.get('/bible/template.csv', (_req, res) => sendCsv(res, 'canon-bible-template.csv', bibleTemplateCsv()));

bibleRoutes.post('/bible/uploads', requireAdmin, rawBible, h((req) =>
  uploadBible(bytes(req), readMeta(query(req)), {
    dryRun: flag(req.query.dry_run),
    replace: flag(req.query.replace),
    skipErrors: flag(req.query.skip_errors),
    lang: uiLang(req),
  }),
));

bibleRoutes.get('/bible/translations/:code/usage', requireAdmin, h((req) => ({ translation: translationRow(code(req)) ?? null, ...translationUsage(code(req)) })));

bibleRoutes.delete('/bible/translations/:code', requireAdmin, h((req) => deleteTranslation(code(req), uiLang(req))));

/** A version's edition, licence and what it may be used for: printed, projected, online (administrators). */
bibleRoutes.patch('/bible/translations/:code', requireAdmin, h((req) => {
  const b = z.object({
    edition: z.string().max(100).nullable().optional(),
    license: z.string().max(300).optional(),
    rights: z.object({ print: z.boolean(), project: z.boolean(), online: z.boolean() }).partial().optional(),
  }).parse(req.body);
  const c = code(req);
  const out = setTranslationRights(c, b);
  logChange({ entity: 'settings', entity_id: null, action: 'update', summary: `Bible version ${c}: ${BIBLE_USES.map((u) => `${u} ${out!.rights[u] ? 'allowed' : 'not allowed'}`).join(', ')}${out!.edition ? ` (${out!.edition})` : ''}` });
  return out;
}));

bibleRoutes.get('/bible/translations/:code/export.csv', requireAdmin, h((req, res) => {
  const c = code(req);
  sendCsv(res, `canon-bible-${c}-${churchToday()}.csv`, exportTranslationCsv(c, uiLang(req)));
}));
