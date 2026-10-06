// Short-lived download links for a service's files: the PowerPoint slides, the Word bulletin, the FreeShow project
// and the run sheet. AI agents create them (canon_get_service, format "downloads"); anyone holding a link can
// download that one file until it expires, without signing in — like the team share link, so keep links private.
import type { FontSystem } from '../../shared/slide-fonts.ts';
import crypto from 'node:crypto';
import type { Lang } from '../../shared/types.ts';
import { all, get, run } from '../db.ts';
import { BadRequest, NotFound } from '../lib/table.ts';
import { renderService, serviceAsText } from './render.ts';
import { services } from './services.ts';
import { serviceDocx } from '../export/docx.ts';
import { freeshowProject } from '../export/freeshow.ts';
import { servicePptx } from '../export/pptx.ts';
import { withRights } from '../../shared/bible-rights.ts';

export const DOWNLOAD_KINDS = ['slides_pptx', 'bulletin_docx', 'freeshow', 'run_sheet'] as const;
export type DownloadKind = (typeof DOWNLOAD_KINDS)[number];
export const MAX_LINK_HOURS = 72;

const LABEL: Record<DownloadKind, string> = {
  slides_pptx: 'Slides (PowerPoint)',
  bulletin_docx: 'Bulletin / order of service (Word)',
  freeshow: 'FreeShow project',
  run_sheet: 'Run sheet (text)',
};

export interface DownloadFile {
  name: string;
  mime: string;
  body: Buffer | string;
}

/** Build one file for a service. */
/** system: for slides, the computer that will show them ('mac' = fonts every Mac has, for Keynote). */
export async function buildFile(serviceId: number, kind: DownloadKind, langs?: Lang[] | null, system: FontSystem = 'windows'): Promise<DownloadFile> {
  // slides and FreeShow are projected; the Word file is printed (a licence may allow one and not the other)
  const r = withRights(renderService(serviceId), kind === 'bulletin_docx' ? 'print' : kind === 'run_sheet' ? 'print' : 'project');
  langs = langs?.filter((l) => r.languages.includes(l)) ?? null;
  switch (kind) {
    case 'slides_pptx':
      return { name: `slides-${r.date}${system === 'mac' ? '-mac' : ''}.pptx`, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', body: await servicePptx(r, { langs: langs ?? undefined, system }) };
    case 'bulletin_docx':
      return { name: `order-of-service-${r.date}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: await serviceDocx(r) };
    case 'freeshow':
      return { name: `canon-${r.date}.project`, mime: 'application/json', body: JSON.stringify(await freeshowProject(r)) };
    case 'run_sheet': {
      const ls = langs?.length ? langs : r.languages;
      return { name: `run-sheet-${r.date}.txt`, mime: 'text/plain; charset=utf-8', body: ls.map((l) => serviceAsText(r, l)).join('\n\n') };
    }
  }
}

/** Create links for some files of a service, valid for `hours` (1–72). */
export function createLinks(serviceId: number, kinds: DownloadKind[], hours: number, userId: number | null, langs?: Lang[] | null) {
  services.get(serviceId);
  if (!kinds.length) throw new BadRequest('Choose at least one file');
  if (!(hours >= 1 && hours <= MAX_LINK_HOURS)) throw new BadRequest(`Links last 1 to ${MAX_LINK_HOURS} hours`);
  prune();
  const expires = new Date(Date.now() + hours * 3600_000).toISOString();
  return [...new Set(kinds)].map((kind) => {
    const token = crypto.randomBytes(24).toString('base64url');
    run('INSERT INTO download_links (token, service_id, kind, langs, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', token, serviceId, kind, langs?.length ? JSON.stringify(langs) : null, expires, userId);
    return { kind, label: LABEL[kind], token, expires_at: expires };
  });
}

/** The file behind a link (404 when unknown or expired). */
export async function fileForToken(token: string): Promise<DownloadFile> {
  const row = get<{ service_id: number; kind: DownloadKind; langs: string | null; expires_at: string }>('SELECT service_id, kind, langs, expires_at FROM download_links WHERE token = ?', token);
  if (!row || row.expires_at < new Date().toISOString()) throw new NotFound('This download link has expired or does not exist. Ask for a new one.');
  return buildFile(row.service_id, row.kind, row.langs ? (JSON.parse(row.langs) as Lang[]) : null);
}

/** Delete expired links. */
export function prune() {
  run('DELETE FROM download_links WHERE expires_at < ?', new Date().toISOString());
}

export const activeLinkCount = (serviceId: number) =>
  all<{ n: number }>('SELECT COUNT(*) AS n FROM download_links WHERE service_id = ? AND expires_at >= ?', serviceId, new Date().toISOString())[0]?.n ?? 0;
