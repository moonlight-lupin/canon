// The public address Canon is reached at from the internet (needed for claude.ai's OAuth connector).
// Set by an administrator in Settings → AI / MCP; the CANON_PUBLIC_URL / CANON_TRUST_PROXY environment
// variables remain as an optional override for IT administrators.
import { config } from '../config.ts';
import { getSettings } from '../repo/settings.ts';

/** Public origin without trailing slash, or '' when not configured. */
export function publicUrl(): string {
  return (config.publicUrl || getSettings().public_url || '').replace(/\/+$/, '');
}

/**
 * Whether to honour X-Forwarded-* headers. True when explicitly enabled, or when a public address is set
 * (in practice Canon is then reached through a tunnel / reverse proxy such as Cloudflare Tunnel).
 */
export function trustProxy(): boolean {
  return config.trustProxy || getSettings().trust_proxy || !!publicUrl();
}

/** Validate an administrator-entered public address: https origin (http only for this computer), no path. */
export function normalisePublicUrl(input: string): { url: string } | { error: string } {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return { url: '' };
  let u: URL;
  try {
    u = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return { error: 'That is not a valid web address.' };
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    return { error: 'The public address must start with https:// (claude.ai only connects over https).' };
  }
  if ((u.pathname && u.pathname !== '/') || u.search || u.hash || u.username) {
    return { error: 'Enter only the address, without a path — e.g. https://canon.your-church.org' };
  }
  return { url: u.origin };
}
