// Outgoing e-mail (Settings → E-mail): over the church's own SMTP server, or through AgentMail's HTTPS API with an API key.
// The SMTP password and the AgentMail API key are write-only: they live in the internal meta store and are never returned by the API.
// PDPA: recipient addresses go only to the SMTP server / AgentMail; message bodies are never logged.
import { config } from '../config.ts';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { deleteMeta, getMeta, getSettings, setMeta, type SmtpSettings } from '../repo/settings.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Options handed to the transport factory (nodemailer SMTP options). */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  tls: { minVersion: 'TLSv1.2'; servername: string };
}

/** The part of a nodemailer transporter Canon uses. */
export interface MailTransport {
  sendMail(msg: {
    from: { name: string; address: string } | string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<{ messageId?: string }>;
  close?(): void;
}
export type TransportFactory = (opts: SmtpTransportOptions) => MailTransport;

const defaultFactory: TransportFactory = (opts) => nodemailer.createTransport(opts) as unknown as MailTransport;
let factory: TransportFactory = defaultFactory;

/** Swap the transport (tests use nodemailer's jsonTransport/streamTransport). Pass null to restore SMTP. */
export function setTransportFactory(f: TransportFactory | null) {
  factory = f ?? defaultFactory;
}

/** The part of fetch the AgentMail sender uses (tests swap it). */
export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;
const defaultFetch: HttpFetch = (url, init) => fetch(url, init);
let httpFetch: HttpFetch = defaultFetch;

/** Swap the HTTP client AgentMail is called with. Pass null to restore fetch. */
export function setHttpFetch(f: HttpFetch | null) {
  httpFetch = f ?? defaultFetch;
}

export const AGENTMAIL_API = 'https://api.agentmail.to/v0';

const LOOPBACK = /^(localhost|127(\.\d+){3}|::1|\[::1\])$/i;

const isAgentMail = (s: SmtpSettings) => s.provider === 'agentmail';

/** E-mail is usable once a sender address is set, with an SMTP host or (AgentMail) a saved API key. */
export function smtpConfigured(s: SmtpSettings = getSettings().smtp): boolean {
  if (!s.from_email.trim()) return false;
  return isAgentMail(s) ? !!getMeta('agentmail_api_key') : !!s.host.trim();
}

export function transportOptions(s: SmtpSettings = getSettings().smtp, password = getMeta('smtp_password') ?? ''): SmtpTransportOptions {
  const host = s.host.trim();
  return {
    host,
    port: s.port,
    secure: s.secure,
    // Never send a password over an unencrypted link to a remote server: insist on STARTTLS.
    requireTLS: !s.secure && !!s.user && !LOOPBACK.test(host),
    auth: s.user ? { user: s.user, pass: password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2', servername: host },
  };
}

export type MailErrorCode = 'test_copy' | 'not_configured' | 'auth' | 'connection' | 'dns' | 'timeout' | 'tls' | 'recipient' | 'other';

export class MailError extends Error {
  code: MailErrorCode;
  status: number;
  constructor(code: MailErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = code === 'not_configured' || code === 'test_copy' ? 400 : 502;
  }
}

/** Errors that will hit every message alike, so a batch should stop. */
export const isFatal = (code: MailErrorCode) => code !== 'recipient' && code !== 'other';

/** An AgentMail API answer other than 2xx (its body: { name, code?, message?, errors? }). */
class AgentMailHttpError extends Error {
  status: number;
  body: { name?: string; code?: string; message?: string; errors?: unknown };
  constructor(status: number, body: AgentMailHttpError['body']) {
    super(body.message || body.name || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function mapAgentMailError(err: unknown, inbox: string): MailError {
  if (err instanceof AgentMailHttpError) {
    const { status, body } = err;
    const detail = String(body.message || body.code || body.name || '').slice(0, 200);
    // this message was refused (e.g. a suppressed or bounced recipient); others may still go
    if (status === 403 && /reject/i.test(`${body.name ?? ''} ${body.code ?? ''}`)) return new MailError('recipient', `AgentMail refused this message${detail ? `: ${detail}` : '.'}`);
    // a wrong key is 403 Forbidden (seen live), 401 by the book
    if (status === 401 || status === 403) return new MailError('auth', `AgentMail did not accept the API key for ${inbox} — check the key, and that it may send from this inbox (a key made for one inbox works only for that one).`);
    if (status === 404) return new MailError('auth', `AgentMail has no inbox ${inbox} for this API key — the inbox address must be one of your AgentMail inboxes.`);
    if (status === 429) return new MailError('connection', 'AgentMail is limiting how fast this account sends — try again in a few minutes.');
    if (status >= 500) return new MailError('connection', `AgentMail is not available just now (HTTP ${status}) — try again later.`);
    if (status === 400 && /\bto\b/.test(JSON.stringify(body.errors ?? ''))) return new MailError('recipient', 'AgentMail refused the recipient address.');
    return new MailError('other', `AgentMail error (HTTP ${status})${detail ? `: ${detail}` : ''}`);
  }
  // fetch failures: the reason is in err.cause
  const e = (err ?? {}) as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const why = `${e.cause?.code ?? ''} ${e.cause?.message ?? ''} ${e.message ?? ''}`;
  if (e.name === 'TimeoutError' || e.name === 'AbortError' || /ETIMEDOUT|timed? ?out/i.test(why)) return new MailError('timeout', 'AgentMail did not respond in time — check this computer’s internet connection.');
  if (/ENOTFOUND|EAI_AGAIN/.test(why)) return new MailError('dns', 'api.agentmail.to could not be found — check this computer’s internet connection.');
  if (/certificate|SSL|TLS/i.test(why)) return new MailError('tls', 'The secure connection to AgentMail failed — a firewall or proxy may be intercepting it.');
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed/i.test(why)) return new MailError('connection', 'Could not reach AgentMail — check this computer’s internet connection.');
  return new MailError('other', `AgentMail error: ${String(e.message ?? err).slice(0, 300)}`);
}

/** Turn a nodemailer / socket / AgentMail error into a clear, actionable message. */
export function mapMailError(
  err: unknown,
  s: Pick<SmtpSettings, 'host' | 'port' | 'secure'> & Partial<Pick<SmtpSettings, 'provider' | 'from_email'>> = getSettings().smtp,
): MailError {
  if (err instanceof MailError) return err;
  if (err instanceof AgentMailHttpError || s.provider === 'agentmail') return mapAgentMailError(err, (s.from_email ?? '').trim());
  const e = (err ?? {}) as { code?: string; errno?: string | number; responseCode?: number; message?: string; command?: string };
  const msg = String(e.message ?? err ?? 'Unknown error');
  const where = `${s.host}:${s.port}`;
  const sys = typeof e.errno === 'string' ? e.errno : '';
  if (e.code === 'EAUTH' || e.code === 'ENOAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    return new MailError('auth', 'SMTP sign-in failed — check the user name and password. Gmail / Google Workspace and Microsoft 365 need an app password.');
  }
  if (e.code === 'EDNS' || sys === 'ENOTFOUND' || /ENOTFOUND|EAI_AGAIN/.test(msg)) {
    return new MailError('dns', `SMTP server not found: ${s.host} — check the host name.`);
  }
  if (e.code === 'ETLS' || e.code === 'EREQUIRETLS' || /wrong version number|SSL|TLS|certificate|self[- ]signed/i.test(msg)) {
    const hint = s.secure
      ? 'Port 587 normally uses SSL/TLS off (STARTTLS); try that.'
      : 'Port 465 needs SSL/TLS on; port 587 needs the server to offer STARTTLS.';
    return new MailError('tls', `Secure connection to ${where} failed. ${hint}`);
  }
  if (e.code === 'ETIMEDOUT' || sys === 'ETIMEDOUT' || /timeout|timed out/i.test(msg)) {
    return new MailError('timeout', `The SMTP server at ${where} did not respond in time — check the host, port and firewall.`);
  }
  if (e.code === 'ECONNECTION' || e.code === 'ESOCKET' || /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/.test(msg + sys)) {
    return new MailError('connection', `Could not connect to the SMTP server at ${where} — check the host and port.`);
  }
  if (e.code === 'EENVELOPE' || (e.responseCode && e.responseCode >= 550 && e.command?.startsWith('RCPT'))) {
    return new MailError('recipient', 'The SMTP server refused the recipient address.');
  }
  return new MailError('other', `SMTP error: ${msg.slice(0, 300)}`);
}

/** One message through AgentMail: POST /inboxes/{inbox}/messages/send, the inbox being the sender address. */
async function sendViaAgentMail(s: SmtpSettings, m: MailMessage): Promise<{ messageId?: string }> {
  const res = await httpFetch(`${AGENTMAIL_API}/inboxes/${encodeURIComponent(s.from_email.trim())}/messages/send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${getMeta('agentmail_api_key') ?? ''}`, 'content-type': 'application/json' },
    // no sender name: AgentMail sends with the inbox's own display name
    body: JSON.stringify({ to: m.to, reply_to: s.reply_to.trim() || undefined, subject: m.subject, text: m.text, html: m.html }),
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) ?? {};
  } catch { /* not JSON */ }
  if (res.status < 200 || res.status >= 300) throw new AgentMailHttpError(res.status, body as AgentMailHttpError['body']);
  return { messageId: typeof body.message_id === 'string' ? body.message_id : undefined };
}

async function sendViaSmtp(s: SmtpSettings, m: MailMessage): Promise<{ messageId?: string }> {
  const transport = factory(transportOptions(s));
  try {
    return await transport.sendMail({
      from: { name: s.from_name.trim() || s.from_email.trim(), address: s.from_email.trim() },
      to: m.to,
      replyTo: s.reply_to.trim() || undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
  } finally {
    try {
      transport.close?.();
    } catch {
      /* ignore */
    }
  }
}

/** Send one message using Settings → E-mail. Throws MailError. */
export async function sendMail(m: MailMessage): Promise<{ messageId?: string }> {
  // a test copy of the church's data (CANON_TEST_COPY=1) never writes to real members
  if (config.testCopy) throw new MailError('test_copy', 'This is a test copy of Canon: it sends no e-mail.');
  const s = getSettings().smtp;
  if (!smtpConfigured(s)) throw new MailError('not_configured', 'E-mail is not set up yet — an administrator can set it up under Settings → E-mail.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.to)) throw new MailError('recipient', 'Not a valid e-mail address.');
  try {
    const r = await (isAgentMail(s) ? sendViaAgentMail(s, m) : sendViaSmtp(s, m));
    if (getMeta('smtp_failing')) deleteMeta('smtp_failing');
    return r;
  } catch (err) {
    const me = mapMailError(err, s);
    // an error that would hit every message (sign-in, connection …): self-service pauses until e-mail works again
    if (isFatal(me.code)) setMeta('smtp_failing', JSON.stringify({ at: new Date().toISOString(), error: me.message }));
    throw me;
  }
}

/** The e-mail settings as one value (the password hashed): a successful test e-mail is remembered for these. */
export function smtpFingerprint(s: SmtpSettings = getSettings().smtp): string {
  const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
  const parts = isAgentMail(s)
    ? ['agentmail', s.from_email.trim(), hash(getMeta('agentmail_api_key') ?? '')]
    // unchanged for SMTP, so a test e-mail that worked before AgentMail existed still counts
    : [s.host.trim(), s.port, s.secure, s.user.trim(), s.from_email.trim(), hash(getMeta('smtp_password') ?? '')];
  return hash(JSON.stringify(parts)).slice(0, 32);
}

/** E-mail is known to work: a test e-mail succeeded with the current settings, and nothing has failed since. */
export function smtpHealth(): { tested: boolean; failing: { at: string; error: string } | null } {
  const tested = smtpConfigured() && getMeta('smtp_tested') === smtpFingerprint();
  let failing: { at: string; error: string } | null = null;
  try {
    failing = JSON.parse(getMeta('smtp_failing') ?? 'null');
  } catch { /* none */ }
  return { tested, failing };
}
