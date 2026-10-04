// REST routes for CSV templates, exports and imports of every entity (members, co-workers, groups, team
// members, unavailability, songs, texts, templates, hymnal index). Mounted inside /api after authentication.
// Not exposed over MCP: bulk imports are for staff in the web app only.
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Lang } from '../../shared/types.ts';
import { LANG_CODE_RE } from '../../shared/languages.ts';
import { CSV_ENTITIES, ImportBlocked, RowError, exportCsv, guide, makeCtx, runImport, say, templateCsv, type Entity } from '../csv/index.ts';

export const csvRoutes = express.Router();

type Handler = (req: Request, res: Response) => unknown;
const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    if (e instanceof ImportBlocked) {
      res.status(422).json({ error: e.message, preview: e.preview });
      return;
    }
    if (e instanceof RowError) {
      res.status(400).json({ error: say(e.msg, uiLang(req)) });
      return;
    }
    next(e);
  }
};

export function uiLang(req: Request): Lang {
  const q = typeof req.query.lang === 'string' ? req.query.lang : '';
  return q && LANG_CODE_RE.test(q) ? q : req.user?.lang ?? 'en';
}

const query = (req: Request) =>
  Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));

function entity(req: Request): Entity {
  const e = CSV_ENTITIES[String(req.params.entity)];
  if (!e) throw Object.assign(new Error(`Unknown CSV type "${req.params.entity}"`), { status: 404 });
  return e;
}

/** PDPA: viewers may not export personal data (members, co-workers, groups, team rosters, away dates). */
function mayExport(req: Request, e: Entity) {
  if (e.pii && req.user?.role === 'viewer') {
    throw Object.assign(new Error('Read-only accounts cannot export personal data. Ask an editor or administrator.'), { status: 403 });
  }
}

function sendCsv(res: Response, name: string, body: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
}

const stem = (e: Entity, req: Request) => `canon-${e.fileName ? e.fileName(makeCtx(uiLang(req), query(req))) : e.key.replace(/_/g, '-')}`;

csvRoutes.get('/csv', h(() => Object.values(CSV_ENTITIES).map((e) => ({ key: e.key, label: e.label, pii: e.pii, needs: e.needs ?? [] }))));

csvRoutes.get('/csv/:entity/guide', h((req) => {
  const e = entity(req);
  return { ...guide(e, makeCtx(uiLang(req), query(req))), pii: e.pii };
}));

csvRoutes.get('/csv/:entity/template.csv', h((req, res) => {
  const e = entity(req);
  sendCsv(res, `${stem(e, req)}-template.csv`, templateCsv(e, makeCtx(uiLang(req), query(req))));
}));

csvRoutes.get('/csv/:entity/export.csv', h((req, res) => {
  const e = entity(req);
  mayExport(req, e);
  sendCsv(res, `${stem(e, req)}-${new Date().toISOString().slice(0, 10)}.csv`, exportCsv(e, makeCtx(uiLang(req), query(req))));
}));

/** The raw file body (any content type: Excel uploads arrive as text/csv, application/vnd.ms-excel, octet-stream …). */
export const rawBody = express.raw({ type: () => true, limit: '10mb' });

export function bodyBytes(req: Request): Uint8Array {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  throw Object.assign(new Error('Send the CSV file itself as the request body.'), { status: 400 });
}

/** Import (or preview with ?dry_run=1). All-or-nothing unless ?skip_errors=1. Editors and administrators only. */
csvRoutes.post('/csv/:entity/import', rawBody, h((req) => {
  const e = entity(req);
  if (req.user?.role === 'viewer') throw Object.assign(new Error('Read-only account'), { status: 403 });
  const flag = (v: unknown) => v === '1' || v === 'true';
  return runImport(e, bodyBytes(req), { dryRun: flag(req.query.dry_run), skipErrors: flag(req.query.skip_errors), lang: uiLang(req), query: query(req) });
}));

/**
 * Older endpoints (POST /people/import, POST /hymnals/:id/import) keep their response shape: valid rows are
 * imported, rows with problems are listed in `errors`.
 */
export function legacyImport(entityKey: string, req: Request, extraQuery: Record<string, string> = {}) {
  const e = CSV_ENTITIES[entityKey];
  const lang = uiLang(req);
  const p = runImport(e, bodyBytes(req), { dryRun: false, skipErrors: true, lang, query: { ...query(req), ...extraQuery } });
  const errors = [
    ...(p.fatal ? [p.fatal] : []),
    ...p.rows.filter((r) => r.action === 'error').map((r) => `Row ${r.row}: ${(r.errors ?? []).join(' ')}`),
  ];
  return { created: p.counts.create, updated: p.counts.update, unchanged: p.counts.unchanged, errors, notes: p.notes };
}

export function legacyExport(entityKey: string, req: Request, res: Response) {
  const e = CSV_ENTITIES[entityKey];
  mayExport(req, e);
  sendCsv(res, `${stem(e, req)}-${new Date().toISOString().slice(0, 10)}.csv`, exportCsv(e, makeCtx(uiLang(req), query(req))));
}
