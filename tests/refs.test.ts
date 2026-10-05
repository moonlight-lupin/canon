// References people choose for services and templates (EN-001, CN-10pmService): form, uniqueness per kind ignoring
// case, lookup by id or reference, and service templates bringing their slide / bulletin templates. Fictional data.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-refs-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let R: typeof import('../server/repo/refs.ts');
let svc: typeof import('../server/repo/services.ts');
let P: typeof import('../server/repo/presentation.ts');
let TOOLS: typeof import('../server/mcp.ts')['TOOLS'];

before(async () => {
  R = await import('../server/repo/refs.ts');
  svc = await import('../server/repo/services.ts');
  P = await import('../server/repo/presentation.ts');
  TOOLS = (await import('../server/mcp.ts')).TOOLS;
  await import('../server/seed/presentation.ts').then((m) => (m as { seedPresentation?: () => void }).seedPresentation?.());
});

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = { auth: { user: { id: 1, display_name: 'Test', role: 'admin' }, scopes: new Set(['canon:read', 'canon:write']) }, pii: false } as any;

test('form: letters (any script), digits and - _ . ; no spaces; up to 40', () => {
  for (const ok of ['EN-001', 'CN-10pmService', 'zh_晚堂.2', '001']) assert.equal(R.cleanRef('service_template', ok), ok);
  for (const bad of ['has space', '-lead', 'trail-', 'a/b', 'x'.repeat(41)]) assert.throws(() => R.cleanRef('service_template', bad), /not a valid reference/);
  assert.equal(R.cleanRef('service_template', '  '), null);
  assert.equal(R.cleanRef('service_template', undefined), undefined);
});

test('unique per kind, ignoring case; the same code may be used by different kinds', () => {
  const a = svc.templates.insert({ name: { en: 'Test A' }, description: {}, items: [], ref: 'EN-001' });
  assert.throws(() => R.cleanRef('service_template', 'en-001'), /already used by another service template/);
  assert.equal(R.cleanRef('service_template', 'EN-001', a.id), 'EN-001', 'keeping its own reference is fine');
  assert.equal(R.cleanRef('service', 'EN-001'), 'EN-001', 'a service may use the same code');
  assert.equal(R.resolveRef('service_template', 'en-001'), a.id);
  assert.equal(R.resolveRef('service_template', a.id), a.id);
  assert.throws(() => R.resolveRef('service_template', 'NOPE-9'), /No service template with the reference "NOPE-9"/);
  // a reference that looks like a number wins over an id
  const b = svc.templates.insert({ name: { en: 'Test B' }, description: {}, items: [], ref: '1' });
  assert.equal(R.resolveRef('service_template', '1'), b.id);
});

test('a service template brings its slide and bulletin templates; agents name everything by reference', async () => {
  const theme = P.listThemes()[0];
  const bt = P.listTemplates()[0];
  assert.ok(theme && bt, 'built-in presentation templates are seeded');
  P.setThemeRef(theme.id, 'EN-WIDE');
  P.setTemplateRef(bt.id, 'CN-A5');
  assert.throws(() => P.setTemplateRef(P.listTemplates()[1].id, 'cn-a5'), /already used/);
  const tpl = svc.templates.insert({ name: { en: 'Test evening' }, description: {}, items: [], ref: 'CN-10pmService', slide_theme_id: theme.id, bulletin_template_id: bt.id });

  const made = svc.createService({ date: '2034-03-05' }, tpl.id).service;
  assert.equal(made.slide_theme_id, theme.id);
  assert.equal(made.bulletin_template_id, bt.id);
  assert.equal(svc.createService({ date: '2034-03-06', slide_theme_id: null }, tpl.id).service.slide_theme_id, null, 'the service may choose otherwise');

  const created = await tool('canon_create_service').handler({ date: '2034-03-12', template: 'cn-10pmservice', ref: 'CN-2034-03-12' }, ctx) as { service: { id: number; ref: string; slide_template_id: number } };
  assert.equal(created.service.ref, 'CN-2034-03-12');
  assert.equal(created.service.slide_template_id, theme.id);
  const got = await tool('canon_get_service').handler({ id: 'cn-2034-03-12', format: 'structured', include_text: false, include_similar: false }, ctx) as { id: number };
  assert.equal(got.id, created.service.id);
  const upd = await tool('canon_update_service').handler({ id: 'CN-2034-03-12', patch: {}, bulletin_template: null }, ctx) as { bulletin_template_id?: number };
  assert.equal(upd.bulletin_template_id, undefined);
  const list = await tool('canon_get_templates').handler({ kind: 'slide' }, ctx) as { ref?: string }[];
  assert.ok(list.some((x) => x.ref === 'EN-WIDE'));
  const one = await tool('canon_get_templates').handler({ kind: 'service', id: 'CN-10pmService' }, ctx) as { id: number };
  assert.equal(one.id, tpl.id);
  const found = await tool('canon_find_services').handler({ q: 'cn-2034' }, ctx) as { ref?: string }[];
  assert.ok(found.some((x) => x.ref === 'CN-2034-03-12'));
});
