// Western liturgical calendar: which season a date falls in, with its colour and bilingual name.
import type { L10n, Season } from './types.ts';

export interface SeasonInfo {
  key: Season;
  name: L10n;
  /** accent colour (works on papyrus and on the dark slide theme) */
  color: string;
  /** traditional vestment colour name, for reference */
  liturgical: string;
}

export const SEASONS: Record<Season, SeasonInfo> = {
  advent: { key: 'advent', name: { en: 'Advent', zh: '将临期', 'zh-Hant': '將臨期' }, color: '#5a3f86', liturgical: 'purple / blue' },
  christmas: { key: 'christmas', name: { en: 'Christmastide', zh: '圣诞期', 'zh-Hant': '聖誕期' }, color: '#b38a2e', liturgical: 'white / gold' },
  epiphany: { key: 'epiphany', name: { en: 'Epiphany', zh: '显现期', 'zh-Hant': '顯現期' }, color: '#3d7a5a', liturgical: 'green (white on the feast)' },
  lent: { key: 'lent', name: { en: 'Lent', zh: '大斋期', 'zh-Hant': '大齋期' }, color: '#6b3a6e', liturgical: 'purple' },
  holy_week: { key: 'holy_week', name: { en: 'Holy Week', zh: '圣周', 'zh-Hant': '聖週' }, color: '#8e2b2b', liturgical: 'red / purple' },
  easter: { key: 'easter', name: { en: 'Eastertide', zh: '复活期', 'zh-Hant': '復活期' }, color: '#b8902f', liturgical: 'white / gold' },
  pentecost: { key: 'pentecost', name: { en: 'Pentecost', zh: '五旬节', 'zh-Hant': '五旬節' }, color: '#b5402a', liturgical: 'red' },
  ordinary: { key: 'ordinary', name: { en: 'Ordinary Time', zh: '常年期', 'zh-Hant': '常年期' }, color: '#4f6b34', liturgical: 'green' },
};

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const DAY = 86400_000;

/** Easter Sunday (Gregorian, anonymous algorithm) as a UTC timestamp. */
export function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/** First Sunday of Advent: the Sunday from 27 Nov to 3 Dec. */
export function adventSunday(year: number): number {
  const christmas = utc(year, 12, 25);
  const wd = new Date(christmas).getUTCDay(); // 0 = Sunday
  return christmas - ((wd === 0 ? 7 : wd) + 21) * DAY;
}

/** Season for a YYYY-MM-DD date. */
export function seasonOf(date: string): Season {
  const [y, m, d] = date.split('-').map(Number);
  const t = utc(y, m, d);
  const e = easter(y);
  if (t >= adventSunday(y) && t < utc(y, 12, 25)) return 'advent';
  if (t >= utc(y, 12, 25) || t <= utc(y, 1, 5)) return 'christmas';
  if (t >= e - 46 * DAY && t < e - 7 * DAY) return 'lent';
  if (t >= e - 7 * DAY && t < e) return 'holy_week';
  if (t >= e && t < e + 49 * DAY) return 'easter';
  if (t === e + 49 * DAY) return 'pentecost';
  if (t >= utc(y, 1, 6) && t < e - 46 * DAY) return 'epiphany';
  return 'ordinary';
}

export const seasonInfo = (date: string, override?: Season | null) => SEASONS[override ?? seasonOf(date)];
