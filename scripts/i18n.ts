// Canon's translations — see CONTRIBUTING-TRANSLATIONS.md.
//   npm run i18n                 keep Chinese in step, write the English list and shared/locales.generated.ts
//   npm run i18n:check [code]    what a language still needs (all languages without a code); fails on broken
//                                placeholders or when `npm run i18n` has not been run after a change
//   npm run i18n:new <code>      start a language: locales/<code>/ui.json
//   npm run i18n -- --prune      also take phrases the code no longer has out of every translation
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, check, codeStrings, localeCodes, plan, readUi, sortDict, stale, writePlan } from './i18n-lib.ts';
import { LANGUAGE_CATALOG } from '../shared/languages.ts';

const [mode, arg] = process.argv.slice(2);

if (mode === 'new') {
  const code = arg ?? '';
  const info = LANGUAGE_CATALOG.find((l) => l.code === code);
  if (!info) {
    console.error(`Unknown language code "${code}". Use one from shared/languages.ts (e.g. ms, id, ta, ko, ja, es, tl, vi).`);
    process.exit(1);
  }
  const dir = path.join(ROOT, 'locales', code);
  if (fs.existsSync(path.join(dir, 'ui.json'))) {
    console.error(`locales/${code}/ui.json already exists.`);
    process.exit(1);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ui.json'), '{}\n');
  writePlan(plan());
  console.log(`Started ${info.name} (${info.native}): locales/${code}/ui.json.`);
  console.log(`Translate phrases from locales/en/ui.json into it (only the ones you translate; the rest stay English).`);
  console.log(`Then: npm run i18n:check ${code}`);
  process.exit(0);
}

if (mode === '--prune') {
  // take phrases the code no longer has out of every translation
  const first = plan();
  const used = codeStrings();
  for (const code of localeCodes()) {
    const { unused } = check(code, first.catalogue, used);
    if (!unused.length) continue;
    const d = readUi(code);
    for (const k of unused) delete d[k];
    fs.writeFileSync(path.join(ROOT, 'locales', code, 'ui.json'), JSON.stringify(sortDict(d), null, 2) + '\n');
    console.log(`${code}: removed ${unused.length} phrases no longer used`);
  }
}

const p = plan();
if (mode !== '--check' && mode !== 'check') {
  writePlan(p);
  for (const n of p.notes) console.warn(`! ${n}`);
  console.log(`English phrases: ${p.catalogue.length}`);
  for (const [c, f] of Object.entries(p.coverage)) console.log(`  ${c.padEnd(8)} ${String(Math.round(f * 100)).padStart(3)} %`);
  process.exit(0);
}

let failed = false;
const out = stale(p);
if (out.length) {
  console.error(`Out of date — run npm run i18n: ${out.join(', ')}`);
  failed = true;
}
for (const n of p.notes) console.warn(`! ${n}`);
const used = codeStrings();
for (const code of arg ? [arg] : localeCodes()) {
  if (code === 'en') continue;
  const r = check(code, p.catalogue, used);
  const hasUi = code in p.coverage;
  const ui = hasUi ? `interface ${Math.round(p.coverage[code] * 100)} % (${r.missing.length} to translate, ${r.unused.length} no longer used)` : 'no interface translation';
  const part = (n: number) => (n ? `${n} to translate` : 'complete');
  console.log(`\n${code}: ${ui}; printed labels ${part(r.missingOutputs.length)}; e-mails and public pages ${part(r.missingServer.length)}; ${r.badPlaceholders.length} with placeholders that don't match`);
  if (arg) for (const k of r.missingServer) console.log(`  server wording to translate: ${JSON.stringify(k)}`);
  for (const k of r.unknownServer) console.log(`  server wording no longer used: ${JSON.stringify(k)}`);
  if (arg && hasUi) for (const k of r.missing.slice(0, 40)) console.log(`  to translate: ${JSON.stringify(k)}`);
  if (arg && hasUi && r.missing.length > 40) console.log(`  … and ${r.missing.length - 40} more`);
  if (arg) for (const k of r.missingOutputs) console.log(`  printed label to translate: ${JSON.stringify(k)}`);
  for (const k of r.unknownOutputs) console.log(`  printed label not in locales/en/outputs.json: ${JSON.stringify(k)}`);
  for (const k of r.unused.slice(0, 20)) console.log(`  no longer used: ${JSON.stringify(k)}`);
  for (const k of r.badPlaceholders) console.log(`  placeholders differ: ${JSON.stringify(k)}`);
  if (r.badPlaceholders.length) failed = true;
}
process.exit(failed ? 1 : 0);
