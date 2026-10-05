// Service records: one per service held — attendance, new visitors, notes for the team, offerings and the cash
// count. Once the cash count is marked "counted and verified", only an administrator can change the money.
// Every change goes to the change log (table() logs it with the person who made it).
import type { ServiceRecord } from '../../shared/records.ts';
import { DENOMINATIONS, OFFERING_METHODS, cashTotal, methodTotal } from '../../shared/records.ts';
import { all, get, type SqlValue } from '../db.ts';
import { BadRequest, Forbidden, table } from '../lib/table.ts';
import { getSettings } from './settings.ts';
import { services } from './services.ts';

export const records = table<ServiceRecord>({
  name: 'service_records',
  cols: ['service_id', 'attendance', 'children', 'online', 'visitors', 'notes', 'offerings', 'cash', 'counters', 'currency', 'verified_at', 'verified_by'],
  json: ['visitors', 'offerings', 'cash', 'counters'],
  touch: true,
  log: { parent: (r) => ({ entity: 'services', id: Number(r.service_id) }) },
});

const blank = (serviceId: number): Omit<ServiceRecord, 'id' | 'updated_at'> => ({
  service_id: serviceId, attendance: null, children: null, online: null, visitors: [], notes: null,
  offerings: [], cash: {}, counters: [], currency: getSettings().offering.currency, verified_at: null, verified_by: null,
});

/** The record of a service (an empty one, not yet saved, when nothing was entered). */
export function recordFor(serviceId: number): ServiceRecord & { saved: boolean } {
  services.get(serviceId);
  const r = records.list('service_id = ?', [serviceId])[0];
  return r ? { ...r, saved: true } : { id: 0, updated_at: '', ...blank(serviceId), saved: false };
}

const MONEY_FIELDS = ['offerings', 'cash', 'counters', 'currency'] as const;

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
  const { id: _i, service_id: _s, saved: _v, updated_at: _u, verified_at: _va, verified_by: _vb, ...rest } = patch as ServiceRecord & { saved?: boolean };
  return cur.saved ? records.update(cur.id, rest) : records.insert({ ...blank(serviceId), ...rest });
}

/** Mark the cash count as counted and verified (or undo that, administrators only). */
export function setVerified(serviceId: number, verified: boolean, who: { name: string; admin: boolean }): ServiceRecord {
  const cur = recordFor(serviceId);
  if (!cur.saved) throw new BadRequest('Enter the offerings first.');
  if (!verified) {
    if (!who.admin) throw new Forbidden('Only an administrator can reopen a verified cash count.');
    return records.update(cur.id, { verified_at: null, verified_by: null });
  }
  if (cur.counters.filter((c) => c.trim()).length < 2) throw new BadRequest('Enter the names of at least two counters.');
  const cashLines = methodTotal(cur.offerings, 'cash');
  const counted = cashTotal(cur.cash);
  if (cashLines !== counted) throw new BadRequest('The counted cash does not match the cash offerings. Check the count first.');
  return records.update(cur.id, { verified_at: new Date().toISOString(), verified_by: who.name });
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
      offering_total: r ? methodTotal(r.offerings) : null,
      cash_counted: r ? cashTotal(r.cash) : null,
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
    offerings: [], cash: {}, counters: [],
    hidden: ['offerings', 'cash', 'counters', 'visitor contact'],
  };
}

export const recordCount = () => get<{ n: number }>('SELECT COUNT(*) AS n FROM service_records')?.n ?? 0;
