// AI connections (OAuth + /mcp), from the Daedalus Workshop's code study of 0.19.10: the token endpoint's limit counts
// only made-up codes, clients and tokens (claude.ai's connectors share a few addresses); every token is bound to this
// Canon's /mcp; the account's restrictions (a password to change, two-step sign-in to set up) apply at authorize,
// refresh and every call; rotation ends the old access token; registered clients never used expire. Fictional data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-agent-conn-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
delete process.env.CANON_PUBLIC_URL;

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const { createApp } = await import('../server/app.ts');
const { createUser } = await import('../server/auth.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { oauthCleanup } = await import('../server/oauth.ts');
const { db, get, run } = await import('../server/db.ts');

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Session = { cookie: string; csrf: string };
let server: Server;
let base = '';
let resource = '';

// Canon believes X-Forwarded-* only from the church's own proxy (here: this computer), so a test can play a visitor
// from its own address, or reach Canon under another name
const from = (ip?: string): Record<string, string> => (ip ? { 'X-Forwarded-For': ip } : {});

before(async () => {
  updateSettings({ trust_proxy: true } as never);
  updateSettings({ mcp: { ...getSettings().mcp, enabled: true } });
  await createUser({ username: 'pastor', display_name: 'Pastor Example', password: 'correct-horse-3', role: 'admin' });
  await createUser({ username: 'deacon', display_name: 'Deacon Example', password: 'correct-horse-3', role: 'editor' });
  server = createApp().listen(0, '127.0.0.1');
  server.keepAliveTimeout = 120_000;
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  resource = `${base}/mcp`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function login(username: string): Promise<Session> {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'correct-horse-3' }) });
  assert.equal(r.status, 200);
  return { cookie: r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '), csrf: ((await r.json()) as Json).csrf };
}
async function register(): Promise<string> {
  const r = await fetch(`${base}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Assistant (test)', redirect_uris: [REDIRECT] }) });
  assert.equal(r.status, 201);
  return ((await r.json()) as Json).client_id;
}
/** Consent, then the code for tokens. `resource` left out unless given (a client may leave it out). */
async function connect(who: Session, clientId: string, opts: { resource?: string } = {}): Promise<Json> {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const form = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 's', code_challenge: challenge, code_challenge_method: 'S256', csrf: who.csrf, decision: 'allow', ...(opts.resource ? { resource: opts.resource } : {}) });
  const r = await fetch(`${base}/oauth/authorize`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: who.cookie }, body: form });
  assert.equal(r.status, 303);
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  assert.ok(code, r.headers.get('location')!);
  const t = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  return t.body;
}
async function token(params: Record<string, string>, ip?: string) {
  const r = await fetch(`${base}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...from(ip) }, body: new URLSearchParams(params) });
  return { status: r.status, body: (await r.json()) as Json };
}
const mcp = async (accessToken: string, headers: Record<string, string> = {}) => {
  const r = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${accessToken}`, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  return { status: r.status, body: (await r.json().catch(() => null)) as Json };
};
const tokenRow = (t: string) => get<{ resource: string | null; revoked: number }>('SELECT resource, revoked FROM oauth_tokens WHERE token_hash = ?', crypto.createHash('sha256').update(t).digest('hex'));

test('1. a busy connector’s expired or rotated refresh tokens don’t use up its address’s allowance', async () => {
  const ip = '198.51.100.7'; // claude.ai: every church's connector arrives from a few addresses
  const who = await login('pastor');
  const client = await register();
  // forty refreshes with a token that has run out (an assistant left unused for a month)
  const stale = await connect(who, client);
  run("UPDATE oauth_tokens SET expires_at = 1 WHERE token_hash = ? AND token_type = 'refresh'", crypto.createHash('sha256').update(stale.refresh_token).digest('hex'));
  for (let i = 0; i < 40; i++) {
    const r = await token({ grant_type: 'refresh_token', refresh_token: stale.refresh_token, client_id: client }, ip);
    assert.equal(r.status, 400, `expired refresh ${i + 1}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, 'invalid_grant');
  }
  // a rotation race: the old refresh token sent again after it was rotated
  const live = await connect(who, client);
  const r1 = await token({ grant_type: 'refresh_token', refresh_token: live.refresh_token, client_id: client }, ip);
  assert.equal(r1.status, 200);
  for (let i = 0; i < 5; i++) assert.equal((await token({ grant_type: 'refresh_token', refresh_token: live.refresh_token, client_id: client }, ip)).status, 400);
  // the address isn't held up: another account's assistant from the same address refreshes
  const other = await connect(await login('deacon'), client);
  const ok = await token({ grant_type: 'refresh_token', refresh_token: other.refresh_token, client_id: client }, ip);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  // made-up refresh tokens still count, and the address then waits
  const guess = '198.51.100.8';
  for (let i = 0; i < 30; i++) assert.equal((await token({ grant_type: 'refresh_token', refresh_token: `made-up-${i}`, client_id: client }, guess)).status, 400);
  assert.equal((await token({ grant_type: 'refresh_token', refresh_token: 'made-up-more', client_id: client }, guess)).status, 429);
});

test('2. a token is always bound to this Canon’s /mcp, also when the assistant didn’t name it', async () => {
  const who = await login('pastor');
  const client = await register();
  const t = await connect(who, client); // no `resource` in the request
  assert.equal(tokenRow(t.access_token)?.resource, resource, 'bound to this Canon’s /mcp');
  assert.equal(tokenRow(t.refresh_token)?.resource, resource);
  assert.equal((await mcp(t.access_token)).status, 200);
  // the same Canon reached under another name is another audience
  assert.equal((await mcp(t.access_token, { 'X-Forwarded-Host': 'canon.other.example' })).status, 401);
  // a token stored before this version, with no audience, is no longer taken anywhere…
  const legacy = await connect(who, client);
  run('UPDATE oauth_tokens SET resource = NULL WHERE grant_id = (SELECT grant_id FROM oauth_tokens WHERE token_hash = ?)', crypto.createHash('sha256').update(legacy.access_token).digest('hex'));
  assert.equal((await mcp(legacy.access_token)).status, 401);
  // …but its refresh token still works, and what it gets is bound
  const r = await token({ grant_type: 'refresh_token', refresh_token: legacy.refresh_token, client_id: client });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(tokenRow(r.body.access_token)?.resource, resource);
  assert.equal((await mcp(r.body.access_token)).status, 200);
});

test('6. a password to change or two-step sign-in to set up stops refresh and every call, not only connecting', async () => {
  const client = await register();
  const who = await login('deacon');
  const t = await connect(who, client);
  assert.equal((await mcp(t.access_token)).status, 200);
  // an administrator resets the password (or sets must-change) after the assistant connected
  run("UPDATE users SET must_change_password = 1 WHERE username = 'deacon'");
  const call = await mcp(t.access_token);
  assert.equal(call.status, 403);
  assert.equal(call.body.error, 'password_change_required');
  const refused = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'invalid_grant');
  assert.match(refused.body.error_description, /new password/);
  run("UPDATE users SET must_change_password = 0 WHERE username = 'deacon'");
  // the church now requires two-step sign-in for everyone, and this account hasn't set it up
  const t2 = await connect(await login('deacon'), client);
  updateSettings({ security: { ...getSettings().security, require_all_2fa: true } });
  try {
    assert.equal((await mcp(t2.access_token)).status, 403);
    const r = await token({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: client });
    assert.equal(r.status, 400);
    assert.match(r.body.error_description, /two-step/);
  } finally {
    updateSettings({ security: { ...getSettings().security, require_all_2fa: false } });
  }
});

test('7. refreshing ends the access token it replaces', async () => {
  const client = await register();
  const t = await connect(await login('pastor'), client);
  const r = await token({ grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client });
  assert.equal(r.status, 200);
  assert.equal(tokenRow(t.access_token)?.revoked, 1);
  assert.equal((await mcp(t.access_token)).status, 401, 'the old access token is no longer taken');
  assert.equal((await mcp(r.body.access_token)).status, 200);
});

test('7. a registered client that is never used expires; one that connected stays', async () => {
  const unused = await register();
  const used = await register();
  await connect(await login('pastor'), used);
  oauthCleanup(Date.now() + 29 * 86400_000);
  assert.ok(get('SELECT 1 FROM oauth_clients WHERE client_id = ?', unused), 'kept for a while (an assistant may finish connecting later)');
  oauthCleanup(Date.now() + 31 * 86400_000);
  assert.equal(get('SELECT 1 FROM oauth_clients WHERE client_id = ?', unused), undefined, 'never used: gone after 30 days');
  assert.ok(get('SELECT 1 FROM oauth_clients WHERE client_id = ?', used), 'used: kept (its name stays in the AI activity log)');
});
