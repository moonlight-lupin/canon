// Library → Slide backgrounds: full-screen pictures (1920 × 1080 for widescreen, 1440 × 1080 for 4:3) that a service
// item can show behind its slides. Kept apart from the QR codes & notes, whose pictures are small print images.
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.ts';
import { BadRequest, NotFound, table } from '../lib/table.ts';
import { PICTURE_TYPES, imageSize, realType } from '../lib/image.ts';

export interface SlideBackground {
  id: number;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  version: string;
  created_at: string;
}

export const backgrounds = table<SlideBackground>({
  name: 'slide_backgrounds',
  cols: ['name', 'mime', 'width', 'height', 'bytes', 'version'],
});

export const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024;
export const backgroundKey = (id: number) => `slide-bg-${id}`;

/** All backgrounds with how many service items use each. */
export function listBackgrounds() {
  const uses = new Map(all<{ id: number; n: number }>('SELECT slide_background_id AS id, COUNT(*) AS n FROM service_items WHERE slide_background_id IS NOT NULL GROUP BY slide_background_id').map((r) => [r.id, r.n]));
  return backgrounds.list('', [], 'name COLLATE NOCASE, id').map((b) => ({ ...b, uses: uses.get(b.id) ?? 0 }));
}

/** Add a picture (or replace the picture of an existing background). */
export function saveBackground(id: number | null, name: string | undefined, _declared: string, data: Buffer): SlideBackground {
  // stored as what its bytes are (a JPEG sent as a PNG is a JPEG)
  const mime = realType(data, PICTURE_TYPES, 'Upload a PNG, JPEG or WebP picture');
  if (data.length > MAX_BACKGROUND_BYTES) throw new BadRequest('The picture must be 10 MB or smaller');
  const size = imageSize(data);
  if (!size) throw new BadRequest('This file does not look like a PNG, JPEG or WebP picture');
  const version = crypto.createHash('sha256').update(data).digest('base64url').slice(0, 12);
  return tx(() => {
    const row = id
      ? backgrounds.update(id, { mime, width: size.w, height: size.h, bytes: data.length, version, ...(name?.trim() ? { name: name.trim().slice(0, 120) } : {}) })
      : backgrounds.insert({ name: (name?.trim() || 'Background').slice(0, 120), mime, width: size.w, height: size.h, bytes: data.length, version });
    run(
      `INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      backgroundKey(row.id), mime, data,
    );
    return row;
  });
}

export function renameBackground(id: number, name: string) {
  if (!name.trim()) throw new BadRequest('Give the background a name');
  return backgrounds.update(id, { name: name.trim().slice(0, 120) });
}

/** Delete a background: items that used it go back to the slide template's background. */
export function deleteBackground(id: number) {
  backgrounds.get(id);
  tx(() => {
    backgrounds.remove(id);
    run('DELETE FROM assets WHERE key = ?', backgroundKey(id));
  });
}

export const backgroundByName = (name: string) =>
  get<{ id: number }>('SELECT id FROM slide_backgrounds WHERE lower(name) = lower(?)', name.trim())?.id;

export function backgroundAsset(id: number) {
  const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', backgroundKey(id));
  if (!a) throw new NotFound('background picture not found');
  return a;
}
