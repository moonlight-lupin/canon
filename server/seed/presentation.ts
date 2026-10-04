// Built-in slide themes and bulletin templates, seeded idempotently by a stable key (key → id is kept in the
// settings meta `presentation_builtins`). Re-running adds only what is missing; built-ins are read-only in the app.
import type { L10n } from '../../shared/types.ts';
import {
  DEFAULT_BULLETIN_OPTIONS, DEFAULT_THEME_VARS, FONT_PRESETS, LIGHT_THEME_COLOURS, legacyLayout,
  type BulletinOptions, type SlideThemeVars,
} from '../../shared/presentation.ts';
import { tx } from '../db.ts';
import { builtins, bulletinTemplates, setBuiltins, slideThemes } from '../repo/presentation.ts';

const sans = (k: 'latin' | 'sc' | 'tc') => FONT_PRESETS[k].find((f) => /sans/i.test(f.stack))!.stack;

export const BUILTIN_THEMES: { key: string; name: L10n; base: 'dark' | 'light'; vars: SlideThemeVars; css: string }[] = [
  { key: 'ink', name: { en: 'Ink (dark)', zh: '墨色（深色）' }, base: 'dark', vars: DEFAULT_THEME_VARS, css: '' },
  { key: 'papyrus', name: { en: 'Papyrus (light)', zh: '纸草（浅色）' }, base: 'light', vars: { ...DEFAULT_THEME_VARS, ...LIGHT_THEME_COLOURS }, css: '' },
  {
    key: 'contrast',
    name: { en: 'High contrast', zh: '高对比度' },
    base: 'dark',
    vars: {
      ...DEFAULT_THEME_VARS,
      bg: '#000000', fg: '#ffffff', accent: '#ffd60a', heading: '#ffffff',
      font_latin: sans('latin'), font_sc: sans('sc'), font_tc: sans('tc'),
      scale: 1.05, line_height: 1.25,
    },
    css: `/* Heavier words for people with low vision */
.slide-lyrics, .slide-text, .slide-scripture { font-weight: 600; }
.slide-who, .slide-verse-num, .slide-stanza-label { color: #ffd60a; }`,
  },
  {
    key: 'season',
    name: { en: 'Season', zh: '节期' },
    base: 'dark',
    vars: { ...DEFAULT_THEME_VARS, bg: '#161a22', accent_from_season: true },
    css: `/* A band in the season colour along the foot of every slide (turn on season colours in Settings) */
.slide { box-shadow: inset 0 -14px 0 var(--slide-accent); }`,
  },
];

const orderOnly: BulletinOptions = {
  ...DEFAULT_BULLETIN_OPTIONS,
  print: { song: 'title', scripture: 'reference', text: 'full', other: 'title' },
};
const largePrint: BulletinOptions = {
  ...DEFAULT_BULLETIN_OPTIONS,
  paper: 'a4',
  layout: 'stacked',
  font_pt: 15,
  languages: 'primary',
  sections: { ...DEFAULT_BULLETIN_OPTIONS.sections, sermon_notes: false },
};
// Explicit page layouts, matching what the built-ins printed before layouts existed:
// cover → order → sermon notes on a spare booklet page → back cover (service notes, roster, notices, contact).
largePrint.page_layout = legacyLayout(largePrint);

export const BUILTIN_TEMPLATES: { key: string; name: L10n; description: L10n; options: BulletinOptions }[] = [
  {
    key: 'full',
    name: { en: 'Full words booklet', zh: '完整歌词经文本' },
    description: {
      en: 'Every hymn, reading and liturgy printed in full. A4 folded into an A5 booklet.',
      zh: '诗歌、经文、礼文全部印出。A4 对折成 A5 小册子。',
    },
    options: DEFAULT_BULLETIN_OPTIONS,
  },
  {
    key: 'order',
    name: { en: 'Order of service only', zh: '仅聚会程序' },
    description: {
      en: 'Hymn titles and Bible references only, for churches that project the words. Creeds and liturgy stay in full.',
      zh: '只印诗歌名称和经文出处，适合用投影显示歌词的教会。信经与礼文仍完整印出。',
    },
    options: orderOnly,
  },
  {
    key: 'large',
    name: { en: 'Large print', zh: '大字版' },
    description: {
      en: 'Bigger type, the main language only, on A4 portrait pages — easier for those who find small print hard to read.',
      zh: '较大字体、只印主要语言、A4 直式——方便视力较弱的会友阅读。',
    },
    options: largePrint,
  },
];

/** Insert any built-in theme / template that is missing. Returns how many were added. */
export function seedPresentation(): number {
  return tx(() => {
    const b = builtins();
    let added = 0;
    BUILTIN_THEMES.forEach((t, i) => {
      const id = b.slide[t.key];
      if (id && slideThemes.find(id)) return;
      b.slide[t.key] = slideThemes.insert({ name: t.name, base: t.base, vars: t.vars, css: t.css || undefined, sort: i - 100 }).id;
      added++;
    });
    BUILTIN_TEMPLATES.forEach((t, i) => {
      const id = b.bulletin[t.key];
      const cur = id ? bulletinTemplates.find(id) : undefined;
      // built-ins saved before page layouts existed get their explicit layout (they are read-only in the app)
      if (cur && !Array.isArray((cur.options as Partial<BulletinOptions> | null)?.page_layout)) bulletinTemplates.update(cur.id, { options: t.options });
      if (cur) return;
      b.bulletin[t.key] = bulletinTemplates.insert({ name: t.name, description: t.description, options: t.options, sort: i - 100 }).id;
      added++;
    });
    if (added) setBuiltins(b);
    return added;
  });
}
