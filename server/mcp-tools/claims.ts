// AI-assistant tools for expense claims (0.17.1, part of book-keeping). Anyone may claim, so these follow the
// connection's Book-keeping setting but not the person's role: a person reads and drafts their OWN claims; someone whose
// role keeps the books reads every claim and may draft one for another member. The assistant reads receipts the user
// shows it in the chat and drafts the claim's lines; it cannot pass the photos on, so its reply gives the claim's link
// for the claimant to attach the receipts and sign on their phone. It never submits, approves or pays, and never sees
// where a claimant is repaid.
import { z } from 'zod';
import { all, get } from '../db.ts';
import * as C from '../repo/bk-claims.ts';
import { roleDef } from '../lib/permissions.ts';
import { checkRef, inSight } from '../lib/walls.ts';
import { DateStr, Id, RO, WRITE, type Ctx, type ToolDef } from './common.ts';

class InputError extends Error {
  status = 400;
}
const keeper = (ctx: Ctx) => { const r = roleDef(ctx.auth.user.role); return r.admin || (r.access.bookkeeping ?? 'none') !== 'none'; };
/** May write claims for other members: an administrator, or someone who may change the books (not only read them). */
const keeperEdits = (ctx: Ctx) => { const r = roleDef(ctx.auth.user.role); return r.admin || r.access.bookkeeping === 'edit'; };
const codeOf = (table: string, code: string | undefined | null, what: string): number | null => {
  if (!code) return null;
  const r = get<{ id: number }>(`SELECT id FROM ${table} WHERE code = ? COLLATE NOCASE`, code.trim());
  if (!r) throw new InputError(`No ${what} with the code "${code}".`);
  return r.id;
};

/** A claim for an assistant: no signatures' images, no "where to repay". */
function out(c: ReturnType<typeof C.getClaim>) {
  const acc = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_accounts').map((a) => [a.id, a.code]));
  const min = new Map(all<{ id: number; code: string }>('SELECT id, code FROM bk_ministries').map((a) => [a.id, a.code]));
  return {
    id: c.id, number: c.number, claimant: c.claimant, purpose: c.purpose, status: c.status, total_cents: c.total, ministry: c.ministry_id ? min.get(c.ministry_id) : undefined,
    lines: c.lines.map((l) => ({ date: l.date, description: l.description, payee: l.payee ?? undefined, amount_cents: l.amount, account: l.account_id ? acc.get(l.account_id) : undefined, ministry: l.ministry_id ? min.get(l.ministry_id) : undefined })),
    receipts: c.files.map((f) => f.name), repay_to_set: !!c.pay_to, repay_to_entered_by_office: c.pay_to_by === 'office' || undefined,
    approvals: c.approvals.map((a) => ({ name: a.name, decision: a.decision, note: a.note ?? undefined, at: a.at })),
    approvals_needed: C.approvalsNeeded(c), submitted_at: c.submitted_at ?? undefined, approved_at: c.approved_at ?? undefined, paid_on: c.paid_on ?? undefined,
    approver_also_paid: c.approver_paid || undefined, still_needed: c.status === 'draft' ? C.submitProblems(c) : undefined, link: C.claimLink(c.id),
  };
}

export const CLAIMS_TOOLS: ToolDef[] = [
  {
    name: 'canon_claims', module: 'bookkeeping', access: 'read', own: true, title: 'Expense claims', annotations: RO,
    description: 'Expense claims (amounts in cents). A person sees their own claims and those waiting for their approval; someone whose role keeps the books sees every claim. Without id: the list (filter by status draft | submitted | approved | rejected | paid | withdrawn | open = submitted or approved, or words). With id: its lines, receipts, approvals, what is still needed before it can be submitted, and its link. Where a claimant is repaid is never shown. Example: {"status":"open"}.',
    input: { id: Id.optional(), status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'paid', 'withdrawn', 'open']).optional(), q: z.string().max(200).optional() },
    handler: (a, ctx) => {
      const me = ctx.auth.user.person_id ?? null;
      if (a.id) {
        const c = C.getClaim(a.id);
        // the books' view stops at the account's congregation wall; the claimant and its approvers still see it
        const party: C.Party = { as: keeper(ctx) && inSight(c.congregation_id) ? 'office' : 'claimant', person_id: me, name: ctx.auth.user.display_name };
        if (!C.maySee(c, party)) throw new InputError('Claim not found.');
        return { amounts_in: 'cents', ...out(c) };
      }
      const all = keeper(ctx) ? C.listClaims({ status: a.status, q: a.q, walled: true }) : me ? C.listClaims({ status: a.status, q: a.q, person_id: me }) : [];
      return {
        amounts_in: 'cents',
        claims: all.map((r) => ({ id: r.id, number: r.number, claimant: r.claimant, purpose: r.purpose, status: r.status, total_cents: r.total, receipts: r.files, submitted_at: r.submitted_at ?? undefined, paid_on: r.paid_on ?? undefined })),
        waiting_for_my_approval: me ? C.toApprove(me).map((c) => ({ id: c.id, number: c.number, claimant: c.claimant, total_cents: c.total, link: C.claimLink(c.id) })) : [],
      };
    },
  },
  {
    name: 'canon_draft_claim', module: 'bookkeeping', access: 'write', own: true, title: 'Draft an expense claim (the claimant attaches receipts and signs)', annotations: { ...WRITE, idempotentHint: false },
    description: 'Prepare an expense claim from receipts the user showed you (read the shop, date, items and total from each photo). One line per receipt (or per item if they differ in purpose): date, description (what it was for), payee (the shop), amount_cents; optionally a ministry code, and an expense account code as a suggestion (the treasurer decides). The claim is for the user themselves (their linked member record); an administrator or someone who may change the books (not only read them) may name another member with claimant_person_id. With id: replace a claim still being prepared. You cannot attach the photos, submit, approve or pay: reply with the link from the result — the claimant opens it on their phone to attach the receipt photos, check the lines, say where to repay them and sign. Confirm the lines with the user first. Example: {"purpose":"Youth camp supplies","lines":[{"date":"2026-10-03","description":"Snacks for the youth camp","payee":"FairPrice","amount_cents":4560}]}.',
    input: {
      id: Id.optional(), claimant_person_id: Id.optional(), purpose: z.string().max(300).optional(), ministry: z.string().max(20).optional(), project: z.string().max(20).optional(),
      lines: z.array(z.object({
        date: DateStr, description: z.string().min(1).max(300), payee: z.string().max(120).optional(), amount_cents: z.number().int().min(1),
        ministry: z.string().max(20).optional(), account: z.string().max(20).optional(),
      })).min(1).max(100),
    },
    handler: (a, ctx) => {
      const me = ctx.auth.user.person_id ?? null;
      const forOther = a.claimant_person_id && a.claimant_person_id !== me;
      if (forOther && !keeperEdits(ctx)) throw new InputError('You can draft claims for yourself only.');
      const person = (a.claimant_person_id as number | undefined) ?? me;
      if (!person) throw new InputError('Your Canon account is not linked to your member record: ask an administrator to link it (Settings → User accounts).');
      if (forOther) checkRef('people', person); // a member behind the account's congregation wall is not found
      const lines = (a.lines as { date: string; description: string; payee?: string; amount_cents: number; ministry?: string; account?: string }[]).map((l) => ({
        date: l.date, description: l.description, payee: l.payee ?? null, amount: l.amount_cents,
        ministry_id: codeOf('bk_ministries', l.ministry, 'ministry'), account_id: codeOf('bk_accounts', l.account, 'account'),
      }));
      const input = { purpose: a.purpose ?? null, ministry_id: codeOf('bk_ministries', a.ministry, 'ministry'), project_id: codeOf('bk_projects', a.project, 'project'), lines };
      const party: C.Party = { as: 'ai', person_id: person, name: ctx.auth.user.display_name };
      let c;
      if (a.id) {
        const cur = C.getClaim(a.id);
        if (cur.person_id !== me && (!keeperEdits(ctx) || !inSight(cur.congregation_id))) throw new InputError('That is someone else’s claim.');
        c = C.updateClaim(a.id, { ...input, fund_id: cur.fund_id, pay_to: cur.pay_to }, party);
      } else c = C.createClaim(person, input, party);
      return {
        amounts_in: 'cents', ...out(c),
        next: 'Give the user the link: on their phone they attach the receipt photos, check the lines, say where to repay them and sign. Nothing goes to an approver until they sign.',
      };
    },
  },
];
