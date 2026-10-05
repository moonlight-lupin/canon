// Service records: one per service held — attendance, new visitors, notes for the team, offerings and the cash
// count. Once the cash count is verified, the cash is locked for everyone (offerings by other methods can still be
// added, e.g. a transfer received later): an administrator reopens the count to correct the cash, and it is verified
// again. A service with a record cannot be deleted (the record would go with it).
// Every change goes to the change log (table() logs it with the person who made it).
import type { ServiceRecord } from '../../shared/records.ts';
import { DENOMINATIONS, OFFERING_METHODS, cashKey, cashTotal, countProblems, foreignCurrencies, methodTotal, money } from '../../shared/records.ts';
import type { Signature } from '../../shared/records.ts';
import crypto from 'node:crypto';
import { all, get, type SqlValue } from '../db.ts';
import { BadRequest, Conflict, Forbidden, table } from '../lib/table.ts';
import { getSettings } from './settings.ts';
import { services } from './services.ts';

export const records = table<ServiceRecord>({
  name: 'service_records',
  cols: ['service_id', 'attendance', 'children', 'online', 'visitors', 'notes', 'offerings', 'cash', 'counters', 'currency', 'verified_at', 'verified_by', 'foreign_cash', 'signatures', 'counted_on'],
  json: ['visitors', 'offerings', 'cash', 'counters', 'foreign_cash', 'signatures'],
  touch: true,
  log: { parent: (r) => ({ entity: 'services', id: Number(r.service_id) }) },
});

const blank = (serviceId: number): Omit<ServiceRecord, 'id' | 'updated_at'> => ({
  service_id: serviceId, attendance: null, children: null, online: null, visitors: [], notes: null,
  offerings: [], cash: {}, counters: [], currency: getSettings().offering.currency, verified_at: null, verified_by: null,
  foreign_cash: {}, signatures: [], counted_on: null,
});

/** The record of a service (an empty one, not yet saved, when nothing was entered). */
export function recordFor(serviceId: number): ServiceRecord & { saved: boolean } {
  services.get(serviceId);
  const r = records.list('service_id = ?', [serviceId])[0];
  return r ? { ...r, saved: true } : { id: 0, updated_at: '', ...blank(serviceId), saved: false };
}

/** Fields locked once the count is verified (what the declaration attests). */
const MONEY_FIELDS = ['offerings', 'cash', 'counters', 'currency', 'foreign_cash', 'counted_on'] as const;
const hashOf = (r: Pick<ServiceRecord, 'offerings' | 'cash' | 'currency' | 'foreign_cash'>) => crypto.createHash('sha256').update(cashKey(r)).digest('base64url').slice(0, 16);
/** How many counters at least must count (names on paper, signatures on screen); 2–6, default 2. */
export const minCounters = () => Math.min(6, Math.max(2, Math.floor(getSettings().offering.min_counters ?? 2)));
/** How the church signs the cash count: on paper (default) or on screen. */
export const signingMode = () => (getSettings().offering.signing === 'screen' ? 'screen' : 'paper');

/** Save part of a service's record. Money is locked once verified, except for administrators. */
export function saveRecord(serviceId: number, patch: Partial<ServiceRecord>, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  // compare what is sent with what is stored: an unchanged copy of the money (the editor sends the whole record) is fine
  const sentMoney = Object.fromEntries(MONEY_FIELDS.filter((k) => patch[k] !== undefined).map((k) => [k, patch[k]]));
  const nextMoney = { ...cur, ...sentMoney } as ServiceRecord;
  // what the verified count attests: the cash, its counters and date. Other offering lines may still change.
  const cashChanged = hashOf(nextMoney) !== hashOf(cur) || JSON.stringify(nextMoney.counters ?? []) !== JSON.stringify(cur.counters ?? [])
    || (nextMoney.counted_on ?? null) !== (cur.counted_on ?? null);
  if (cur.verified_at && cashChanged) {
    if (!who.admin) throw new Forbidden('The cash count has been verified. Only an administrator can reopen it to change the cash.');
    throw new Conflict('The cash count has been verified. Reopen the cash count first (Reopen cash count), then change the cash and verify it again.');
  }
  if (patch.offerings) {
    for (const l of patch.offerings) {
      if (!OFFERING_METHODS.includes(l.method)) throw new BadRequest(`Unknown payment method "${l.method}"`);
      if (!Number.isInteger(l.amount) || l.amount < 0) throw new BadRequest('Amounts must be zero or more');
    }
  }
  if (patch.currency && !DENOMINATIONS[patch.currency]) throw new BadRequest(`Unknown currency ${patch.currency}`);
  if (patch.counted_on && !/^\d{4}-\d{2}-\d{2}$/.test(patch.counted_on)) throw new BadRequest('The date counted must be a date (YYYY-MM-DD).');
  for (const l of patch.offerings ?? []) {
    if (l.currency && !/^[A-Z]{3}$/.test(l.currency)) throw new BadRequest(`"${l.currency}" is not a currency code (three capital letters, e.g. USD)`);
  }
  const { id: _i, service_id: _s, saved: _v, updated_at: _u, verified_at: _va, verified_by: _vb, signatures: _sg, ...rest } = patch as ServiceRecord & { saved?: boolean };
  // drop fields sent unchanged (an editor's screen sends the whole record)
  for (const k of MONEY_FIELDS) if (k in rest && JSON.stringify((rest as Record<string, unknown>)[k]) === JSON.stringify(cur[k] ?? null)) delete (rest as Record<string, unknown>)[k];
  // signatures belong to one exact count: when the cash changes they no longer apply (a verified count cannot change, above)
  if (cur.saved && cashChanged && (cur.signatures?.length ?? 0) > 0) Object.assign(rest, { signatures: [] });
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
  if (signingMode() === 'screen') throw new BadRequest('This church signs on screen: the count is verified with Finish signing once the counters have signed.');
  const min = minCounters();
  if (cur.counters.filter((c) => c.trim()).length < min) throw new BadRequest(`Enter the names of at least ${min} counters.`);
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
 * count. Signing does not verify: any number of counters may sign, then Finish signing (finishSigning) verifies.
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
  return records.update(cur.id, { signatures: next, counters: next.map((s) => s.name) });
}

/** Everyone has signed: verify the count (at least the church's minimum number of signatures, for this exact count). */
export function finishSigning(serviceId: number, who: { name: string; admin: boolean }): ServiceRecord {
  if (signingMode() !== 'screen') throw new BadRequest('This church signs the declaration on paper.');
  const cur = recordFor(serviceId);
  if (!cur.saved) throw new BadRequest('Enter the offerings first.');
  if (cur.verified_at) throw new BadRequest('The cash count is already verified.');
  checkCount(cur);
  const hash = hashOf(cur);
  const sigs = (cur.signatures ?? []).filter((s) => s.hash === hash);
  const min = minCounters();
  if (sigs.length < min) throw new BadRequest(`At least ${min} counters must sign before the count can be finished (${sigs.length} so far).`);
  void who;
  return records.update(cur.id, { signatures: sigs, counters: sigs.map((s) => s.name), verified_at: new Date().toISOString(), verified_by: sigs.map((s) => s.name).join(', ') });
}

/** Remove a signature (before the count is verified, or by an administrator — which reopens the count). */
export function unsign(serviceId: number, name: string, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  if (cur.verified_at && !who.admin) throw new Forbidden('The cash count has been verified. Only an administrator can remove a signature.');
  const next = (cur.signatures ?? []).filter((s) => s.name !== name);
  // removing a signature from a verified count (administrators) reopens it
  return records.update(cur.id, { signatures: next, counters: next.map((s) => s.name), ...(cur.verified_at ? { verified_at: null, verified_by: null } : {}) });
}

/** Refuse to delete a service that has a record: deleting the service would take its attendance and money with it. */
export function assertServiceDeletable(serviceId: number) {
  if (records.list('service_id = ?', [serviceId]).length) {
    throw new Conflict('This service has a service record (attendance, visitors or offerings), so it cannot be deleted. If the record was entered by mistake, an administrator can delete it first on the record page.');
  }
}

/** Delete a service's record (administrators; a verified count must be reopened first). Logged in full. */
export function deleteRecord(serviceId: number, who: { admin: boolean }) {
  if (!who.admin) throw new Forbidden('Only an administrator can delete a service record.');
  const cur = recordFor(serviceId);
  if (!cur.saved) return { deleted: false };
  if (cur.verified_at) throw new Conflict('The cash count has been verified. Reopen it first if the record really has to be deleted.');
  records.remove(cur.id);
  return { deleted: true };
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
  // built from an allowlist: a field added to records later stays hidden from viewers until it is listed here
  return {
    id: r.id, service_id: r.service_id, saved: r.saved, updated_at: r.updated_at,
    attendance: r.attendance, children: r.children, online: r.online, notes: r.notes,
    visitors: r.visitors.map((v) => ({ name: v.name, source: v.source, status: v.status })),
    currency: r.currency, offerings: [], cash: {}, counters: [], foreign_cash: {}, signatures: [], verified_at: null, verified_by: null,
    hidden: ['offerings', 'cash', 'counters', 'visitor contact'],
  };
}

/** A list row for a viewer: the same allowlist idea (no money of any currency). */
export const listRowForViewer = (r: ReturnType<typeof listRecords>[number]) => ({
  service_id: r.service_id, date: r.date, start_time: r.start_time, title: r.title, congregation_id: r.congregation_id,
  recorded: r.recorded, attendance: r.attendance, children: r.children, online: r.online, visitors: r.visitors, has_notes: r.has_notes,
  currency: r.currency, offering_total: null, cash_counted: null, other_currencies: [], verified: false,
});

export const recordCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM service_records')?.n ?? 0;
