// This computer's address on the office network (as scripts/lan-address.mjs prints for the launchers), for links
// that other devices open: QR labels made while Canon is open as "localhost" on the office PC.
import os from 'node:os';
import { config } from '../config.ts';
import { publicUrl } from './public-url.ts';

// (macOS: bridge* = Internet Sharing / virtual machines, utun* = VPNs, awdl / llw = AirDrop)
const VIRTUAL = /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn|tap|tun|bluetooth|bridge|awdl|llw|anpi/i;
const isPrivate = (ip: string) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

export function lanAddress(): string | null {
  const found: string[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) found.push(a.address);
  }
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)))[0] ?? null;
}

/**
 * The address to put in a QR label: the one the browser used, unless that only works on this computer
 * (localhost); then the church's public address, else this computer's network address and port.
 */
export function addressForOthers(browserBase: string): string {
  let u: URL;
  try {
    u = new URL(browserBase);
  } catch {
    return browserBase;
  }
  if (!/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(u.hostname)) return `${u.protocol}//${u.host}`;
  const pub = publicUrl();
  if (pub) return pub;
  const ip = lanAddress();
  return ip ? `http://${ip}:${config.port}` : `${u.protocol}//${u.host}`;
}
