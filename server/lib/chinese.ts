// Simplified ⇄ Traditional Chinese conversion, so a church using both scripts only has to
// enter Chinese once. Conversion is phrase-aware (OpenCC) and cached.
import * as OpenCC from 'opencc-js';
import type { L10n, Lang } from '../../shared/types.ts';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });
const cache = new Map<string, string>();

function conv(fn: (s: string) => string, tag: string, s: string) {
  const k = tag + s;
  let v = cache.get(k);
  if (v === undefined) {
    v = fn(s);
    if (cache.size > 20000) cache.clear();
    cache.set(k, v);
  }
  return v;
}
export const toTraditional = (s: string) => conv(s2t, 't', s);
export const toSimplified = (s: string) => conv(t2s, 's', s);

/** Value of a localised string in `lang`, deriving one Chinese script from the other when missing. */
export function pick(v: L10n | null | undefined, lang: Lang): string | undefined {
  if (!v) return undefined;
  const direct = v[lang];
  if (direct && direct.trim()) return direct;
  if (lang === 'zh-Hant' && v.zh?.trim()) return toTraditional(v.zh);
  if (lang === 'zh' && v['zh-Hant']?.trim()) return toSimplified(v['zh-Hant']);
  return undefined;
}

/** Copy of `v` with entries filled in for every language in `langs` that can be derived. */
export function complete(v: L10n | null | undefined, langs: Lang[]): L10n {
  const out: L10n = { ...(v ?? {}) };
  for (const l of langs) {
    if (!out[l]?.trim()) {
      const p = pick(v, l);
      if (p) out[l] = p;
    }
  }
  return out;
}
