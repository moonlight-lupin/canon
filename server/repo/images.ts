// Library → Images (0.19.10): pictures for the slides — a poster for the announcements, a photo, a map — each shown
// on a slide of its own after a service item (service_items.slide_images). Apart from the slide backgrounds (behind
// an item's words) and the QR codes & notes (small cards that also print on the bulletin). The picture itself is
// kept in `assets` (key image-<id>), inside the encrypted database and its backups.
import crypto from 'node:crypto';
import { all, get, run, tx } from '../db.ts';
import { BadRequest, NotFound, table } from '../lib/table.ts';
import { PICTURE_TYPES, imageSize, realType } from '../lib/image.ts';

export type ImageFit = 'contain' | 'cover';
export interface LibraryImage {
  id: number;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  version: string;
  /** contain: the whole picture, on the slide template's background; cover: it fills the slide (edges cut off) */
  fit: ImageFit;
  created_at: string;
}

export const images = table<LibraryImage>({
  name: 'images',
  cols: ['name', 'mime', 'width', 'height', 'bytes', 'version', 'fit'],
});

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** At most this many pictures after one item. */
export const MAX_ITEM_IMAGES = 12;
export const imageKey = (id: number) => `image-${id}`;

/** How many service items show each picture. */
const useCounts = () => new Map(all<{ id: number; n: number }>(
  'SELECT CAST(j.value AS INTEGER) AS id, COUNT(DISTINCT si.id) AS n FROM service_items si, json_each(si.slide_images) j GROUP BY j.value',
).map((r) => [r.id, r.n]));

/** All pictures (by name, or those whose name has these words), with how many items show each. */
export function listImages(q = '') {
  const uses = useCounts();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return images.list('', [], 'name COLLATE NOCASE, id')
    .filter((i) => words.every((w) => i.name.toLowerCase().includes(w)))
    .map((i) => ({ ...i, uses: uses.get(i.id) ?? 0 }));
}

/** Add a picture (or replace the picture of an existing one). */
export function saveImage(id: number | null, name: string | undefined, _declared: string, data: Buffer): LibraryImage {
  if (!Buffer.isBuffer(data) || !data.length) throw new BadRequest('Choose a picture');
  // stored as what its bytes are (a JPEG sent as a PNG is a JPEG)
  const mime = realType(data, PICTURE_TYPES, 'Upload a PNG, JPEG or WebP picture');
  if (data.length > MAX_IMAGE_BYTES) throw new BadRequest('The picture must be 10 MB or smaller');
  const size = imageSize(data);
  if (!size) throw new BadRequest('This file does not look like a PNG, JPEG or WebP picture');
  const version = crypto.createHash('sha256').update(data).digest('base64url').slice(0, 12);
  return tx(() => {
    const row = id
      ? images.update(id, { mime, width: size.w, height: size.h, bytes: data.length, version, ...(name?.trim() ? { name: name.trim().slice(0, 120) } : {}) })
      : images.insert({ name: (name?.trim() || 'Picture').slice(0, 120), mime, width: size.w, height: size.h, bytes: data.length, version, fit: 'contain' });
    run(
      `INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at`,
      imageKey(row.id), mime, data,
    );
    return row;
  });
}

/** Rename a picture, or change how it fills the slide. */
export function updateImage(id: number, patch: { name?: string; fit?: string }) {
  images.get(id);
  const out: Partial<LibraryImage> = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new BadRequest('Give the picture a name');
    out.name = patch.name.trim().slice(0, 120);
  }
  if (patch.fit !== undefined) {
    if (patch.fit !== 'contain' && patch.fit !== 'cover') throw new BadRequest('fit is "contain" (the whole picture) or "cover" (fill the slide)');
    out.fit = patch.fit;
  }
  return images.update(id, out);
}

/** Delete a picture: it comes off the items that showed it. */
export function deleteImage(id: number) {
  images.get(id);
  tx(() => {
    run(
      `UPDATE service_items SET slide_images = (SELECT json_group_array(CAST(j.value AS INTEGER)) FROM json_each(service_items.slide_images) j WHERE CAST(j.value AS INTEGER) <> ?)
       WHERE EXISTS (SELECT 1 FROM json_each(service_items.slide_images) j WHERE CAST(j.value AS INTEGER) = ?)`,
      id, id,
    );
    images.remove(id);
    run('DELETE FROM assets WHERE key = ?', imageKey(id));
  });
}

/** Pictures by name (case-insensitive; the first wins when two share a name): templates keep pictures by name. */
export function imageIdsByName(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of all<{ id: number; name: string }>('SELECT id, name FROM images ORDER BY id')) {
    const k = r.name.trim().toLowerCase();
    if (!m.has(k)) m.set(k, r.id);
  }
  return m;
}

/** An item's pictures must be in the library (a missing one is named). */
export function checkImageIds(ids: number[] | null | undefined) {
  if (!ids?.length) return;
  if (ids.length > MAX_ITEM_IMAGES) throw new BadRequest(`At most ${MAX_ITEM_IMAGES} pictures after one item`);
  for (const i of ids) if (!get('SELECT 1 FROM images WHERE id = ?', i)) throw new BadRequest(`slide_images: picture ${i} is not in Library → Images (add it there first)`);
}

export function imageAsset(id: number) {
  const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', imageKey(id));
  if (!a) throw new NotFound('picture not found');
  return a;
}
