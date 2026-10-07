// Canon's translations (0.16.0): one folder per language under locales/<code>/ — see CONTRIBUTING-TRANSLATIONS.md.
//   ui.json       the interface: English phrase → translation (only what is translated; the rest stays English)
//   outputs.json  what is printed in this language in bulletins, slides and exports (section headings, "Leader" /
//                 "People", "Refrain", seasons …): English wording (locales/en/outputs.json) → translation
//   meta.json     optional: { "fallback": "id" } — a language to use for phrases this one lacks, before English
// The user guide is docs/guide/<code>.md. `npm run i18n` (this file, via scripts/i18n.ts):
//   - keeps Simplified and Traditional Chinese in step both ways: edit either; the other follows (what was written
//     by hand in both stays as it is) — for ui.json and for the user guide;
//   - writes locales/en/ui.json, every English phrase in Canon (the list translators work from);
//   - writes shared/locales.generated.ts: which languages have an interface, how complete each is, their fallbacks.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as OpenCC from 'opencc-js';

export const ROOT = path.resolve(import.meta.dirname, '..');
const LOCALES = path.join(ROOT, 'locales');
const SYNC_STATE = path.join(LOCALES, '.zh-sync.json');
const GUIDE = path.join(ROOT, 'docs/guide');
const GENERATED = path.join(ROOT, 'shared/locales.generated.ts');
const HANT_GUIDE_HEAD = '<!-- Kept in step with zh.md by `npm run i18n`: edit either one, and the other follows. -->\n';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

export type Dict = Record<string, string>;

const readJson = <T,>(p: string, dflt: T): T => (fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')) as T) : dflt);
export const sortDict = (o: Dict): Dict => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const json = (o: unknown) => JSON.stringify(o, null, 2) + '\n';
const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The language folders: locales/<code>/ (not en, which is generated, nor hidden ones). */
export function localeCodes(): string[] {
  if (!fs.existsSync(LOCALES)) return [];
  return fs.readdirSync(LOCALES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('_') && d.name !== 'en')
    .map((d) => d.name)
    .sort();
}
export const readUi = (code: string): Dict => readJson<Dict>(path.join(LOCALES, code, 'ui.json'), {});
export const readOutputs = (code: string): Dict => readJson<Dict>(path.join(LOCALES, code, 'outputs.json'), {});
/** Languages with an interface translation (locales/<code>/ui.json). */
export const uiCodes = () => localeCodes().filter((c) => fs.existsSync(path.join(LOCALES, c, 'ui.json')));

// ---------------------------------------------------------------- Simplified ⇄ Traditional

export interface ZhSyncState { ui: Record<string, [string, string]>; outputs?: Record<string, [string, string]>; guide?: [string, string] }

/**
 * One phrase kept in step: `prev` is the pair as last synced. Whichever side changed since then is converted into
 * the other; if both changed, both stay (written by hand). A phrase removed from one side, the other unchanged,
 * goes from both. Returns the new pair, or null when it is gone.
 */
export function syncPair(zh: string | undefined, hant: string | undefined, prev: [string, string] | undefined): [string, string] | null {
  if (zh === undefined && hant === undefined) return null;
  if (prev) {
    if (zh === undefined && hant === prev[1]) return null;
    if (hant === undefined && zh === prev[0]) return null;
  }
  if (zh !== undefined && hant === undefined) return [zh, s2t(zh)];
  if (hant !== undefined && zh === undefined) return [t2s(hant), hant];
  const zChanged = !prev || zh !== prev[0];
  const hChanged = !prev || hant !== prev[1];
  if (prev && zChanged && !hChanged) return [zh!, s2t(zh!)];
  if (prev && hChanged && !zChanged) return [t2s(hant!), hant!];
  return [zh!, hant!];
}

/** A whole Simplified / Traditional pair of dictionaries kept in step (`prev`: the pairs as last synced). */
export function syncChineseDicts(zh: Dict, hant: Dict, prev: Record<string, [string, string]>): { zh: Dict; hant: Dict; state: Record<string, [string, string]> } {
  const out = { zh: {} as Dict, hant: {} as Dict, state: {} as Record<string, [string, string]> };
  for (const k of new Set([...Object.keys(zh), ...Object.keys(hant)])) {
    const pair = syncPair(zh[k], hant[k], prev[k]);
    if (!pair) continue;
    [out.zh[k], out.hant[k]] = pair;
    out.state[k] = pair;
  }
  out.zh = sortDict(out.zh);
  out.hant = sortDict(out.hant);
  return out;
}

export function syncChineseUi(zh: Dict, hant: Dict, state: ZhSyncState): { zh: Dict; hant: Dict; state: ZhSyncState } {
  const r = syncChineseDicts(zh, hant, state.ui);
  return { zh: r.zh, hant: r.hant, state: { ...state, ui: r.state } };
}

/** The user guide, as a whole file: the side that changed since the last sync is converted into the other. */
export function syncChineseGuide(zhMd: string, hantMd: string | null, prev: [string, string] | undefined): { zh: string; hant: string; state: [string, string]; note?: string } {
  const body = (s: string) => s.replace(/^<!--[^\n]*-->\n/, '');
  const hb = hantMd === null ? null : body(hantMd);
  let zh = zhMd;
  let hant = hb;
  let note: string | undefined;
  if (hb === null) hant = s2t(zhMd);
  else if (prev) {
    const zChanged = hash(zhMd) !== prev[0];
    const hChanged = hash(hb) !== prev[1];
    if (zChanged && !hChanged) hant = s2t(zhMd);
    else if (hChanged && !zChanged) zh = t2s(hb);
    else if (zChanged && hChanged) note = 'docs/guide/zh.md and zh-Hant.md were both edited: both kept as they are. Bring them together by hand, then run npm run i18n again.';
  } else hant = s2t(zhMd);
  return { zh, hant: HANT_GUIDE_HEAD + hant!, state: [hash(zh), hash(hant!)], note };
}

// ---------------------------------------------------------------- the English phrase list

/** English phrases written in the code as t('…') / tr('…'): the ones that should be translated. */
export function literalPhrases(dirs = ['src', 'shared']): Set<string> {
  const found = new Set<string>();
  const unq = (s: string) => s.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.includes('generated')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/\b(?:t|tr)\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g)) found.add(unq(m[2]));
        for (const m of src.matchAll(/\b(?:t|tr)\(\s*`([^`$\\]*)`/g)) found.add(m[1]);
      }
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  found.delete('');
  return found;
}

/** Every phrase anywhere in the code as a string (to tell a translation that is no longer used). */
export function codeStrings(dirs = ['src', 'shared', 'server']): Set<string> {
  const found = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|mts)$/.test(e.name) && !e.name.includes('generated')) {
        const src = fs.readFileSync(p, 'utf8');
        // each kind of quote on its own (an apostrophe in on-screen text then upsets only its own line)
        const unq = (x: string) => x.replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, '\n');
        for (const m of src.matchAll(/'((?:\\.|[^'\\\n])*)'/g)) found.add(unq(m[1]));
        for (const m of src.matchAll(/"((?:\\.|[^"\\\n])*)"/g)) found.add(unq(m[1]));
        for (const m of src.matchAll(/`((?:\\.|[^`\\])*)`/g)) found.add(unq(m[1]));
      }
    }
  };
  for (const d of dirs) walk(path.join(ROOT, d));
  return found;
}

export const placeholders = (s: string) => [...s.matchAll(/\{[a-z_]+\}/gi)].map((m) => m[0]).sort().join(' ');

// ---------------------------------------------------------------- everything `npm run i18n` writes

export interface Plan { files: Map<string, string>; notes: string[]; coverage: Record<string, number>; catalogue: string[] }

export function plan(): Plan {
  const files = new Map<string, string>();
  const notes: string[] = [];
  const codes = uiCodes();
  const state = readJson<ZhSyncState>(SYNC_STATE, { ui: {} });
  const dicts = new Map<string, Dict>(codes.map((c) => [c, readUi(c)]));
  const outputs = new Map<string, Dict>(['en', ...localeCodes()].map((c) => [c, readOutputs(c)]));

  // Simplified ⇄ Traditional Chinese
  if (dicts.has('zh') || dicts.has('zh-Hant')) {
    const r = syncChineseUi(dicts.get('zh') ?? {}, dicts.get('zh-Hant') ?? {}, state);
    dicts.set('zh', r.zh);
    dicts.set('zh-Hant', r.hant);
    files.set(path.join(LOCALES, 'zh/ui.json'), json(r.zh));
    files.set(path.join(LOCALES, 'zh-Hant/ui.json'), json(r.hant));
    state.ui = r.state.ui;
    const zhMd = path.join(GUIDE, 'zh.md');
    if (fs.existsSync(zhMd)) {
      const hantPath = path.join(GUIDE, 'zh-Hant.md');
      const g = syncChineseGuide(fs.readFileSync(zhMd, 'utf8'), fs.existsSync(hantPath) ? fs.readFileSync(hantPath, 'utf8') : null, state.guide);
      files.set(zhMd, g.zh);
      files.set(hantPath, g.hant);
      state.guide = g.state;
      if (g.note) notes.push(g.note);
    }
    // the printed labels, the same way
    const o = syncChineseDicts(outputs.get('zh') ?? {}, outputs.get('zh-Hant') ?? {}, state.outputs ?? {});
    outputs.set('zh', o.zh);
    outputs.set('zh-Hant', o.hant);
    files.set(path.join(LOCALES, 'zh/outputs.json'), json(o.zh));
    files.set(path.join(LOCALES, 'zh-Hant/outputs.json'), json(o.hant));
    state.outputs = o.state;
    files.set(SYNC_STATE, json(state));
  }

  // the English list: what the code asks to translate (t('…')), and the phrases translations have that are still in
  // the code as text (labels kept in tables, e.g. STATUS_LABEL); a phrase gone from the code drops out
  const all = new Set(literalPhrases());
  const used = codeStrings();
  for (const d of dicts.values()) for (const k of Object.keys(d)) if (used.has(k)) all.add(k);
  const catalogue = [...all].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  files.set(path.join(LOCALES, 'en/ui.json'), json(Object.fromEntries(catalogue.map((k) => [k, k]))));

  // which languages have an interface, how complete, and their fallbacks
  const coverage: Record<string, number> = {};
  const fallback: Record<string, string> = {};
  for (const c of codes) {
    const d = dicts.get(c)!;
    coverage[c] = Math.round((catalogue.filter((k) => d[k]?.trim()).length / Math.max(1, catalogue.length)) * 1000) / 1000;
  }
  for (const c of localeCodes()) {
    const meta = readJson<{ fallback?: string }>(path.join(LOCALES, c, 'meta.json'), {});
    if (meta.fallback) fallback[c] = meta.fallback;
  }
  // the two Chinese scripts fall back to each other
  if (codes.includes('zh-Hant') && !fallback['zh-Hant']) fallback['zh-Hant'] = 'zh';
  if (codes.includes('zh') && codes.includes('zh-Hant') && !fallback.zh) fallback.zh = 'zh-Hant';
  files.set(GENERATED, [
    '// GENERATED by `npm run i18n` from locales/<code>/ — do not edit. See CONTRIBUTING-TRANSLATIONS.md.',
    '/** Languages with an interface translation (a locales/<code>/ui.json), English first. */',
    `export const UI_LOCALES: string[] = ${JSON.stringify(['en', ...codes])};`,
    '/** How much of the interface each language has (0–1). */',
    `export const UI_COVERAGE: Record<string, number> = ${JSON.stringify({ en: 1, ...coverage })};`,
    '/** For a phrase a language lacks: this language next, then English. */',
    `export const UI_FALLBACK: Record<string, string> = ${JSON.stringify(fallback)};`,
    '/** What is printed in each language (locales/<code>/outputs.json), keyed by the English wording. */',
    `export const OUTPUTS: Record<string, Record<string, string>> = ${JSON.stringify(Object.fromEntries([...outputs].filter(([, d]) => Object.keys(d).length)), null, 1)};`,
    '',
  ].join('\n'));
  return { files, notes, coverage, catalogue };
}

/** Files whose content would change (a stale generated file, or Chinese out of step). */
export const stale = (p: Plan) => [...p.files].filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c).map(([f]) => path.relative(ROOT, f).replace(/\\/g, '/'));

export function writePlan(p: Plan) {
  for (const [f, c] of p.files) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== c) fs.writeFileSync(f, c);
  }
}

/** Problems in one language: phrases still to translate, ones no longer used, placeholders that don't match. */
export function check(code: string, catalogue: string[], used = codeStrings()) {
  const d = readUi(code);
  const missing = catalogue.filter((k) => !d[k]?.trim());
  const listed = new Set(catalogue);
  const unused = Object.keys(d).filter((k) => !listed.has(k) && !used.has(k));
  const badPlaceholders = Object.entries(d).filter(([k, v]) => v.trim() && placeholders(k) !== placeholders(v)).map(([k]) => k);
  // printed labels: against the English list (an English value may drop a placeholder, e.g. "Stanza {n}" → "{n}")
  const en = readOutputs('en');
  const o = readOutputs(code);
  const missingOutputs = Object.keys(en).filter((k) => !o[k]?.trim());
  const unknownOutputs = Object.keys(o).filter((k) => !(k in en));
  // a translation may only use the placeholders its English wording has; a date may also use {d} {m} {mon} in any order
  const allowed = (k: string) => new Set([...placeholders(k).split(' '), ...(k.includes('{d}') ? ['{d}', '{m}', '{mon}'] : [])].filter(Boolean));
  const badOutputPlaceholders = Object.entries(o).filter(([k, v]) => k in en && placeholders(v).split(' ').some((x) => x && !allowed(k).has(x))).map(([k]) => k);
  return { missing, unused, badPlaceholders: [...badPlaceholders, ...badOutputPlaceholders.map((k) => `outputs: ${k}`)], missingOutputs, unknownOutputs };
}
