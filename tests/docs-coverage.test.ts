// Documentation must keep up with the app. This test fails when:
//  - a sidebar page or Settings tab is not mentioned in the user guide (English, and Chinese by its UI label);
//  - an MCP tool or prompt is not documented in the agent handbook and the Claude skill references.
// If it fails after you add a feature: update docs/guide/en.md + zh.md (then `npm run i18n` for zh-Hant),
// docs/AGENT-PLAYBOOKS.md and skills/canon/references/*.md.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-docs-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

let zhDict: Record<string, string> = {};
before(() => {
  // the Simplified Chinese interface (0.16.0: locales/zh/ui.json)
  zhDict = JSON.parse(read('locales/zh/ui.json')) as Record<string, string>;
});

/** Sidebar labels, read from the navigation definition so new pages are picked up automatically. */
function navLabels(): string[] {
  const src = read('src/components/Layout.tsx');
  return [...src.matchAll(/\{\s*to:\s*'[^']+',\s*label:\s*'([^']+)'/g)].map((m) => m[1]);
}
/** Settings tab labels, read from the Settings page. */
function settingsTabs(): string[] {
  const src = read('src/pages/Settings.tsx');
  // the tabs, in groups: const groups: [Tab, string][][] = [ [['profile', 'My profile']], … ];
  const m = src.match(/const groups: \[Tab, string\]\[\]\[\] = \[([\s\S]*?)\n {2}\];/);
  assert.ok(m, 'Settings tab list not found — update this test if the Settings page changed shape');
  return [...m[1].matchAll(/\[\s*'[^']+',\s*'([^']+)'\s*\]/g)].map((x) => x[1]);
}
const norm = (s: string) => s.toLowerCase().replace(/[‐-―]/g, '-');

test('user guide (EN) mentions every sidebar page and Settings tab', () => {
  const en = norm(read('docs/guide/en.md'));
  const missing = [...navLabels(), ...settingsTabs()].filter((l) => !en.includes(norm(l)));
  assert.deepEqual(missing, [], `docs/guide/en.md does not mention: ${missing.join(', ')}`);
});

test('user guide (中文) mentions every sidebar page and Settings tab by its Chinese label', () => {
  const zh = read('docs/guide/zh.md');
  const missing = [...navLabels(), ...settingsTabs()]
    .map((l) => ({ l, zh: zhDict[l] }))
    .filter((x) => x.zh && !zh.includes(x.zh))
    .map((x) => `${x.l} (${x.zh})`);
  assert.deepEqual(missing, [], `docs/guide/zh.md does not mention: ${missing.join(', ')}`);
  assert.ok(fs.existsSync(path.join(root, 'docs/guide/zh-Hant.md')), 'run `npm run i18n` to generate docs/guide/zh-Hant.md');
});

test('agent handbook and Claude skill document every MCP tool and prompt', async () => {
  const { TOOLS } = await import('../server/mcp.ts');
  const { PROMPTS } = await import('../server/mcp-prompts.ts');
  const handbook = read('docs/AGENT-PLAYBOOKS.md');
  const skillTools = read('skills/canon/references/tools.md') + read('skills/canon/SKILL.md');
  const skillPlaybooks = read('skills/canon/references/playbooks.md') + read('skills/canon/SKILL.md');
  const toolsMissing = TOOLS.map((t) => t.name).filter((n) => !handbook.includes(n) || !skillTools.includes(n));
  assert.deepEqual(toolsMissing, [], `tools missing from docs/AGENT-PLAYBOOKS.md or skills/canon: ${toolsMissing.join(', ')}`);
  const promptsMissing = PROMPTS.map((p) => p.name).filter((n) => !handbook.includes(n) || !skillPlaybooks.includes(n));
  assert.deepEqual(promptsMissing, [], `prompts missing from docs/AGENT-PLAYBOOKS.md or skills/canon: ${promptsMissing.join(', ')}`);
});
