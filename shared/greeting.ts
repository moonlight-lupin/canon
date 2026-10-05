// The dashboard's greeting: it follows the time of day and the church year, and changes from day to day (the same
// all day, so it doesn't jump on every visit). Phrases are English keys translated by the interface dictionary.
import { easter, seasonOf } from './season.ts';
import type { Season } from './types.ts';

const DAY = 86400_000;

/** Greetings that suit each season (besides the time of day). */
const SEASONAL: Record<Season, string[]> = {
  advent: ['Come, Lord Jesus', 'Grace and peace'],
  christmas: ['Glory to God in the highest', 'Grace and peace'],
  epiphany: ['The Light has come', 'Grace and peace'],
  lent: ['Grace and peace', 'The Lord be with you'],
  holy_week: ['Grace and peace'],
  easter: ['Christ is risen', 'Grace and peace'],
  pentecost: ['Peace be with you'],
  ordinary: ['Grace and peace', 'The Lord be with you', 'Peace be with you'],
};

/** Good morning (5–12), good afternoon (12–18), good evening (18–5). */
export function timeOfDay(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The greeting for a moment on this computer's clock (an English key for the interface dictionary). */
export function greetingFor(now: Date): string {
  const date = iso(now);
  const [y, m, d] = date.split('-').map(Number);
  const today = Date.UTC(y, m - 1, d);
  // the great feasts have their own
  if (m === 12 && d === 25) return 'A blessed Christmas';
  if (today === easter(y)) return 'Christ is risen';
  if (today === easter(y) + 49 * DAY) return 'Peace be with you';
  if (now.getDay() === 0) return 'A blessed Lord’s Day';
  // otherwise one of the season's greetings or the time of day, a different one each day
  const options = [timeOfDay(now.getHours()), ...SEASONAL[seasonOf(date)]];
  const dayNumber = Math.floor(today / DAY);
  return options[dayNumber % options.length];
}
