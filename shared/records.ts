// Service records (the meeting tracker): attendance, new visitors, notes for the team, offerings and the cash
// count with its declaration. Amounts are kept in minor units (cents) so totals never suffer from rounding.

export type OfferingMethod = 'cash' | 'cheque' | 'transfer' | 'paynow' | 'card' | 'other';
export const OFFERING_METHODS: OfferingMethod[] = ['cash', 'cheque', 'transfer', 'paynow', 'card', 'other'];

export interface OfferingLine {
  fund: string;
  method: OfferingMethod;
  /** minor units (cents) */
  amount: number;
  note?: string;
}

export interface Visitor {
  name: string;
  contact?: string;
  /** how they heard of the church / who brought them */
  source?: string;
  follow_up_by?: string;
  notes?: string;
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
  verified_at: string | null;
  verified_by: string | null;
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

export const methodTotal = (lines: OfferingLine[], method?: OfferingMethod) =>
  lines.filter((l) => !method || l.method === method).reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0);

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
