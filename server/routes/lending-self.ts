// Public routes of lending library self-service (no Canon account): mounted inside /api BEFORE sign-in. They exist
// only while the library is on (else 404) and answer "paused" while self-service is off or a gate fails. A member's
// sign-in token comes in the X-Self-Token header (from the phone page), never as a cookie.
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { get } from '../db.ts';
import { getSettings } from '../repo/settings.ts';
import * as S from '../repo/lending-self.ts';
import { pingAnswer } from '../lib/instance.ts';
import { addressKey, makeLimiter } from '../lib/rate-limit.ts';
import { h, id, str, tooMany as tooManyError } from './helpers.ts';

export const lendingSelfRoutes = express.Router();

/** The public-address check: only this Canon can sign the nonce (see repo/lending-self.ts). */
lendingSelfRoutes.get('/self/ping', (req, res) => {
  const n = str(req.query.n) ?? '';
  if (!/^[\w-]{8,64}$/.test(n)) return res.status(400).json({ error: 'Bad request' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sig: pingAnswer(n) });
});

const library = (_req: Request, res: Response, next: NextFunction) => {
  if (getSettings().modules.lending === false) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  next();
};
const running = async (_req: Request, res: Response, next: NextFunction) => {
  if (!(await S.selfServiceReady())) return res.status(503).json({ error: 'Self-service is paused at the moment. Please see the librarian.', paused: true });
  next();
};
const ipOf = (req: Request) => addressKey(req.ip ?? req.socket.remoteAddress) || '?';
const token = (req: Request) => req.get('x-self-token') ?? undefined;

// generous per address (church Wi-Fi shares one), tight per e-mail address
const codesPerAddress = makeLimiter(20, 15 * 60_000);
const codesPerEmail = makeLimiter(3, 15 * 60_000);
const tries = makeLimiter(30, 15 * 60_000);
const returns = makeLimiter(30, 15 * 60_000);
export const resetSelfLimits = () => [codesPerAddress, codesPerEmail, tries, returns].forEach((l) => l.reset());
const tooMany = (seconds: number) => tooManyError('Too many tries. Please wait a few minutes, or see the librarian.', seconds);

lendingSelfRoutes.get('/self/status', library, h(async () => ({ on: await S.selfServiceReady(), church_name: getSettings().church_name, languages: getSettings().languages })));
lendingSelfRoutes.get('/self/copy/:number', library, running, h((req) => S.publicCopy(String(req.params.number))));
lendingSelfRoutes.get('/self/books/:id/cover', library, running, (req, res) => {
  const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', `book-cover-${Number(req.params.id)}`);
  if (!a) return res.status(404).json({ error: 'No cover' });
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.type(a.mime).send(Buffer.from(a.data));
});

lendingSelfRoutes.post('/self/code', library, running, h(async (req) => {
  const b = z.object({ email: z.string().trim().max(200).email() }).parse(req.body);
  if (codesPerAddress.limited(ipOf(req)) || codesPerEmail.limited(b.email.toLowerCase())) {
    throw tooMany(Math.max(codesPerAddress.retryAfter(ipOf(req)), codesPerEmail.retryAfter(b.email.toLowerCase())));
  }
  await S.requestCode(b.email);
  // the same answer whether or not the address is on the register
  return { ok: true };
}));
lendingSelfRoutes.post('/self/verify', library, running, h((req) => {
  const b = z.object({ email: z.string().trim().max(200), code: z.string().max(12) }).parse(req.body);
  if (tries.limited(ipOf(req))) throw tooMany(tries.retryAfter(ipOf(req)));
  const r = S.verifyCode(b.email, b.code);
  return { ...r, loans: S.myLoans(S.personOf(r.token)) };
}));
lendingSelfRoutes.get('/self/loans', library, running, h((req) => S.myLoans(S.personOf(token(req)))));
lendingSelfRoutes.post('/self/borrow', library, running, h((req) => {
  const pid = S.personOf(token(req));
  const b = z.object({ number: z.string().min(1).max(200) }).parse(req.body);
  const loan = S.borrow(pid, b.number);
  return { due_on: loan.due_on, loans: S.myLoans(pid) };
}));
lendingSelfRoutes.post('/self/loans/:id/renew', library, running, h((req) => {
  const pid = S.personOf(token(req));
  const loan = S.renewMine(pid, id(req));
  return { due_on: loan.due_on, loans: S.myLoans(pid) };
}));
lendingSelfRoutes.post('/self/return', library, running, h((req) => {
  if (returns.limited(ipOf(req))) throw tooMany(returns.retryAfter(ipOf(req)));
  return S.markReturned(z.object({ number: z.string().min(1).max(200) }).parse(req.body).number);
}));

// the renewal link in a reminder e-mail: looking at it changes nothing (mail scanners open links); the button renews
lendingSelfRoutes.get('/self/renew-link/:token', library, running, h((req) => S.linkInfo(String(req.params.token))));
lendingSelfRoutes.post('/self/renew-link/:token', library, running, h((req) => {
  const loan = S.renewByLink(String(req.params.token));
  return { due_on: loan.due_on };
}));
