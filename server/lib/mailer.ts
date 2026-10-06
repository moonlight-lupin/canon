// Outgoing e-mail over the church's own SMTP server (Settings → E-mail).
// The SMTP password is write-only: it lives in the internal meta store and is never returned by the API.
// PDPA: recipient addresses go only to the SMTP server; message bodies are never logged.
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

const LOOPBACK = /^(localhost|127(\.\d+){3}|::1|\[::1\])$/i;

/** SMTP is usable once a host and a sender address are set. */
export function smtpConfigured(s: SmtpSettings = getSettings().smtp): boolean {
  return !!s.host.trim() && !!s.from_email.trim();
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

export type MailErrorCode = 'not_configured' | 'auth' | 'connection' | 'dns' | 'timeout' | 'tls' | 'recipient' | 'other';

export class MailError extends Error {
  code: MailErrorCode;
  status: number;
  constructor(code: MailErrorCode, message: string) {
    super(message);
    this.code = code;
    this.status = code === 'not_configured' ? 400 : 502;
  }
}

/** Errors that will hit every message alike, so a batch should stop. */
export const isFatal = (code: MailErrorCode) => code !== 'recipient' && code !== 'other';

/** Turn a nodemailer / socket error into a clear, actionable message. */
export function mapMailError(err: unknown, s: Pick<SmtpSettings, 'host' | 'port' | 'secure'> = getSettings().smtp): MailError {
  if (err instanceof MailError) return err;
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

/** Send one message using Settings → E-mail. Throws MailError. */
export async function sendMail(m: MailMessage): Promise<{ messageId?: string }> {
  const s = getSettings().smtp;
  if (!smtpConfigured(s)) throw new MailError('not_configured', 'E-mail is not set up yet — an administrator can add the SMTP server under Settings → E-mail.');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(m.to)) throw new MailError('recipient', 'Not a valid e-mail address.');
  const transport = factory(transportOptions(s));
  try {
    const r = await transport.sendMail({
      from: { name: s.from_name.trim() || s.from_email.trim(), address: s.from_email.trim() },
      to: m.to,
      replyTo: s.reply_to.trim() || undefined,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    if (getMeta('smtp_failing')) deleteMeta('smtp_failing');
    return r;
  } catch (err) {
    const me = mapMailError(err, s);
    // an error that would hit every message (sign-in, connection …): self-service pauses until e-mail works again
    if (isFatal(me.code)) setMeta('smtp_failing', JSON.stringify({ at: new Date().toISOString(), error: me.message }));
    throw me;
  } finally {
    try {
      transport.close?.();
    } catch {
      /* ignore */
    }
  }
}

/** The e-mail settings as one value (the password hashed): a successful test e-mail is remembered for these. */
export function smtpFingerprint(s: SmtpSettings = getSettings().smtp): string {
  const pw = crypto.createHash('sha256').update(getMeta('smtp_password') ?? '').digest('hex');
  return crypto.createHash('sha256').update(JSON.stringify([s.host.trim(), s.port, s.secure, s.user.trim(), s.from_email.trim(), pw])).digest('hex').slice(0, 32);
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
