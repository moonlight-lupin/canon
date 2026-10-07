// What Canon prints in a service's languages (bulletin, slides, run sheet, Word, FreeShow): fixed wording such as
// "Order of Service", "Leader" / "People", "Refrain", the seasons. It lives in locales/<code>/outputs.json, keyed by
// the English wording (locales/en/outputs.json), so a new language needs only its file — see
// CONTRIBUTING-TRANSLATIONS.md. A language without a phrase falls back to its fallback language, then English.
import type { L10n, Lang } from './types.ts';
import { OUTPUTS, UI_FALLBACK } from './locales.generated.ts';

/** A printed phrase in one language. */
export function printed(key: string, lang: Lang): string {
  return OUTPUTS[lang]?.[key] ?? (UI_FALLBACK[lang] ? OUTPUTS[UI_FALLBACK[lang]]?.[key] : undefined) ?? OUTPUTS.en?.[key] ?? key;
}

/** A printed phrase in every language that has it, e.g. { en: 'Sermon', zh: '讲道', … }. */
export function printedL10n(key: string): L10n {
  const out: L10n = {};
  for (const [l, d] of Object.entries(OUTPUTS)) if (d[key]) out[l] = d[key];
  if (!out.en) out.en = key;
  return out;
}

/** Whether a language has its own wording for a phrase (not a fallback). */
export const hasPrinted = (key: string, lang: Lang) => !!OUTPUTS[lang]?.[key];
