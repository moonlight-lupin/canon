// Reports (Records → Reports): what each report returns, shared by the server, the web app and the MCP tools.
// Amounts are minor units (cents) as in service records; dates are YYYY-MM-DD.
import type { L10n } from './types.ts';
import type { OfferingMethod, VisitorStatus } from './records.ts';
export { VISITOR_STATUSES, type VisitorStatus } from './records.ts';

export interface Period {
  from: string;
  to: string;
  congregation_id?: number;
}

export type ReportKind = 'attendance' | 'offerings' | 'visitors' | 'serving' | 'songs' | 'scripture' | 'membership';
export const REPORT_KINDS: ReportKind[] = ['attendance', 'offerings', 'visitors', 'serving', 'songs', 'scripture', 'membership'];

export interface ServiceRef {
  service_id: number;
  date: string;
  start_time: string;
  title: L10n;
  congregation_id: number | null;
}

export interface AttendanceReport {
  period: Period;
  rows: (ServiceRef & { recorded: boolean; attendance: number | null; children: number | null; online: number | null; visitors: number })[];
  summary: { services: number; recorded: number; average: number | null; median: number | null; highest: { date: string; value: number } | null; lowest: { date: string; value: number } | null; children_average: number | null; online_average: number | null; visitors: number };
  /** the same period a year earlier */
  previous: { from: string; to: string; recorded: number; average: number | null };
  months: { month: string; services: number; average: number | null; visitors: number }[];
  congregations: { congregation_id: number | null; recorded: number; average: number | null }[];
}

export interface OfferingsReport {
  period: Period;
  currency: string;
  funds: string[];
  months: string[];
  /** in the church's currency */
  by_fund_month: { month: string; fund: string; total: number }[];
  by_fund: { fund: string; total: number }[];
  by_method: { method: OfferingMethod; total: number }[];
  total: number;
  /** offerings in other currencies, never converted; `converted` = what was entered as the exchanged value */
  other_currencies: { currency: string; total: number; cash: number; converted: number }[];
  services: (ServiceRef & { total: number; cash: number; verified: boolean; verified_by: string | null; signed: boolean; other: { currency: string; total: number }[] })[];
  /** cash counts with offerings but not yet verified, oldest first */
  unverified: (ServiceRef & { total: number; days: number })[];
}

export interface VisitorsReport {
  period: Period;
  visitors: (ServiceRef & { name: string; source: string | null; follow_up_by: string | null; status: VisitorStatus; contact?: string | null })[];
  /** how many reached each step (a visitor who joined was also contacted and came back) */
  funnel: Record<VisitorStatus, number>;
  sources: { source: string; count: number }[];
  /** "Which describes you best?" answers, counted (editors and administrators only) */
  abouts?: { about: string; count: number }[];
  months: { month: string; count: number }[];
}

export interface ServingReport {
  period: Period;
  services: number;
  people: { person_id: number; name: string; served: number; confirmed: number; declined: number; last_served: string | null; teams: string[] }[];
  /** serving-team members not rostered in the period (with the last time they served, if ever) */
  idle: { person_id: number; name: string; teams: string[]; last_served: string | null }[];
  roles: { role_id: number; team: L10n; role: L10n; needed: number; services: number; short: number; declined: number; qualified: number }[];
}

export interface SongsReport {
  period: Period;
  services: number;
  songs: { song_id: number; title: L10n; category: string; times: number; first_used: string; last_used: string; public_domain: boolean; copyright: string | null; ccli: string | null }[];
  /** songs in the library not sung in the period */
  unused: { song_id: number; title: L10n; category: string; last_used: string | null }[];
}

export interface ScripturePassage {
  date: string;
  service_id: number;
  kind: 'reading' | 'sermon';
  ref: string;
  /** the chapters it touches, per book (empty when the reference could not be read, e.g. "see bulletin") */
  chapters: { book: number; chapters: number[] }[];
}

/** Which chapters were read and preached: every book of the Bible, every chapter. */
export interface ScriptureReport {
  period: Period;
  /** the years chosen instead of a period (empty = the period) */
  years: number[];
  /** years that have services, for the year filter */
  years_available: number[];
  services: number;
  /** all 66 books; `read[i]` / `preached[i]` = how often chapter i+1 was read / preached */
  books: { book: number; en: string; zh: string; zhT: string; chapters: number; read: number[]; preached: number[] }[];
  passages: ScripturePassage[];
  totals: { chapters: number; read: number; preached: number; both: number; covered: number; ot_covered: number; nt_covered: number; books_covered: number };
}

export interface MembershipReport {
  period: Period;
  total: number;
  by_status: { status: string; count: number }[];
  by_congregation: { congregation_id: number | null; count: number }[];
  by_gender: { gender: string; count: number }[];
  /** members and regulars by age; `unknown` = no birth date */
  age_bands: { band: string; count: number }[];
  joined: { person_id: number; name: string; date: string }[];
  baptised: { person_id: number; name: string; date: string }[];
  added: number;
}

export const AGE_BANDS = ['0–12', '13–19', '20–29', '30–39', '40–49', '50–59', '60–69', '70+', 'unknown'] as const;

/** Age band of a birth date on a day. */
export function ageBand(birth: string | null | undefined, on: string): (typeof AGE_BANDS)[number] {
  if (!birth || !/^\d{4}-\d{2}-\d{2}/.test(birth)) return 'unknown';
  let age = Number(on.slice(0, 4)) - Number(birth.slice(0, 4));
  if (on.slice(5, 10) < birth.slice(5, 10)) age--;
  if (age < 0) return 'unknown';
  if (age <= 12) return '0–12';
  if (age <= 19) return '13–19';
  if (age >= 70) return '70+';
  return `${Math.floor(age / 10) * 10}–${Math.floor(age / 10) * 10 + 9}` as (typeof AGE_BANDS)[number];
}

/** "2026-01" … "2026-04" for a period. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 600; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    if (k > end) break;
    out.push(k);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** The same dates a year earlier (29 February → 28 February). */
export const yearEarlier = (d: string) => {
  const y = String(Number(d.slice(0, 4)) - 1).padStart(4, '0');
  const md = d.slice(5, 10) === '02-29' ? '02-28' : d.slice(5, 10);
  return `${y}-${md}`;
};

/** Trailing moving average over n values (nulls skipped). */
export function movingAverage(values: (number | null)[], n = 4): (number | null)[] {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v): v is number => v != null);
    return w.length ? Math.round((w.reduce((s, v) => s + v, 0) / w.length) * 10) / 10 : null;
  });
}

export const average = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 10) / 10 : null);
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A CSV file (with a BOM so Excel reads Chinese correctly). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    // a leading = + - @ would run as a formula in a spreadsheet
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
