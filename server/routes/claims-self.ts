// Expense claims on a phone (0.17.1): members make claims, attach receipt photos and sign; approvers approve, send back
// or reject — all on /self/claims. No Canon account is needed: a member signs in with a code e-mailed to the address
// on their member record (when the treasurer has switched phone sign-in on and the e-mail and public address work).
// Someone signed in to Canon gets a claims token for their linked member from POST /me/claims-session instead.
// Like the library's self-service, the token travels only in the X-Self-Token header (no cookie, so no CSRF).
import express, { type Request } from 'express';
import { z } from 'zod';
import * as C from '../repo/bk-claims.ts';
import { bkSettings } from '../repo/bookkeeping.ts';
import { checkPublicAddress, gates, memberToken, personOf, requestCode, verifyCode } from '../repo/lending-self.ts';
import { getSettings } from '../repo/settings.ts';
import { all, get } from '../db.ts';
import { addressKey, makeLimiter } from '../lib/rate-limit.ts';
import { publicUrl } from '../lib/public-url.ts';
import { asActor } from '../lib/actor.ts';
import { h, id, tooMany as tooManyError } from './helpers.ts';

export const claimsSelfRoutes = express.Router();

/** Book-keeping must be on; nothing here is cached or indexed. */
claimsSelfRoutes.use('/self/claims', (_req, res, next) => {
  if (getSettings().modules.bookkeeping !== true) return void res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
});
/** A signed-in member's changes are in the change log under their name, "on a phone". */
claimsSelfRoutes.use('/self/claims', (req, _res, next) => {
  const t = req.get('X-Self-Token');
  if (!t) return next();
  let name: string | null = null;
  try {
    const pid = personOf(t, 'claims');
    const p = get<{ first_name: string; last_name: string | null; preferred_name: string | null }>('SELECT first_name, last_name, preferred_name FROM people WHERE id = ?', pid);
    name = p ? [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ') : null;
  } catch { /* the route answers "sign in again" */ }
  if (!name) return next();
  asActor({ user_id: null, user_name: name, via: 'web', client: 'phone' }, next);
});

// ---------------------------------------------------------------- phone sign-in

/** Phone sign-in by e-mailed code: switched on by the treasurer, and the e-mail and public address work. */
export async function claimsSignInStatus(force = false) {
  await checkPublicAddress(force);
  const g = gates().filter((x) => x.key === 'email' || x.key === 'public_address');
  const wanted = bkSettings().claims_self_service;
  return { wanted, on: wanted && g.every((x) => x.ok), gates: g };
}
const codesPerAddress = makeLimiter(20, 15 * 60_000);
const codesPerEmail = makeLimiter(3, 15 * 60_000);
const tries = makeLimiter(30, 15 * 60_000);
export const resetClaimsLimits = () => [codesPerAddress, codesPerEmail, tries].forEach((l) => l.reset());
const tooMany = (seconds: number) => tooManyError('Too many tries. Wait a few minutes and try again.', seconds);

claimsSelfRoutes.get('/self/claims/status', h(async () => {
  const s = getSettings();
  return {
    sign_in: (await claimsSignInStatus()).on, church_name: s.church_name, languages: s.languages, currency: s.offering.currency,
    ministries: all<{ id: number; name: string }>('SELECT id, name FROM bk_ministries WHERE active = 1 ORDER BY sort, code').map((m) => ({ id: m.id, name: JSON.parse(m.name) })),
    projects: all<{ id: number; name: string }>('SELECT id, name FROM bk_projects WHERE active = 1 ORDER BY sort, code').map((m) => ({ id: m.id, name: JSON.parse(m.name) })),
  };
}));
claimsSelfRoutes.post('/self/claims/code', h(async (req) => {
  if (!(await claimsSignInStatus()).on) throw Object.assign(new Error('Signing in on a phone is not available: ask the treasurer.'), { status: 503 });
  const { email } = z.object({ email: z.string().email().max(200) }).parse(req.body);
  if (codesPerAddress.limited(addressKey(req.ip)) || codesPerEmail.limited(email.trim().toLowerCase())) {
    throw tooMany(Math.max(codesPerAddress.retryAfter(addressKey(req.ip)), codesPerEmail.retryAfter(email.trim().toLowerCase())));
  }
  await requestCode(email, 'claims');
  return { ok: true };
}));
claimsSelfRoutes.post('/self/claims/verify', h((req) => {
  if (tries.limited(addressKey(req.ip))) throw tooMany(tries.retryAfter(addressKey(req.ip)));
  const b = z.object({ email: z.string().email().max(200), code: z.string().max(20) }).parse(req.body);
  return verifyCode(b.email, b.code, 'claims');
}));

// ---------------------------------------------------------------- the member's claims and approvals

const who = (req: Request): C.Party => {
  const pid = personOf(req.get('X-Self-Token'), 'claims');
  const p = get<{ first_name: string; last_name: string | null; preferred_name: string | null }>('SELECT first_name, last_name, preferred_name FROM people WHERE id = ?', pid)!;
  return { as: 'claimant', person_id: pid, name: [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(' ') };
};
/** A claim as its claimant or an approver sees it, with what they may do. */
function view(c: ReturnType<typeof C.getClaim>, p: C.Party) {
  if (!C.maySee(c, p)) throw Object.assign(new Error('Claim not found'), { status: 404 });
  const own = c.person_id === p.person_id;
  return {
    ...c,
    // where to repay is for the claimant and the office, not approvers
    pay_to: own ? c.pay_to : c.pay_to ? '•••' : null,
    // approvers don't see where to repay, but are told when the office typed it in rather than the claimant (0.19.4)
    office_typed_pay_to: !own && !!c.pay_to && c.pay_to_by === 'office',
    lines: c.lines.map((l) => ({ id: l.id, date: l.date, description: l.description, payee: l.payee, amount: l.amount, ministry_id: l.ministry_id, project_id: l.project_id })),
    may_edit: own && c.status === 'draft',
    may_withdraw: own && (c.status === 'draft' || c.status === 'submitted'),
    may_approve: c.status === 'submitted' && !!p.person_id && C.mayApprove(c, p.person_id) && !C.hasApproved(c, p.person_id),
    needed: C.approvalsNeeded(c),
    problems: own && c.status === 'draft' ? C.submitProblems(c) : [],
  };
}
const Line = z.object({
  id: z.number().int().optional(), date: z.string().max(10).nullable().optional(), description: z.string().max(300).default(''), payee: z.string().max(120).nullable().optional(),
  amount: z.number().int().min(0), ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional(),
});
const Input = z.object({
  purpose: z.string().max(300).nullable().optional(), ministry_id: z.number().int().nullable().optional(), project_id: z.number().int().nullable().optional(),
  pay_to: z.string().max(200).nullable().optional(), lines: z.array(Line).max(100),
});
const input = (b: unknown) => {
  const x = Input.parse(b);
  return { ...x, lines: x.lines.map((l) => ({ ...l, date: l.date || null, payee: l.payee ?? null })) };
};

claimsSelfRoutes.get('/self/claims/mine', h((req) => {
  const p = who(req);
  const approver = C.listApprovers().some((a) => a.person_id === p.person_id && a.active);
  return {
    name: p.name, approver,
    mine: C.listClaims({ person_id: p.person_id! }),
    to_approve: approver ? C.toApprove(p.person_id!).map((c) => ({ id: c.id, number: c.number, claimant: c.claimant, purpose: c.purpose, total: c.total, submitted_at: c.submitted_at })) : [],
    // a previous claim's "where to repay", to fill in the next one
    last_pay_to: get<{ pay_to: string | null }>('SELECT pay_to FROM bk_claims WHERE person_id = ? AND pay_to IS NOT NULL ORDER BY id DESC LIMIT 1', p.person_id)?.pay_to ?? null,
  };
}));
claimsSelfRoutes.post('/self/claims', h((req) => {
  const p = who(req);
  return view(C.createClaim(p.person_id, input(req.body), p), p);
}));
claimsSelfRoutes.get('/self/claims/:id', h((req) => {
  const p = who(req);
  return view(C.getClaim(id(req)), p);
}));
claimsSelfRoutes.put('/self/claims/:id', h((req) => {
  const p = who(req);
  return view(C.updateClaim(id(req), input(req.body), p), p);
}));
claimsSelfRoutes.delete('/self/claims/:id', h((req) => {
  C.deleteClaim(id(req), who(req));
  return { deleted: true };
}));
claimsSelfRoutes.post('/self/claims/:id/files', express.raw({ type: () => true, limit: '11mb' }), h((req) => {
  const p = who(req);
  const q = req.query as Record<string, string | undefined>;
  const c = C.addClaimFile(id(req), { name: String(q.name ?? 'receipt'), mime: String(req.get('Content-Type') ?? '').split(';')[0], data: req.body as Buffer, line_id: Number(q.line_id) || null }, p);
  return view(c, p);
}));
claimsSelfRoutes.put('/self/claims/files/:id', h((req) => {
  const p = who(req);
  return view(C.setFileLine(id(req), z.object({ line_id: z.number().int().nullable() }).parse(req.body).line_id, p), p);
}));
claimsSelfRoutes.delete('/self/claims/files/:id', h((req) => {
  const p = who(req);
  return view(C.removeClaimFile(id(req), p), p);
}));
/** A receipt (the claimant and the claim's approvers): fetched with the token, shown in a sandbox. */
claimsSelfRoutes.get('/self/claims/files/:id', (req, res, next) => {
  try {
    const p = who(req);
    const f = C.claimFileData(id(req));
    view(C.getClaim(f.file.claim_id), p);
    res.setHeader('Content-Type', f.file.mime);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.data);
  } catch (e) {
    next(e);
  }
});
claimsSelfRoutes.post('/self/claims/:id/submit', h((req) => {
  const p = who(req);
  const b = z.object({ name: z.string().max(120).optional(), image: z.string().max(400_000) }).parse(req.body);
  return view(C.submitClaim(id(req), b, p), p);
}));
claimsSelfRoutes.post('/self/claims/:id/withdraw', h((req) => {
  const p = who(req);
  return view(C.withdrawClaim(id(req), p), p);
}));
claimsSelfRoutes.post('/self/claims/:id/decide', h((req) => {
  const p = who(req);
  const b = z.object({ decision: z.enum(['approved', 'returned', 'rejected']), note: z.string().max(1000).nullable().optional(), image: z.string().max(400_000).optional() }).parse(req.body);
  return view(C.decideClaim(id(req), { ...b, via: 'device' }, { person_id: p.person_id!, name: p.name }), { ...p, as: 'approver' });
}));

/** For Canon's own pages: the link to give claimants (the public address when there is one). */
export const claimsPageBase = () => publicUrl();

/** Someone signed in to Canon claims as their linked member, without an e-mailed code. */
export function sessionToken(personId: number | null) {
  if (getSettings().modules.bookkeeping !== true) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!personId) throw Object.assign(new Error('Your account is not linked to your member record: link it first (Settings → User accounts).'), { status: 400 });
  return memberToken(personId, 'claims');
}
