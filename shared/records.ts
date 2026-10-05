// Service records (the meeting tracker): attendance, new visitors, notes for the team, offerings and the cash
// count with its declaration. Amounts are kept in minor units (cents) so totals never suffer from rounding.

export type OfferingMethod = 'cash' | 'cheque' | 'transfer' | 'paynow' | 'card' | 'other';
export const OFFERING_METHODS: OfferingMethod[] = ['cash', 'cheque', 'transfer', 'paynow', 'card', 'other'];
/** English UI labels (translated with t()). */
export const METHOD_LABEL: Record<OfferingMethod, string> = { cash: 'Cash', cheque: 'Cheque', transfer: 'Bank transfer', paynow: 'PayNow', card: 'Card', other: 'Other' };

export interface OfferingLine {
  fund: string;
  method: OfferingMethod;
  /** minor units (cents) of `currency` */
  amount: number;
  /** another currency than the record's (e.g. a USD note in an SGD church); absent = the record's currency */
  currency?: string;
  note?: string;
}

/** Cash in another currency: counted by denomination (known currencies) or as a total, and its value once exchanged. */
export interface ForeignCash {
  /** denomination (minor units) → count, for currencies Canon knows */
  cash?: Record<string, number>;
  /** the counted total in minor units, for other currencies */
  total?: number;
  /** what it was worth in the record's currency when exchanged or banked (minor units); entered by hand */
  converted?: number | null;
}

/** A counter's signature drawn on screen. */
export interface Signature {
  name: string;
  /** PNG data URL of the drawn signature */
  image: string;
  signed_at: string;
  /** the Canon account that was signed in */
  by: string;
  /** fingerprint of the money when signed: a later change makes the signature stale */
  hash: string;
}

/** How far a new visitor has come: contacted by the church, came back, joined. */
export type VisitorStatus = 'new' | 'contacted' | 'returning' | 'joined';
export const VISITOR_STATUSES: VisitorStatus[] = ['new', 'contacted', 'returning', 'joined'];
/** English UI labels (translated with t()). */
export const VISITOR_STATUS_LABEL: Record<VisitorStatus, string> = { new: 'New', contacted: 'Contacted', returning: 'Came back', joined: 'Joined the church' };

export interface Visitor {
  name: string;
  /** follow-up progress (absent = new) */
  status?: VisitorStatus;
  contact?: string;
  /** how they heard of the church / who brought them */
  source?: string;
  follow_up_by?: string;
  notes?: string;
  /** a prayer request (from the visitor form): sensitive, shown like contact details */
  prayer?: string;
  /** how they describe themselves, e.g. "Interested in the Christian faith": sensitive, shown like contact details */
  about?: string;
}

export interface ServiceRecord {
  id: number;
  service_id: number;
  attendance: number | null;
  children: number | null;
  online: number | null;
  visitors: Visitor[];
  notes: string | null;
  offerings: OfferingLine[];
  /** cash count: denomination (minor units, as a string key) → number of notes / coins */
  cash: Record<string, number>;
  /** the people who counted the cash */
  counters: string[];
  currency: string;
  /** cash in other currencies, by currency code */
  foreign_cash: Record<string, ForeignCash>;
  /** counters' signatures drawn on screen (when the church signs on screen) */
  signatures: Signature[];
  verified_at: string | null;
  verified_by: string | null;
  /** the day the cash was counted, YYYY-MM-DD (null = the service date) */
  counted_on: string | null;
  updated_at: string;
}

/** Notes and coins per currency, largest first, in minor units. */
export const DENOMINATIONS: Record<string, { notes: number[]; coins: number[]; decimals: number }> = {
  SGD: { notes: [100000, 10000, 5000, 1000, 500, 200], coins: [100, 50, 20, 10, 5], decimals: 2 },
  MYR: { notes: [10000, 5000, 2000, 1000, 500, 100], coins: [50, 20, 10, 5], decimals: 2 },
  IDR: { notes: [10000000, 5000000, 2000000, 1000000, 500000, 200000, 100000], coins: [100000, 50000, 20000, 10000], decimals: 2 },
  USD: { notes: [10000, 5000, 2000, 1000, 500, 200, 100], coins: [100, 50, 25, 10, 5, 1], decimals: 2 },
  HKD: { notes: [100000, 50000, 10000, 5000, 2000, 1000], coins: [1000, 500, 200, 100, 50, 20, 10], decimals: 2 },
  TWD: { notes: [200000, 100000, 50000, 20000, 10000], coins: [5000, 1000, 500, 100], decimals: 2 },
  CNY: { notes: [10000, 5000, 2000, 1000, 500, 100], coins: [100, 50, 10], decimals: 2 },
  AUD: { notes: [10000, 5000, 2000, 1000, 500], coins: [200, 100, 50, 20, 10, 5], decimals: 2 },
  GBP: { notes: [5000, 2000, 1000, 500], coins: [200, 100, 50, 20, 10, 5, 2, 1], decimals: 2 },
  EUR: { notes: [50000, 20000, 10000, 5000, 2000, 1000, 500], coins: [200, 100, 50, 20, 10, 5, 2, 1], decimals: 2 },
};
export const CURRENCIES = Object.keys(DENOMINATIONS);

export const cashTotal = (cash: Record<string, number>) =>
  Object.entries(cash).reduce((sum, [d, n]) => sum + Number(d) * (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0), 0);

/** Total of the offering lines (optionally one method), in one currency (default: lines in the record's currency). */
export const methodTotal = (lines: OfferingLine[], method?: OfferingMethod, currency?: string, main?: string) =>
  lines
    .filter((l) => (!method || l.method === method) && (currency === undefined || (l.currency ?? main) === currency || (!l.currency && currency === main)))
    .reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0);

/** The currencies other than the record's that appear in the offerings, sorted. */
export const foreignCurrencies = (lines: OfferingLine[], main: string) =>
  [...new Set(lines.map((l) => l.currency).filter((c): c is string => !!c && c !== main))].sort();

/** Cash counted in a foreign currency: by denomination when known, else the entered total. */
export const foreignCounted = (f: ForeignCash | undefined) => (f?.cash && Object.keys(f.cash).length ? cashTotal(f.cash) : f?.total ?? 0);

/** What has to match before a cash count can be verified: each currency's count against its cash lines. */
export function countProblems(r: Pick<ServiceRecord, 'offerings' | 'cash' | 'currency' | 'foreign_cash'>): { currency: string; counted: number; lines: number }[] {
  const out: { currency: string; counted: number; lines: number }[] = [];
  const main = { currency: r.currency, counted: cashTotal(r.cash), lines: methodTotal(r.offerings, 'cash', r.currency, r.currency) };
  if (main.counted !== main.lines) out.push(main);
  for (const c of foreignCurrencies(r.offerings, r.currency)) {
    const counted = foreignCounted(r.foreign_cash?.[c]);
    const lines = methodTotal(r.offerings, 'cash', c, r.currency);
    if (counted !== lines) out.push({ currency: c, counted, lines });
  }
  return out;
}

/**
 * Cash fingerprint: what a verified count and its signatures attest — the cash lines (in any order), the notes and
 * coins counted and foreign cash. Offerings by other methods are not part of it: a transfer received later can be
 * added without touching the count.
 */
export const cashKey = (r: Pick<ServiceRecord, 'offerings' | 'cash' | 'currency' | 'foreign_cash'>) =>
  JSON.stringify([
    r.currency,
    r.offerings.filter((l) => l.method === 'cash').map((l) => [l.fund, l.amount, l.currency ?? '']).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    Object.entries(r.cash).filter(([, n]) => n).sort(),
    r.foreign_cash ?? {},
  ]);
/** @deprecated the cash fingerprint (kept for callers of v0.9) */
export const moneyKey = cashKey;

/** 12345 → "123.45" (with thousands separators). */
export function money(minor: number, currency = 'SGD', withCode = false): string {
  const dec = DENOMINATIONS[currency]?.decimals ?? 2;
  const v = (minor / 10 ** dec).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return withCode ? `${currency} ${v}` : v;
}

/** "123.45" / "123" → 12345; null when not a number. */
export function parseMoney(s: string, currency = 'SGD'): number | null {
  const t = s.replace(/[,\s]/g, '');
  if (!t) return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const dec = DENOMINATIONS[currency]?.decimals ?? 2;
  return Math.round(Number(t) * 10 ** dec);
}

/** A denomination's label: 10000 → "100", 50 → "0.50". */
export const denomLabel = (minor: number, currency = 'SGD') => {
  const dec = DENOMINATIONS[currency]?.decimals ?? 2;
  const v = minor / 10 ** dec;
  return Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(dec);
};
