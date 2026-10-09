// The image library (0.19.10): Library → Images, apart from the slide backgrounds. A picture is shown on a slide of
// its own after a service item (any item, up to 12 pictures; an item that is not otherwise on the slides shows only
// its pictures), whole or filling the slide; in the slides, PowerPoint and FreeShow; kept by name in templates; and
// open to AI assistants (search the library for images; slide_images on items). Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-images-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { seed } = await import('../server/seed/index.ts');
const svc = await import('../server/repo/services.ts');
const { renderService } = await import('../server/repo/render.ts');
const { buildSlides } = await import('../shared/slide-model.ts');
const { servicePptx } = await import('../server/export/pptx.ts');
const { freeshowProject } = await import('../server/export/freeshow.ts');
const { LIBRARY_TOOLS } = await import('../server/mcp-tools/library.ts');
const { get } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
const as: Record<string, Session> = {};

/** A small PNG of w × h pixels. */
function png(w = 4, h = 3): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])));
    return Buffer.concat([len, Buffer.from(type), data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 120)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
async function call(who: Session, method: string, url: string, body?: unknown) {
  const r = await fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
}
const upload = (who: Session, name: string, data = png(), method = 'POST', url = `/images?name=${encodeURIComponent(name)}`) =>
  fetch(`${base}/api${url}`, { method, headers: { 'Content-Type': 'image/png', Cookie: who.cookie, 'X-CSRF-Token': who.csrf }, body: new Uint8Array(data) })
    .then(async (r) => ({ status: r.status, body: (await r.json().catch(() => null)) as Json }));

before(async () => {
  await seed();
  for (const role of ['admin', 'editor', 'viewer'] as const) await createUser({ username: role, display_name: `Test ${role}`, password: 'correct-horse-6', role });
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const u of ['admin', 'editor', 'viewer']) {
    const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: 'correct-horse-6' }) });
    as[u] = { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
  }
});
after(() => server.close());

let poster = 0;
let photo = 0;

test('Library → Images: pictures are added, renamed, set to fill the slide, and read by everyone signed in', async () => {
  const up = await upload(as.editor, 'Church picnic poster', png(3, 4));
  assert.equal(up.status, 200, JSON.stringify(up.body));
  poster = up.body.id;
  assert.equal(up.body.name, 'Church picnic poster');
  assert.equal(up.body.width, 3);
  assert.equal(up.body.height, 4);
  assert.equal(up.body.fit, 'contain', 'the whole picture, by default');
  photo = (await upload(as.editor, 'Baptism photo', png(16, 9))).body.id;
  const patched = await call(as.editor, 'PATCH', `/images/${photo}`, { name: 'Baptism by the river', fit: 'cover' });
  assert.equal(patched.status, 200, JSON.stringify(patched.body));
  assert.equal(patched.body.fit, 'cover');
  assert.equal((await call(as.editor, 'PATCH', `/images/${photo}`, { fit: 'stretch' })).status, 400);
  // not the slide backgrounds
  assert.equal(get<{ n: number }>('SELECT COUNT(*) n FROM slide_backgrounds')!.n, 0);
  // a read-only account sees the library and the pictures, and changes nothing
  const list = await call(as.viewer, 'GET', '/images');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((i: Json) => i.name), ['Baptism by the river', 'Church picnic poster']);
  assert.equal(list.body[0].uses, 0);
  assert.equal((await upload(as.viewer, 'Not allowed')).status, 403);
  const pic = await fetch(`${base}/api/assets/image-${poster}?v=${up.body.version}`, { headers: { Cookie: as.viewer.cookie } });
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('content-type'), 'image/png');
  // only pictures, and not too large
  const txt = await fetch(`${base}/api/images?name=x`, { method: 'POST', headers: { 'Content-Type': 'text/plain', Cookie: as.editor.cookie, 'X-CSRF-Token': as.editor.csrf }, body: 'hello' });
  assert.notEqual(txt.status, 200);
});

test('pictures are shown on slides of their own after an item, whole or filling the slide', async () => {
  const { service } = svc.createService({ date: '2026-11-01', title: { en: 'Lord’s Day Worship' } });
  const ann = svc.addItem(service.id, { kind: 'announcements', title: { en: 'Announcements' }, on_slides: true, slide_images: [poster, photo] } as never);
  // a picture on its own: an item that is not otherwise on the slides
  svc.addItem(service.id, { kind: 'other', title: { en: 'Mission trip photo' }, on_slides: false, in_bulletin: false, slide_images: [photo] } as never);
  const r = renderService(service.id);
  assert.deepEqual(r.items[0].slide_images!.map((p) => [p.id, p.fit]), [[poster, 'contain'], [photo, 'cover']]);
  const slides = buildSlides(r, ['en']);
  const types = slides.map((s) => `${s.itemId ?? 'svc'}:${s.type}`);
  assert.deepEqual(types, ['svc:title', `${ann.id}:item`, `${ann.id}:image`, `${ann.id}:image`, `${r.items[1].id}:image`]);
  const img = slides.find((s) => s.type === 'image')!;
  assert.equal(img.image!.id, poster);
  assert.equal(img.image!.fit, 'contain');
  assert.ok(img.image!.v);
  // PowerPoint carries the pictures; FreeShow too
  const pptx = await servicePptx(r, { langs: ['en'] });
  const media = pptx.toString('latin1').match(/ppt\/media\/[^\s"<>]+\.png/g) ?? [];
  assert.ok(media.length >= 2, `pictures in the PowerPoint: ${media.length}`);
  const fs2 = JSON.stringify(await freeshowProject(r));
  assert.ok(fs2.includes('data:image/png;base64,'), 'FreeShow embeds the pictures');
  // where it is used
  const list = (await call(as.editor, 'GET', '/images')).body as Json[];
  assert.equal(list.find((i) => i.id === photo)!.uses, 2);
});

test('an item takes only pictures in the library, at most 12; deleting a picture takes it off the items', async () => {
  const { service } = svc.createService({ date: '2026-11-08' });
  assert.throws(() => svc.addItem(service.id, { kind: 'other', title: { en: 'X' }, slide_images: [999999] } as never), /not in Library → Images/);
  const r = await call(as.editor, 'POST', `/services/${service.id}/items`, { kind: 'other', title: { en: 'Too many' }, slide_images: Array(13).fill(poster) });
  assert.equal(r.status, 400);
  const extra = (await upload(as.editor, 'Temporary')).body.id;
  const it = svc.addItem(service.id, { kind: 'other', title: { en: 'Y' }, slide_images: [extra, poster] } as never);
  assert.equal((await call(as.viewer, 'DELETE', `/images/${extra}`)).status, 403);
  assert.equal((await call(as.editor, 'DELETE', `/images/${extra}`)).status, 200);
  assert.deepEqual(svc.items.get(it.id).slide_images, [poster]);
  assert.equal(get('SELECT 1 AS x FROM assets WHERE key = ?', `image-${extra}`), undefined, 'the picture itself is gone');
});

test('templates keep pictures by name; a new service from the template gets them again', () => {
  const { service } = svc.createService({ date: '2026-11-15' });
  svc.addItem(service.id, { kind: 'announcements', title: { en: 'Announcements' }, slide_images: [poster] } as never);
  const tpl = svc.saveAsTemplate(service.id, { en: 'With a poster (test)' }) as Json;
  const tItems = (tpl.items ?? tpl.template?.items) as Json[];
  assert.deepEqual(tItems.find((t) => t.kind === 'announcements')!.slide_images, ['Church picnic poster']);
  const m = svc.materialise(tItems as never);
  assert.deepEqual(m.items.find((x) => x.kind === 'announcements')!.slide_images, [poster]);
});

test('the library file carries the pictures (and how each fills the slide)', async () => {
  const { exportLibrary, importLibrary } = await import('../server/repo/library-file.ts');
  const file = exportLibrary({ sections: ['images'] });
  assert.deepEqual(importLibrary(file, { dryRun: true }).images, { added: 0, existing: 2 });
  const r = await fetch(`${base}/api/export/library.canonlib?section=images`, { headers: { Cookie: as.admin.cookie } });
  assert.equal(r.status, 200);
  // on a Canon without it (here: after deleting it), the picture comes back with its fit
  svc.items.list('', [], 'id').filter((it) => it.slide_images?.includes(photo)).forEach((it) => svc.items.update(it.id, { slide_images: [] }));
  assert.equal((await call(as.editor, 'DELETE', `/images/${photo}`)).status, 200);
  assert.deepEqual(importLibrary(file).images, { added: 1, existing: 1 });
  const back = (await call(as.editor, 'GET', '/images')).body.find((i: Json) => i.name === 'Baptism by the river');
  assert.equal(back.fit, 'cover');
});

test('AI assistants find pictures in the library and put them on items', async () => {
  const tool = LIBRARY_TOOLS.find((t) => t.name === 'canon_search_library')!;
  const r = (await tool.handler({ type: 'images', q: 'picnic', usage: false, limit: 30 }, {} as never)) as Json;
  assert.deepEqual(r.images.map((i: Json) => [i.id, i.name, i.fit]), [[poster, 'Church picnic poster', 'contain']]);
});
