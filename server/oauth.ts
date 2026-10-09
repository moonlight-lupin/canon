// OAuth 2.1 authorization server for the MCP endpoint (claude.ai custom connectors and other agents).
//
//  - Discovery: RFC 9728 protected-resource metadata + RFC 8414 authorization-server metadata
//  - Dynamic client registration (RFC 7591), rate limited per IP
//  - Authorization code + PKCE S256 only, consent page rendered server-side (bilingual)
//  - Opaque tokens, only SHA-256 hashes stored; access 1 h, refresh 30 d rotated on use
//  - Code replay / refresh-token reuse revoke the whole grant family
//  - RFC 8707 resource binding (audience = <base>/mcp), RFC 7009 revocation
import crypto from 'node:crypto';
import { publicUrl, trustProxy } from './lib/public-url.ts';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Role } from '../shared/types.ts';
import { getUser, sessionUser, sha256, twoStepRequired, type User } from './auth.ts';
import { all, get, run, tx } from './db.ts';
import { getSettings } from './repo/settings.ts';
import { consentPage, disabledPage, errorPage } from './oauth-pages.ts';
import { editsAnything } from './lib/permissions.ts';
import { addressKey, makeLimiter } from './lib/rate-limit.ts';

export const SCOPES = ['canon:read', 'canon:write'] as const;

const DEFAULT_SCOPE = 'canon:read canon:write';

const CODE_TTL_MS = 5 * 60_000;

const ACCESS_TTL_S = 3600;

const REFRESH_TTL_S = 30 * 86400;

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];

export interface McpAuth {
  user: User;
  clientId: string;
  scopes: Set<string>;
  grantId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    mcpAuth?: McpAuth;
  }
}

const tokenUrlsafe = (bytes: number) => crypto.randomBytes(bytes).toString('base64url');

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The externally visible origin (no trailing slash). Used both to mint metadata/token audiences and to check them.
 * The public address (Settings → AI / MCP, or CANON_PUBLIC_URL) wins; X-Forwarded-* only when trusted; otherwise the request's own protocol + host.
 */
export function externalBase(req: Request): string {
  const pub = publicUrl();
  if (pub) return pub;
  // Express believes X-Forwarded-Proto / -Host only from the church's own proxy (server/app.ts): a header someone
  // sends from elsewhere can't change the issuer or the token audience (0.19.0 review)
  if (trustProxy()) return `${req.protocol}://${req.host}`;
  return `${req.protocol}://${req.get('host')}`;
}

export const resourceUrl = (req: Request) => `${externalBase(req)}/mcp`;

const stripSlash = (s: string) => s.replace(/\/+$/, '');

const sameResource = (a: string, b: string) => stripSlash(a) === stripSlash(b);

/** Requested scopes ∩ supported; default both when none requested; viewers never get write. */
function grantScopes(requested: string | undefined, role: Role): string[] | null {
  const req = (requested ?? '').split(/\s+/).filter(Boolean);
  let out = req.length ? SCOPES.filter((s) => req.includes(s)) : DEFAULT_SCOPE.split(' ');
  if (!out.length) return null;
  if (!editsAnything({ role })) out = out.filter((s) => s !== 'canon:write');
  return out.length ? out : null;
}

// ---------------------------------------------------------------- storage helpers

interface ClientRow {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string;
  token_endpoint_auth_method: string;
  created_at: number;
}

interface CodeRow {
  code_hash: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  resource: string | null;
  grant_id: string;
  expires_at: number;
  used: number;
}

interface TokenRow {
  token_hash: string;
  token_type: 'access' | 'refresh';
  client_id: string;
  user_id: number;
  scope: string;
  resource: string | null;
  grant_id: string;
  expires_at: number;
  revoked: number;
}

const getClient = (id: unknown) =>
  typeof id === 'string' && id.length <= 200 ? get<ClientRow>('SELECT * FROM oauth_clients WHERE client_id = ?', id) : undefined;

const clientRedirects = (c: ClientRow) => JSON.parse(c.redirect_uris) as string[];

function revokeFamily(grantId: string) {
  run('UPDATE oauth_tokens SET revoked = 1 WHERE grant_id = ?', grantId);
  run('UPDATE oauth_codes SET used = 1 WHERE grant_id = ?', grantId);
}

function issueTokens(p: { clientId: string; userId: number; scope: string; resource: string | null; grantId: string }) {
  const now = Date.now();
  const access = tokenUrlsafe(40);
  const refresh = tokenUrlsafe(40);
  const ins = `INSERT INTO oauth_tokens (token_hash, token_type, client_id, user_id, scope, resource, grant_id, expires_at, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)`;
  run(ins, sha256(access), 'access', p.clientId, p.userId, p.scope, p.resource, p.grantId, now + ACCESS_TTL_S * 1000, now);
  run(ins, sha256(refresh), 'refresh', p.clientId, p.userId, p.scope, p.resource, p.grantId, now + REFRESH_TTL_S * 1000, now);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: p.scope };
}

let lastCleanup = 0;

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < 3600_000) return;
  lastCleanup = now;
  run('DELETE FROM oauth_codes WHERE expires_at < ?', now - 86400_000);
  // keep expired/revoked tokens a while so refresh-token reuse is still detected
  run('DELETE FROM oauth_tokens WHERE expires_at < ?', now - 7 * 86400_000);
}

// ---------------------------------------------------------------- redirect URI validation

const BAD_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'ftp:', 'ws:', 'wss:', 'mailto:', 'tel:']);

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function validRedirectUri(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 2000 || u.includes('#')) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return !!url.hostname;
  if (url.protocol === 'http:') return LOOPBACK.has(url.hostname);
  if (BAD_SCHEMES.has(url.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol); // private-use scheme for native apps, e.g. com.example.app:/cb
}

// ---------------------------------------------------------------- HTML

export interface ValidAuthz {
  client: ClientRow;
  redirect_uri: string;
  state: string | null;
  scopes: string[];
  code_challenge: string;
  resource: string | null;
}

type Params = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

function redirectWith(res: Response, redirectUri: string, params: Record<string, string | null | undefined>, status = 302) {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(status, u.toString());
}

/**
 * Validate an authorization request. Client/redirect problems render an error page (never redirect: open-redirect
 * protection); other problems redirect back to the client with error + state + iss. Returns null when a response was sent.
 */
function validateAuthz(req: Request, res: Response, p: Params, role: Role | null): ValidAuthz | null {
  const client = getClient(p.client_id);
  if (!client) {
    errorPage(res, 400, 'Unknown application (client_id).');
    return null;
  }
  const registered = clientRedirects(client);
  let redirect_uri = str(p.redirect_uri);
  if (!redirect_uri && registered.length === 1) redirect_uri = registered[0];
  if (!redirect_uri || !registered.includes(redirect_uri)) {
    errorPage(res, 400, 'The redirect address does not match the one registered for this application.');
    return null;
  }
  const state = str(p.state) ?? null;
  const iss = externalBase(req);
  const fail = (error: string, error_description: string) => {
    redirectWith(res, redirect_uri, { error, error_description, state, iss }, req.method === 'POST' ? 303 : 302);
    return null;
  };
  if (str(p.response_type) !== 'code') return fail('unsupported_response_type', 'response_type must be "code"');
  const challenge = str(p.code_challenge);
  if (!challenge) return fail('invalid_request', 'code_challenge is required (PKCE)');
  if (str(p.code_challenge_method) !== 'S256') return fail('invalid_request', 'code_challenge_method must be S256');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(challenge)) return fail('invalid_request', 'malformed code_challenge');
  let resource = str(p.resource) || null;
  if (resource) {
    if (!sameResource(resource, resourceUrl(req))) return fail('invalid_target', `resource must be ${resourceUrl(req)}`);
    resource = resourceUrl(req);
  }
  const scopes = grantScopes(str(p.scope), role ?? 'admin');
  if (!scopes) return fail('invalid_scope', `supported scopes: ${SCOPES.join(' ')}`);
  return { client, redirect_uri, state, scopes, code_challenge: challenge, resource };
}

export const oauthRouter = express.Router();

// CORS for the endpoints called from other origins (not for /oauth/authorize).
function cors(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}
oauthRouter.use(['/.well-known', '/oauth/token', '/oauth/register', '/oauth/revoke'], cors);

// ---- discovery

function protectedResource(req: Request, res: Response) {
  res.json({
    resource: resourceUrl(req),
    authorization_servers: [externalBase(req)],
    scopes_supported: [...SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'Canon',
  });
}
oauthRouter.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], protectedResource);

function asMetadata(req: Request, res: Response) {
  const base = externalBase(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: AUTH_METHODS,
    revocation_endpoint_auth_methods_supported: AUTH_METHODS,
    scopes_supported: [...SCOPES],
    authorization_response_iss_parameter_supported: true,
  });
}
oauthRouter.get(['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration'], asMetadata);

// ---- limits per address (0.19.8 review)

// Client registrations: 10 an hour. The authorization page (a person's browser): 60 views or answers in 15 minutes.
// The token endpoint and /mcp: 30 failures in 15 minutes (a made-up code, client, refresh token or bearer token), and
// the address waits — counting failures only, since every claude.ai connector reaches Canon from claude.ai's few
// addresses, and their good requests mustn't use up the allowance.
const registrations = makeLimiter(10, 3600_000);
const authorizations = makeLimiter(60, 15 * 60_000);
const badTokenRequests = makeLimiter(30, 15 * 60_000);
const badBearers = makeLimiter(30, 15 * 60_000);
const TOO_MANY = 'Too many requests from this address. Please try again in a few minutes.';

// ---- dynamic client registration (RFC 7591)

const regError = (res: Response, error: string, desc: string, status = 400) =>
  res.status(status).json({ error, error_description: desc });

oauthRouter.post('/oauth/register', express.json({ limit: '16kb' }), (req, res) => {
  cleanup();
  if (registrations.limited(addressKey(req.ip))) return regError(res, 'too_many_requests', 'Too many registrations from this address; try again later', 429);
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Params;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10) {
    return regError(res, 'invalid_redirect_uri', 'redirect_uris must be an array of 1-10 URIs');
  }
  for (const u of uris) {
    if (!validRedirectUri(u)) {
      return regError(res, 'invalid_redirect_uri', `Not allowed: ${String(u).slice(0, 200)} (use https, http on loopback, or a private-use scheme; no fragment or credentials)`);
    }
  }
  const method = b.token_endpoint_auth_method === undefined ? 'none' : b.token_endpoint_auth_method;
  if (typeof method !== 'string' || !AUTH_METHODS.includes(method)) {
    return regError(res, 'invalid_client_metadata', `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}`);
  }
  const grantTypes = b.grant_types === undefined ? ['authorization_code', 'refresh_token'] : b.grant_types;
  if (!Array.isArray(grantTypes) || !grantTypes.every((g) => g === 'authorization_code' || g === 'refresh_token')) {
    return regError(res, 'invalid_client_metadata', 'grant_types may contain only authorization_code and refresh_token');
  }
  const responseTypes = b.response_types === undefined ? ['code'] : b.response_types;
  if (!Array.isArray(responseTypes) || !responseTypes.every((r) => r === 'code')) {
    return regError(res, 'invalid_client_metadata', 'response_types may contain only "code"');
  }
  if (b.client_name !== undefined && typeof b.client_name !== 'string') {
    return regError(res, 'invalid_client_metadata', 'client_name must be a string');
  }
  const name = (str(b.client_name) ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Unnamed client';
  const scope = (grantScopes(str(b.scope), 'admin') ?? DEFAULT_SCOPE.split(' ')).join(' ');

  const clientId = 'canon-' + tokenUrlsafe(18);
  const secret = method === 'none' ? null : tokenUrlsafe(32);
  const now = Date.now();
  run(
    'INSERT INTO oauth_clients (client_id, client_secret_hash, client_name, redirect_uris, token_endpoint_auth_method, created_at, registered_ip) VALUES (?,?,?,?,?,?,?)',
    clientId, secret ? sha256(secret) : null, name, JSON.stringify(uris), method, now, req.ip ?? null,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    client_id: clientId,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(now / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: method,
    scope,
  });
});

// ---- authorization endpoint

oauthRouter.use('/oauth/authorize', (req, res, next) => {
  if (authorizations.limited(addressKey(req.ip))) return errorPage(res, 429, TOO_MANY);
  next();
});

oauthRouter.get('/oauth/authorize', (req, res) => {
  const p = req.query as Params;
  const user = sessionUser(req);
  const a = validateAuthz(req, res, p, user?.role ?? null);
  if (!a) return;
  if (!getSettings().mcp.enabled) return disabledPage(res);
  if (!user) {
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (twoStepRequired(user) && !user.totp_enabled) return errorPage(res, 403, 'This church requires two-step sign-in for your account. Set it up in Canon (Settings → My profile) first, then connect again.');
  consentPage(res, a, user);
});

const AUTHZ_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'state', 'scope', 'code_challenge', 'code_challenge_method', 'resource'];

oauthRouter.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 30 }), (req, res) => {
  const p = (req.body ?? {}) as Params;
  const user = sessionUser(req);
  const a = validateAuthz(req, res, p, user?.role ?? null);
  if (!a) return;
  if (!user) {
    // Session expired between consent and submit: go round the login again.
    const q = new URLSearchParams();
    for (const k of AUTHZ_FIELDS) if (typeof p[k] === 'string' && p[k]) q.set(k, p[k] as string);
    return res.redirect(303, `/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
  }
  if (typeof p.csrf !== 'string' || !safeEqual(p.csrf, user.csrf)) {
    return errorPage(res, 403, 'The form has expired or was not submitted from Canon. Please start again.');
  }
  if (!getSettings().mcp.enabled) return disabledPage(res);
  if (twoStepRequired(user) && !user.totp_enabled) return errorPage(res, 403, 'This church requires two-step sign-in for your account. Set it up in Canon (Settings → My profile) first, then connect again.');
  const iss = externalBase(req);
  if (p.decision !== 'allow') {
    return redirectWith(res, a.redirect_uri, { error: 'access_denied', error_description: 'The user denied access', state: a.state, iss }, 303);
  }
  const code = tokenUrlsafe(32);
  run(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, resource, grant_id, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    sha256(code), a.client.client_id, user.id, a.redirect_uri, a.scopes.join(' '), a.code_challenge, a.resource,
    crypto.randomUUID(), Date.now() + CODE_TTL_MS,
  );
  redirectWith(res, a.redirect_uri, { code, state: a.state, iss }, 303);
});

// ---- token endpoint

class OAuthError extends Error {
  error: string;
  status: number;
  constructor(error: string, description: string, status = 400) {
    super(description);
    this.error = error;
    this.status = status;
  }
}

/** Authenticate the client from Basic auth or form fields. Throws invalid_client. */
function authClient(req: Request, b: Params): ClientRow {
  let id = str(b.client_id);
  let secret = str(b.client_secret);
  let basic = false;
  const h = req.get('authorization');
  if (h && /^basic /i.test(h)) {
    basic = true;
    const raw = Buffer.from(h.slice(6).trim(), 'base64').toString('utf8');
    const i = raw.indexOf(':');
    if (i < 0) throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401);
    let bid: string;
    try {
      bid = decodeURIComponent(raw.slice(0, i));
      secret = decodeURIComponent(raw.slice(i + 1));
    } catch {
      throw new OAuthError('invalid_client', 'Malformed Basic credentials', 401);
    }
    if (id && id !== bid) throw new OAuthError('invalid_request', 'client_id mismatch');
    id = bid;
  }
  if (!id) throw new OAuthError('invalid_client', 'client_id is required', 401);
  const c = getClient(id);
  if (!c) throw new OAuthError('invalid_client', 'Unknown client', 401);
  if (c.token_endpoint_auth_method !== 'none') {
    if (!secret || !c.client_secret_hash || !safeEqual(sha256(secret), c.client_secret_hash)) {
      const e = new OAuthError('invalid_client', 'Client authentication failed', 401);
      if (basic) (e as OAuthError & { basic?: boolean }).basic = true;
      throw e;
    }
  }
  return c;
}

const pkceOk = (verifier: string, challenge: string) =>
  /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && safeEqual(crypto.createHash('sha256').update(verifier).digest('base64url'), challenge);

function tokenFromCode(req: Request, b: Params, client: ClientRow) {
  const code = str(b.code);
  const redirectUri = str(b.redirect_uri);
  const verifier = str(b.code_verifier);
  if (!code || !verifier) throw new OAuthError('invalid_request', 'code and code_verifier are required');
  const row = get<CodeRow>('SELECT * FROM oauth_codes WHERE code_hash = ?', sha256(code));
  if (!row) throw new OAuthError('invalid_grant', 'Invalid authorization code');
  // Single use: claim the code atomically; a second use is a replay -> revoke everything issued from it.
  const claimed = run('UPDATE oauth_codes SET used = 1 WHERE code_hash = ? AND used = 0', row.code_hash).changes;
  if (!claimed) {
    revokeFamily(row.grant_id);
    throw new OAuthError('invalid_grant', 'Authorization code already used');
  }
  if (row.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'Code was issued to another client');
  // redirect_uri must match exactly; it may be omitted only when the client registered a single URI.
  const registered = clientRedirects(client);
  const effectiveRedirect = redirectUri ?? (registered.length === 1 ? registered[0] : undefined);
  if (effectiveRedirect !== row.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri does not match');
  if (row.expires_at < Date.now()) throw new OAuthError('invalid_grant', 'Authorization code expired');
  if (!pkceOk(verifier, row.code_challenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
  const resource = str(b.resource);
  if (resource && !sameResource(resource, row.resource ?? resourceUrl(req))) {
    throw new OAuthError('invalid_target', 'resource does not match the authorization request');
  }
  if (!getUser(row.user_id)) throw new OAuthError('invalid_grant', 'User no longer exists');
  return issueTokens({ clientId: client.client_id, userId: row.user_id, scope: row.scope, resource: row.resource, grantId: row.grant_id });
}

function tokenFromRefresh(b: Params, client: ClientRow) {
  const rt = str(b.refresh_token);
  if (!rt) throw new OAuthError('invalid_request', 'refresh_token is required');
  const row = get<TokenRow>("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'refresh'", sha256(rt));
  if (!row) throw new OAuthError('invalid_grant', 'Invalid refresh token');
  if (row.client_id !== client.client_id) throw new OAuthError('invalid_grant', 'Refresh token was issued to another client');
  if (row.revoked) {
    revokeFamily(row.grant_id); // reuse of a rotated token: assume theft, kill the family
    throw new OAuthError('invalid_grant', 'Refresh token has been revoked');
  }
  if (row.expires_at < Date.now()) throw new OAuthError('invalid_grant', 'Refresh token expired');
  const user = getUser(row.user_id);
  if (!user) throw new OAuthError('invalid_grant', 'User no longer exists');
  let scopes = row.scope.split(' ').filter(Boolean);
  const narrow = str(b.scope);
  if (narrow) {
    const want = narrow.split(/\s+/).filter(Boolean);
    if (!want.every((s) => scopes.includes(s))) throw new OAuthError('invalid_scope', 'Requested scope exceeds the original grant');
    scopes = want;
  }
  if (!editsAnything(user)) scopes = scopes.filter((s) => s !== 'canon:write');
  if (!scopes.length) throw new OAuthError('invalid_scope', 'No scope left for this user');
  return tx(() => {
    const changed = run('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ? AND revoked = 0', row.token_hash).changes;
    if (!changed) {
      revokeFamily(row.grant_id);
      throw new OAuthError('invalid_grant', 'Refresh token has been revoked');
    }
    return issueTokens({ clientId: client.client_id, userId: row.user_id, scope: scopes.join(' '), resource: row.resource, grantId: row.grant_id });
  });
}

const tokenParsers = [express.urlencoded({ extended: false, limit: '16kb', parameterLimit: 30 }), express.json({ limit: '16kb' })];

oauthRouter.post('/oauth/token', ...tokenParsers, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  cleanup();
  const key = addressKey(req.ip);
  if (badTokenRequests.over(key)) return res.status(429).json({ error: 'too_many_requests', error_description: TOO_MANY });
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Params;
  try {
    const grantType = str(b.grant_type);
    if (!grantType) throw new OAuthError('invalid_request', 'grant_type is required');
    if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
      throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${grantType.slice(0, 80)}`);
    }
    const client = authClient(req, b);
    const out = grantType === 'authorization_code' ? tokenFromCode(req, b, client) : tokenFromRefresh(b, client);
    res.json(out);
  } catch (e) {
    if (e instanceof OAuthError) {
      badTokenRequests.add(key);
      if ((e as OAuthError & { basic?: boolean }).basic) res.setHeader('WWW-Authenticate', 'Basic realm="canon"');
      return res.status(e.status).json({ error: e.error, error_description: e.message });
    }
    console.error(e);
    res.status(500).json({ error: 'server_error', error_description: 'Internal error' });
  }
});

// ---- revocation (RFC 7009): always 200, only the calling client's tokens

oauthRouter.post('/oauth/revoke', ...tokenParsers, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Params;
  try {
    const client = authClient(req, b);
    const token = str(b.token);
    if (token) {
      const row = get<TokenRow>('SELECT * FROM oauth_tokens WHERE token_hash = ?', sha256(token));
      if (row && row.client_id === client.client_id) {
        // Revoking a refresh token ends the whole grant; an access token only itself.
        if (row.token_type === 'refresh') revokeFamily(row.grant_id);
        else run('UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?', row.token_hash);
      }
    }
  } catch {
    /* RFC 7009: do not reveal anything */
  }
  res.status(200).json({});
});

// Body-parser errors (malformed JSON, oversize) on the OAuth endpoints -> OAuth-style JSON errors.
oauthRouter.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
  if (!req.path.startsWith('/oauth/') && !req.path.startsWith('/.well-known/')) return next(err);
  const e = err as { status?: number; type?: string; message?: string };
  if (req.path === '/oauth/authorize' && req.method === 'POST') {
    return errorPage(res, e.status ?? 400, 'The request could not be read.');
  }
  res.status(e.status && e.status < 500 ? e.status : 400).json({ error: 'invalid_request', error_description: e.message ?? 'Bad request' });
});

// ---------------------------------------------------------------- resource server side

function unauthorized(req: Request, res: Response, presented: boolean, desc: string) {
  const meta = `${externalBase(req)}/.well-known/oauth-protected-resource/mcp`;
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource_metadata="${meta}"` + (presented ? `, error="invalid_token", error_description="${desc.replace(/"/g, '')}"` : ''),
  );
  res.status(401).json({ error: presented ? 'invalid_token' : 'unauthorized', error_description: desc });
}

/** Bearer-token middleware for /mcp. Attaches req.mcpAuth. */
export function bearerAuth(req: Request, res: Response, next: NextFunction) {
  if (!getSettings().mcp.enabled) {
    return res.status(503).json({ error: 'mcp_disabled', error_description: 'AI access (MCP) is turned off in Canon settings' });
  }
  const h = req.get('authorization') ?? '';
  // no token at all is how a connector finds out where to sign in: only tokens Canon never issued count
  const key = addressKey(req.ip);
  if (h && badBearers.over(key)) return res.status(429).json({ error: 'too_many_requests', error_description: TOO_MANY });
  const m = /^Bearer\s+([A-Za-z0-9._~+/=-]+)\s*$/i.exec(h);
  const row = m ? get<TokenRow>("SELECT * FROM oauth_tokens WHERE token_hash = ? AND token_type = 'access'", sha256(m[1])) : undefined;
  if (h && !row) badBearers.add(key);
  if (!m) return unauthorized(req, res, !!h, 'Missing bearer token');
  if (!row || row.revoked || row.expires_at < Date.now()) return unauthorized(req, res, true, 'Token is invalid, expired or revoked');
  if (row.resource && !sameResource(row.resource, resourceUrl(req))) {
    return unauthorized(req, res, true, 'Token was issued for a different resource');
  }
  const user = getUser(row.user_id);
  if (!user) return unauthorized(req, res, true, 'User no longer exists');
  // the church requires two-step sign-in for this account and it isn't set up: no AI access either (0.19.0 review)
  if (twoStepRequired(user) && !user.totp_enabled) {
    return res.status(403).json({ error: 'two_step_required', error_description: 'Set up two-step sign-in in Canon (Settings → My profile) first: this church requires it.' });
  }
  const scopes = new Set(row.scope.split(' ').filter((s) => (SCOPES as readonly string[]).includes(s)));
  if (!editsAnything(user)) scopes.delete('canon:write'); // re-cap by the user's current role
  run('UPDATE oauth_tokens SET last_used_at = ? WHERE token_hash = ?', Date.now(), row.token_hash);
  req.mcpAuth = { user, clientId: row.client_id, scopes, grantId: row.grant_id };
  next();
}

// ---------------------------------------------------------------- admin (Settings → AI / MCP)

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

/** Active grants (connections): one row per grant family that still has a live token. */
export function listGrants() {
  const now = Date.now();
  return all<{
    grant_id: string; client_id: string; client_name: string | null; user_id: number; user_name: string | null; username: string | null;
    scope: string; created_at: number; last_used_at: number | null; expires_at: number;
  }>(
    `SELECT g.grant_id, l.client_id, c.client_name, l.user_id, u.display_name AS user_name, u.username, l.scope,
            g.created_at, g.last_used_at, a.expires_at
     FROM (SELECT grant_id, MIN(created_at) created_at, MAX(last_used_at) last_used_at FROM oauth_tokens GROUP BY grant_id) g
     JOIN (SELECT grant_id, MAX(expires_at) expires_at FROM oauth_tokens WHERE revoked = 0 AND expires_at > ? GROUP BY grant_id) a
       ON a.grant_id = g.grant_id
     JOIN oauth_tokens l ON l.rowid = (SELECT rowid FROM oauth_tokens WHERE grant_id = g.grant_id ORDER BY created_at DESC, rowid DESC LIMIT 1)
     LEFT JOIN oauth_clients c ON c.client_id = l.client_id
     LEFT JOIN users u ON u.id = l.user_id
     ORDER BY COALESCE(g.last_used_at, g.created_at) DESC`,
    now,
  ).map((r) => ({
    grant_id: r.grant_id,
    client_id: r.client_id,
    client_name: r.client_name ?? 'Unnamed client',
    user_id: r.user_id,
    user_name: r.user_name ?? r.username ?? `#${r.user_id}`,
    scope: r.scope,
    created_at: iso(r.created_at),
    last_used_at: iso(r.last_used_at),
    expires_at: iso(r.expires_at),
  }));
}

/**
 * Disconnect every AI assistant an account has connected (an administrator reset its password or two-step sign-in:
 * a connection made by whoever knew the old ones must not outlive them).
 */
export function revokeUserGrants(userId: number) {
  run('UPDATE oauth_tokens SET revoked = 1 WHERE user_id = ? AND revoked = 0', userId);
  run('UPDATE oauth_codes SET used = 1 WHERE user_id = ?', userId);
}

/** Revoke every token (and outstanding code) of a grant. */
export function revokeGrant(grantId: string) {
  const n = run('UPDATE oauth_tokens SET revoked = 1 WHERE grant_id = ? AND revoked = 0', grantId).changes;
  run('UPDATE oauth_codes SET used = 1 WHERE grant_id = ?', grantId);
  return { ok: true, revoked: Number(n) };
}
