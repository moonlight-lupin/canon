// Offerings into the books (0.17.0). When a cash count is verified, Canon drafts a journal for the service: each
// payment method's money into its account (cash → offerings not yet banked, PayNow → the bank …), against each
// offering fund's income account, with the fund on every line. The draft is what the books still lack for that
// service — the verified offerings less what is already posted for it — so a count reopened, corrected and verified
// again drafts only the difference. A treasurer reviews the drafts and posts them.
import { all, get } from '../db.ts';
import { getSettings } from './settings.ts';
import { recordFor } from './records.ts';
import { services } from './services.ts';
import { bkSettings, deleteDraft, getJournal, saveDraft } from './bookkeeping.ts';
import type { BkJournal, BkLine } from '../../shared/bookkeeping.ts';
import type { ServiceRecord } from '../../shared/records.ts';

interface Target { account_id: number; fund_id: number; congregation_id: number | null; debit: number; credit: number; memo: string | null; orig_currency: string | null; orig_amount: number | null }

const key = (l: { account_id: number; fund_id: number; orig_currency?: string | null }) => `${l.account_id}|${l.fund_id}|${l.orig_currency ?? ''}`;

/** Whether verified offerings should become drafts now. */
export const offeringDraftsOn = () => getSettings().modules.bookkeeping !== false && !!bkSettings().start_date && bkSettings().offering_drafts;

function fallbackFund() {
  return get<{ id: number }>("SELECT id FROM bk_funds WHERE active = 1 ORDER BY restriction != 'unrestricted', sort, id")?.id ?? null;
}
const firstOfKind = (kind: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE kind = ? AND active = 1 ORDER BY code', kind)?.id ?? null;
const firstIncome = () => get<{ id: number }>("SELECT id FROM bk_accounts WHERE type = 'income' AND active = 1 ORDER BY code")?.id ?? null;

/** The lines the books should have for a verified record (before netting what is already posted). */
function targetLines(r: ServiceRecord, congregationId: number | null): { lines: Target[]; notes: string[] } {
  const s = bkSettings();
  const notes: string[] = [];
  const debits = new Map<string, Target>();
  const credits = new Map<string, Target>();
  // what each foreign currency was worth once exchanged, shared out over its offering lines
  const foreignTotal = new Map<string, number>();
  for (const o of r.offerings) if (o.currency && o.currency !== r.currency) foreignTotal.set(o.currency, (foreignTotal.get(o.currency) ?? 0) + o.amount);
  for (const o of r.offerings) {
    if (!o.amount) continue;
    const map = s.fund_map[o.fund];
    const fund = map?.fund_id ?? fallbackFund();
    const income = map?.income_account_id ?? firstIncome();
    if (!fund || !income) continue;
    if (!map) notes.push(`The offering fund “${o.fund}” has no fund in the books yet (Book-keeping → Setup): it went to the general fund.`);
    const foreign = !!o.currency && o.currency !== r.currency;
    let amount = o.amount;
    let orig: { orig_currency: string; orig_amount: number } | null = null;
    let debitAccount = s.method_accounts[o.method] ?? firstOfKind('undeposited') ?? firstOfKind('cash');
    if (foreign) {
      const conv = r.foreign_cash?.[o.currency!]?.converted;
      const total = foreignTotal.get(o.currency!) ?? 0;
      amount = conv != null && total ? Math.round((conv * o.amount) / total) : 0;
      orig = { orig_currency: o.currency!, orig_amount: o.amount };
      if (o.method === 'cash') debitAccount = firstOfKind('foreign_cash') ?? debitAccount;
      if (conv == null) notes.push(`${o.currency} ${(o.amount / 100).toFixed(2)}: enter what it is worth in ${r.currency} on the line before posting.`);
    }
    if (!debitAccount) continue;
    const add = (m: Map<string, Target>, t: Target) => {
      const k = key(t);
      const cur = m.get(k);
      if (cur) {
        cur.debit += t.debit;
        cur.credit += t.credit;
        if (t.orig_amount != null) cur.orig_amount = (cur.orig_amount ?? 0) + t.orig_amount;
      } else m.set(k, t);
    };
    add(debits, { account_id: debitAccount, fund_id: fund, congregation_id: congregationId, debit: amount, credit: 0, memo: o.method, orig_currency: orig?.orig_currency ?? null, orig_amount: orig?.orig_amount ?? null });
    add(credits, { account_id: income, fund_id: fund, congregation_id: congregationId, debit: 0, credit: amount, memo: o.fund, orig_currency: orig?.orig_currency ?? null, orig_amount: orig?.orig_amount ?? null });
  }
  return { lines: [...debits.values(), ...credits.values()], notes: [...new Set(notes)] };
}

/** What is already posted for the service (offering journals and their reversals), by account and fund. */
function booked(serviceId: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of all<{ account_id: number; fund_id: number; orig_currency: string | null; debit: number; credit: number }>(
    "SELECT l.account_id, l.fund_id, l.orig_currency, l.debit, l.credit FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE j.service_id = ? AND j.status = 'posted' AND j.kind IN ('offering','reversal')",
    serviceId,
  )) out.set(key(l), (out.get(key(l)) ?? 0) + l.debit - l.credit);
  return out;
}

/**
 * Make (or update, or remove) the service's draft offering journal so the books match its verified offerings.
 * Returns the draft, or null when nothing is missing. Never throws into the cash count: problems come back as notes.
 */
export function syncOfferingDraft(serviceId: number): { journal: BkJournal | null; notes: string[] } {
  const draft = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND kind = 'offering' AND status = 'draft' ORDER BY id LIMIT 1", serviceId);
  const r = recordFor(serviceId);
  const svc = services.get(serviceId);
  const s = bkSettings();
  // reopened, or before the books start: no draft (what is posted stays: a treasurer reverses it if needed)
  if (!r.saved || !r.verified_at || !s.start_date || svc.date < s.start_date) {
    if (draft) deleteDraft(draft.id);
    return { journal: null, notes: [] };
  }
  const { lines, notes } = targetLines(r, svc.congregation_id ?? null);
  const have = booked(serviceId);
  // the difference by account and fund, as debits and credits
  const want = new Map<string, Target>();
  for (const t of lines) want.set(key(t), t);
  const diff: BkLine[] = [];
  for (const k of new Set([...want.keys(), ...have.keys()])) {
    const t = want.get(k);
    const net = (t ? t.debit - t.credit : 0) - (have.get(k) ?? 0);
    const [account_id, fund_id, cur] = k.split('|');
    if (net === 0 && !(t && t.debit === 0 && t.credit === 0 && t.orig_amount && !have.has(k))) continue;
    diff.push({
      account_id: Number(account_id), fund_id: Number(fund_id), congregation_id: t?.congregation_id ?? svc.congregation_id ?? null,
      debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, memo: t?.memo ?? null, orig_currency: cur || null, orig_amount: t?.orig_amount ?? null,
    });
  }
  if (!diff.length) {
    if (draft) deleteDraft(draft.id);
    return { journal: null, notes };
  }
  const title = (svc.title as Record<string, string>)?.en || Object.values(svc.title ?? {})[0] || 'Service';
  const changed = have.size > 0;
  const memo = `${changed ? 'Change to offerings' : 'Offerings'}: ${title}, ${svc.date}${notes.length ? ` — ${notes.join(' ')}` : ''}`;
  const j = saveDraft(draft?.id ?? null, { date: svc.date, memo, kind: 'offering', service_id: serviceId, lines: diff });
  return { journal: j, notes };
}

/** Bring in verified offerings between two dates (e.g. those verified before book-keeping was switched on). */
export function syncOfferingsBetween(from: string, to: string) {
  const ids = all<{ id: number }>(
    "SELECT s.id FROM services s JOIN service_records r ON r.service_id = s.id WHERE r.verified_at IS NOT NULL AND s.date >= ? AND s.date <= ? ORDER BY s.date",
    from, to,
  ).map((r) => r.id);
  let drafted = 0;
  for (const id of ids) if (syncOfferingDraft(id).journal) drafted++;
  return { services: ids.length, drafted };
}

/** The draft for a service, if any (for the record page: "a draft journal is waiting"). */
export const offeringDraftFor = (serviceId: number) => {
  const r = get<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND kind = 'offering' AND status = 'draft'", serviceId);
  return r ? getJournal(r.id) : null;
};
