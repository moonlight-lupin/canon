// When a group meets (0.12): every week, every two weeks, or one weekday a month (first … fourth, or last). Used to
// create a group's meetings ahead, so the leader just opens tonight's meeting. Dates are plain YYYY-MM-DD strings.
import type { MeetingPattern } from './types.ts';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T12:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const weekday = (s: string) => parse(s).getUTCDay();

/** Whether a pattern is complete enough to give dates. */
export const patternReady = (p: MeetingPattern | null | undefined): p is MeetingPattern & { every: NonNullable<MeetingPattern['every']>; weekday: number } =>
  !!p && !!p.every && typeof p.weekday === 'number' && p.weekday >= 0 && p.weekday <= 6 && (p.every !== 'month' || (!!p.nth && p.nth >= 1 && p.nth <= 5));

/** The nth (1–4, or 5 = last) given weekday of a month. */
function nthWeekdayOf(year: number, month: number, wd: number, nth: number): string | null {
  if (nth === 5) {
    const last = new Date(Date.UTC(year, month + 1, 0, 12));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - wd + 7) % 7));
    return iso(last);
  }
  const first = new Date(Date.UTC(year, month, 1, 12));
  first.setUTCDate(1 + ((wd - first.getUTCDay() + 7) % 7) + (nth - 1) * 7);
  return first.getUTCMonth() === month ? iso(first) : null;
}

/**
 * The dates from `from` to `to` (both included) on which the group meets. Every two weeks counts from `anchor` (a
 * date it met, e.g. its last meeting) so the rhythm carries on; without one, from the first matching day.
 */
export function meetingDates(p: MeetingPattern | null | undefined, from: string, to: string, anchor?: string | null): string[] {
  if (!patternReady(p) || from > to) return [];
  const out: string[] = [];
  if (p.every === 'month') {
    let y = parse(from).getUTCFullYear();
    let m = parse(from).getUTCMonth();
    for (let i = 0; i < 400; i++) {
      const d = nthWeekdayOf(y, m, p.weekday, p.nth!);
      if (d && d > to) break;
      if (d && d >= from) out.push(d);
      m++;
      if (m === 12) {
        m = 0;
        y++;
      }
      if (`${y}-${String(m + 1).padStart(2, '0')}-01` > to) break;
    }
    return out;
  }
  let first = addDays(from, (p.weekday - weekday(from) + 7) % 7);
  if (p.every === '2weeks' && anchor && weekday(anchor) === p.weekday) {
    // keep the fortnightly rhythm of the last meeting
    const diff = Math.round((parse(first).getTime() - parse(anchor).getTime()) / 86_400_000);
    if (((diff % 14) + 14) % 14 !== 0) first = addDays(first, 7);
  }
  const step = p.every === '2weeks' ? 14 : 7;
  for (let d = first; d <= to; d = addDays(d, step)) out.push(d);
  return out;
}
