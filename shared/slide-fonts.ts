// Fonts a PowerPoint file can name for the computer that will show it. A slide template's font list is a CSS stack
// ("'PingFang SC', 'Microsoft YaHei', sans-serif"): a browser uses the first one it has, but a PowerPoint file names
// one font per run, so the export picks the first family that system has — or the system's own default for the
// script. "mac" is for Keynote (it opens PowerPoint files), "windows" for PowerPoint on a PC.
// The macOS list is checked on a real Mac in CI (scripts/check-mac-fonts.mjs).
import type { FontScript } from './slide-theme.ts';

export type FontSystem = 'windows' | 'mac';

/** Families every PC (Windows 10/11, with its Chinese fonts) or Mac (macOS 13+) has without extra downloads. */
export const SYSTEM_FONTS: Record<FontSystem, string[]> = {
  windows: [
    'Georgia', 'Palatino Linotype', 'Book Antiqua', 'Times New Roman', 'Segoe UI', 'Arial', 'Verdana', 'Tahoma', 'Calibri', 'Cambria',
    // not PMingLiU / MingLiU / DFKai-SB: Windows adds them only with its optional Traditional Chinese fonts
    'SimSun', 'NSimSun', 'SimHei', 'Microsoft YaHei', 'KaiTi', 'FangSong', 'Microsoft JhengHei',
    'Nirmala UI', 'Malgun Gothic', 'Yu Gothic', 'Meiryo', 'Leelawadee UI',
  ],
  mac: [
    'Georgia', 'Palatino', 'Times New Roman', 'Times', 'Helvetica Neue', 'Helvetica', 'Arial', 'Verdana', 'Tahoma', 'Baskerville', 'Hoefler Text',
    'PingFang SC', 'PingFang TC', 'PingFang HK', 'Songti SC', 'Songti TC', 'Heiti SC', 'Heiti TC', 'Hiragino Sans GB',
    'Apple SD Gothic Neo', 'Hiragino Sans', 'Hiragino Mincho ProN', 'Tamil Sangam MN', 'Thonburi', 'Kohinoor Devanagari',
  ],
};

/** When the template keeps Canon's built-in choice, or none of its fonts is on that system. */
export const SYSTEM_DEFAULT_FONT: Record<FontSystem, Record<FontScript, string>> = {
  windows: { latin: 'Georgia', sc: 'SimSun', tc: 'Microsoft JhengHei', other: 'Nirmala UI' },
  mac: { latin: 'Georgia', sc: 'Songti SC', tc: 'Songti TC', other: 'Helvetica Neue' },
};

/** Labels, posture, footer. */
export const SYSTEM_UI_FONT: Record<FontSystem, string> = { windows: 'Segoe UI', mac: 'Helvetica Neue' };

const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/i;

/** The first family of a CSS font stack that the system has, else its default for the script. */
export function pickFont(stack: string, script: FontScript, system: FontSystem): string {
  const have = new Map(SYSTEM_FONTS[system].map((f) => [f.toLowerCase(), f]));
  for (const raw of stack.split(',')) {
    const family = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!family || GENERIC.test(family)) continue;
    const found = have.get(family.toLowerCase());
    if (found) return found;
  }
  return SYSTEM_DEFAULT_FONT[system][script];
}
