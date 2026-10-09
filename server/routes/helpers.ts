// Helpers shared by the REST route modules.
import type { NextFunction, Request, Response } from 'express';
import { toCsv } from '../../shared/reports.ts';
import type { DownloadFile } from '../repo/downloads.ts';

export type Handler = (req: Request, res: Response) => unknown;
/** Send a CSV download (with a BOM so Excel reads Chinese correctly). */
export function sendCsv(res: Response, filename: string, rows: (string | number | null | undefined)[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(toCsv(rows));
}
/** Wrap a handler: async errors go to the error middleware, return values are sent as JSON. */
export const h = (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, res);
    if (!res.headersSent) res.json(out ?? { ok: true });
  } catch (e) {
    next(e);
  }
};
/** A "too many" error (429) that says how many seconds to wait: the answer carries it as Retry-After (0.19.9 review). */
export const tooMany = (message: string, retryAfter: number) => Object.assign(new Error(message), { status: 429, retry_after: Math.max(1, Math.ceil(retryAfter)) });
/** A route's numeric id parameter (400 if it is not a positive whole number). */
export const id = (req: Request, name = 'id') => {
  const n = Number(req.params[name]);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error(`Bad ${name}`), { status: 400 });
  return n;
};
export const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
/** Send a built file as a download. */
export function sendFile(res: Response, f: DownloadFile) {
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(f.body);
}
