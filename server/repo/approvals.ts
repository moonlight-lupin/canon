// Approved, dated versions of a service's bulletin and slides (0.13). Approving keeps a copy of everything the
// outputs are made from at that moment — the rendered service (words, order, people, the bulletin template's options
// and blocks), the bulletin template and the slide template with its CSS — so the approved version can be opened
// again exactly, and Canon can say when the service has changed since. Pictures are referred to, not copied.
import crypto from 'node:crypto';
import { all, get, run } from '../db.ts';
import { NotFound } from '../lib/table.ts';
import { renderService } from './render.ts';
import * as P from './presentation.ts';
import { logChange } from './changelog.ts';

export function snapshotOf(serviceId: number) {
  const render = renderService(serviceId);
  const tplId = render.bulletin.template_id;
  const themeId = render.slide_theme_id;
  return {
    render,
    bulletin_template: tplId ? P.getTemplate(tplId) : null,
    blocks: P.listBlocks(),
    slide_theme: themeId ? P.getTheme(themeId) : null,
    slide_css: themeId ? P.themeCss(themeId) : '',
  };
}

/** What the outputs show, as a fingerprint: the rendered service and the slide CSS (not the lists around them). */
const fingerprint = (s: ReturnType<typeof snapshotOf>) => crypto.createHash('sha256').update(JSON.stringify([s.render, s.slide_css])).digest('base64url').slice(0, 22);

export function approve(serviceId: number, who: { user_id: number | null; name: string }, note?: string | null) {
  const snap = snapshotOf(serviceId);
  const r = run(
    'INSERT INTO output_approvals (service_id, user_id, approved_by, note, snapshot, hash) VALUES (?, ?, ?, ?, ?, ?)',
    serviceId, who.user_id, who.name, note?.trim() || null, JSON.stringify(snap), fingerprint(snap),
  );
  logChange({ entity: 'services', entity_id: serviceId, action: 'update', summary: `Bulletin and slides approved by ${who.name}${note?.trim() ? ` (${note.trim()})` : ''}` });
  return listApprovals(serviceId).find((a) => a.id === Number(r.lastInsertRowid))!;
}

/** A service's approved versions, newest first; `current` = the service still shows exactly that. */
export function listApprovals(serviceId: number) {
  const now = fingerprint(snapshotOf(serviceId));
  return all<{ id: number; approved_at: string; approved_by: string; note: string | null; hash: string }>(
    'SELECT id, approved_at, approved_by, note, hash FROM output_approvals WHERE service_id = ? ORDER BY id DESC', serviceId,
  ).map(({ hash, ...a }) => ({ ...a, current: hash === now }));
}

export function getApproval(serviceId: number, id: number) {
  const a = get<{ id: number; approved_at: string; approved_by: string; note: string | null; snapshot: string }>(
    'SELECT id, approved_at, approved_by, note, snapshot FROM output_approvals WHERE id = ? AND service_id = ?', id, serviceId,
  );
  if (!a) throw new NotFound('That approved version does not exist.');
  const { snapshot, ...meta } = a;
  return { ...meta, snapshot: JSON.parse(snapshot) as ReturnType<typeof snapshotOf> };
}
