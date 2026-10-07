// Wording of what the server makes itself — e-mails, the visitor form, the sign-in page for AI apps — in a language.
// It lives in locales/<code>/server.json, keyed by the English wording, so a new language needs only its file (see
// CONTRIBUTING-TRANSLATIONS.md). One Chinese script is converted from the other when it lacks a phrase; otherwise a
// language falls back to its fallback language (locales/<code>/meta.json), then English.
import fs from 'node:fs';
import path from 'node:path';
import type { L10n, Lang } from '../../shared/types.ts';
import { UI_FALLBACK } from '../../shared/locales.generated.ts';
import { isCJK } from '../../shared/languages.ts';
import { pick, toSimplified, toTraditional } from './chinese.ts';

const DIR = path.resolve(import.meta.dirname, '../../locales');
let TEXT: Record<string, Record<string, string>> | null = null;

function load(): Record<string, Record<string, string>> {
  if (TEXT) return TEXT;
  TEXT = {};
  if (fs.existsSync(DIR)) {
    for (const d of fs.readdirSync(DIR, { withFileTypes: true })) {
      const f = path.join(DIR, d.name, 'server.json');
      if (d.isDirectory() && fs.existsSync(f)) {
        try {
          TEXT[d.name] = JSON.parse(fs.readFileSync(f, 'utf8')) as Record<string, string>;
        } catch {
          /* a broken file: that language stays English (npm run i18n:check reports it) */
        }
      }
    }
  }
  return TEXT;
}

/** A phrase in `lang` (English key). */
export function st(en: string, lang: Lang): string {
  const T = load();
  const own = T[lang]?.[en];
  if (own) return own;
  if (lang === 'zh-Hant' && T.zh?.[en]) return toTraditional(T.zh[en]);
  if (lang === 'zh' && T['zh-Hant']?.[en]) return toSimplified(T['zh-Hant'][en]);
  const fb = UI_FALLBACK[lang];
  return (fb && T[fb]?.[en]) || en;
}

/** Whether a language has its own wording for the server's text (else it reads English). */
export const hasServerText = (lang: Lang) => !!load()[lang] || ((lang === 'zh' || lang === 'zh-Hant') && !!(load().zh || load()['zh-Hant']));

/** ": " or "：" — how a label is followed in a language. */
export const colonIn = (lang: Lang) => (isCJK(lang) ? '：' : ': ');

/** The church's own content (a welcome text, an option) in `lang`: converted between the Chinese scripts, else English. */
export const contentIn = (v: L10n | null | undefined, lang: Lang): string => pick(v, lang) ?? '';

/** For tests: read the files again. */
export const reloadServerText = () => {
  TEXT = null;
};
