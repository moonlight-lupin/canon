// Service records: one per service held — attendance, new visitors, notes for the team, offerings and the cash
// count. Once the cash count is marked "counted and verified", only an administrator can change the money.
// Every change goes to the change log (table() logs it with the person who made it).
import type { ServiceRecord } from '../../shared/records.ts';
import { DENOMINATIONS, OFFERING_METHODS, cashTotal, countProblems, foreignCurrencies, methodTotal, money, moneyKey } from '../../shared/records.ts';
import type { Signature } from '../../shared/records.ts';
import crypto from 'node:crypto';
import { all, get, type SqlValue } from '../db.ts';
import { BadRequest, Forbidden, table } from '../lib/table.ts';
import { getSettings } from './settings.ts';
import { services } from './services.ts';

export const records = table<ServiceRecord>({
  name: 'service_records',
  cols: ['service_id', 'attendance', 'children', 'online', 'visitors', 'notes', 'offerings', 'cash', 'counters', 'currency', 'verified_at', 'verified_by', 'foreign_cash', 'signatures'],
  json: ['visitors', 'offerings', 'cash', 'counters', 'foreign_cash', 'signatures'],
  touch: true,
  log: { parent: (r) => ({ entity: 'services', id: Number(r.service_id) }) },
});

const blank = (serviceId: number): Omit<ServiceRecord, 'id' | 'updated_at'> => ({
  service_id: serviceId, attendance: null, children: null, online: null, visitors: [], notes: null,
  offerings: [], cash: {}, counters: [], currency: getSettings().offering.currency, verified_at: null, verified_by: null,
  foreign_cash: {}, signatures: [],
});

/** The record of a service (an empty one, not yet saved, when nothing was entered). */
export function recordFor(serviceId: number): ServiceRecord & { saved: boolean } {
  services.get(serviceId);
  const r = records.list('service_id = ?', [serviceId])[0];
  return r ? { ...r, saved: true } : { id: 0, updated_at: '', ...blank(serviceId), saved: false };
}

const MONEY_FIELDS = ['offerings', 'cash', 'counters', 'currency', 'foreign_cash'] as const;
const hashOf = (r: Pick<ServiceRecord, 'offerings' | 'cash' | 'currency' | 'foreign_cash'>) => crypto.createHash('sha256').update(moneyKey(r)).digest('base64url').slice(0, 16);
/** How the church signs the cash count: on paper (default) or on screen. */
export const signingMode = () => (getSettings().offering.signing === 'screen' ? 'screen' : 'paper');

/** Save part of a service's record. Money is locked once verified, except for administrators. */
export function saveRecord(serviceId: number, patch: Partial<ServiceRecord>, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  const touchesMoney = MONEY_FIELDS.some((k) => patch[k] !== undefined);
  if (cur.verified_at && touchesMoney && !who.admin) {
    throw new Forbidden('The cash count has been verified. Only an administrator can change the offerings now.');
  }
  if (patch.offerings) {
    for (const l of patch.offerings) {
      if (!OFFERING_METHODS.includes(l.method)) throw new BadRequest(`Unknown payment method "${l.method}"`);
      if (!Number.isInteger(l.amount) || l.amount < 0) throw new BadRequest('Amounts must be zero or more');
    }
  }
  if (patch.currency && !DENOMINATIONS[patch.currency]) throw new BadRequest(`Unknown currency ${patch.currency}`);
  for (const l of patch.offerings ?? []) {
    if (l.currency && !/^[A-Z]{3}$/.test(l.currency)) throw new BadRequest(`"${l.currency}" is not a currency code (three capital letters, e.g. USD)`);
  }
  const { id: _i, service_id: _s, saved: _v, updated_at: _u, verified_at: _va, verified_by: _vb, signatures: _sg, ...rest } = patch as ServiceRecord & { saved?: boolean };
  // signatures belong to one exact count: when the money changes, they (and the verification) no longer apply
  const next = { ...cur, ...rest };
  const stale = cur.saved && (cur.signatures?.length ?? 0) > 0 && hashOf(next) !== hashOf(cur);
  if (stale) Object.assign(rest, { signatures: [], verified_at: null, verified_by: null });
  return cur.saved ? records.update(cur.id, rest) : records.insert({ ...blank(serviceId), ...rest });
}

/** Mark the cash count as counted and verified (or undo that, administrators only). */
export function setVerified(serviceId: number, verified: boolean, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  if (!cur.saved) throw new BadRequest('Enter the offerings first.');
  if (!verified) {
    if (!who.admin) throw new Forbidden('Only an administrator can reopen a verified cash count.');
    // signatures confirmed the count being reopened: the counters sign again
    return records.update(cur.id, { verified_at: null, verified_by: null, ...(cur.signatures?.length ? { signatures: [] } : {}) });
  }
  if (signingMode() === 'screen') throw new BadRequest('This church signs on screen: the count is verified when the counters have signed.');
  if (cur.counters.filter((c) => c.trim()).length < 2) throw new BadRequest('Enter the names of at least two counters.');
  checkCount(cur);
  return records.update(cur.id, { verified_at: new Date().toISOString(), verified_by: who.name });
}

function checkCount(r: ServiceRecord) {
  const p = countProblems(r);
  if (p.length) {
    const what = p.map((x) => `${x.currency}: counted ${money(x.counted, x.currency)}, cash lines ${money(x.lines, x.currency)}`).join('; ');
    throw new BadRequest(`The counted cash does not match the cash offerings (${what}). Check the count first.`);
  }
}

/**
 * A counter signs on screen (churches that sign on screen). The count must add up; the signature is tied to this
 * count. With two or more signatures the count is verified (and their names become the counters).
 */
export function sign(serviceId: number, input: { name: string; image: string }, who: { name: string; admin: boolean }): ServiceRecord {
  if (signingMode() !== 'screen') throw new BadRequest('This church signs the declaration on paper (Currency and funds → Signing).');
  const cur = recordFor(serviceId);
  if (!cur.saved || !cur.offerings.length) throw new BadRequest('Enter the offerings first.');
  if (cur.verified_at) throw new BadRequest('The cash count is already verified.');
  const name = input.name.trim();
  if (!name) throw new BadRequest('Type the name of the person signing.');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.image) || input.image.length > 300_000) throw new BadRequest('The signature could not be read. Please sign again.');
  checkCount(cur);
  const hash = hashOf(cur);
  const sigs = (cur.signatures ?? []).filter((s) => s.hash === hash && s.name.toLowerCase() !== name.toLowerCase());
  const next: Signature[] = [...sigs, { name: name.slice(0, 120), image: input.image, signed_at: new Date().toISOString(), by: who.name, hash }];
  const done = next.length >= 2;
  return records.update(cur.id, {
    signatures: next,
    counters: next.map((s) => s.name),
    ...(done ? { verified_at: new Date().toISOString(), verified_by: next.map((s) => s.name).join(', ') } : {}),
  });
}

/** Remove a signature (before the count is verified, or by an administrator — which reopens the count). */
export function unsign(serviceId: number, name: string, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  if (cur.verified_at && !who.admin) throw new Forbidden('The cash count has been verified. Only an administrator can remove a signature.');
  const next = (cur.signatures ?? []).filter((s) => s.name !== name);
  return records.update(cur.id, { signatures: next, ...(next.length < 2 ? { verified_at: null, verified_by: null } : {}) });
}

export interface RecordsQuery {
  from?: string;
  to?: string;
  congregation_id?: number;
}

/** Services in a period with their record totals (newest first). */
export function listRecords(q: RecordsQuery) {
  const where = ['1=1'];
  const params: SqlValue[] = [];
  if (q.from) {
    where.push('s.date >= ?');
    params.push(q.from);
  }
  if (q.to) {
    where.push('s.date <= ?');
    params.push(q.to);
  }
  if (q.congregation_id) {
    where.push('s.congregation_id = ?');
    params.push(q.congregation_id);
  }
  const rows = all<{ id: number; date: string; start_time: string; title: string; congregation_id: number | null; record_id: number | null }>(
    `SELECT s.id, s.date, s.start_time, s.title, s.congregation_id, r.id AS record_id FROM services s
     LEFT JOIN service_records r ON r.service_id = s.id WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.start_time DESC LIMIT 400`,
    ...params,
  );
  const recs = new Map(records.list(rows.some((r) => r.record_id) ? `id IN (${rows.filter((r) => r.record_id).map((r) => r.record_id).join(',') || 0})` : '1=0').map((r) => [r.service_id, r]));
  return rows.map((s) => {
    const r = recs.get(s.id);
    return {
      service_id: s.id, date: s.date, start_time: s.start_time, title: JSON.parse(s.title), congregation_id: s.congregation_id,
      recorded: !!r,
      attendance: r?.attendance ?? null, children: r?.children ?? null, online: r?.online ?? null,
      visitors: r?.visitors.length ?? 0,
      offering_total: r ? methodTotal(r.offerings, undefined, r.currency, r.currency) : null,
      cash_counted: r ? cashTotal(r.cash) : null,
      other_currencies: r ? foreignCurrencies(r.offerings, r.currency).map((c) => ({ currency: c, total: methodTotal(r.offerings, undefined, c, r.currency) })) : [],
      currency: r?.currency ?? getSettings().offering.currency,
      verified: !!r?.verified_at,
      has_notes: !!r?.notes?.trim(),
    };
  });
}

/** What a read-only user may see of a record: attendance and notes, not money or visitors' contact details. */
export function forViewer(r: ServiceRecord & { saved?: boolean }) {
  return {
    ...r,
    visitors: r.visitors.map((v) => ({ name: v.name, source: v.source })),
    offerings: [], cash: {}, counters: [], foreign_cash: {}, signatures: [],
    hidden: ['offerings', 'cash', 'counters', 'visitor contact'],
  };
}

export const recordCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM service_records')?.n ?? 0;
