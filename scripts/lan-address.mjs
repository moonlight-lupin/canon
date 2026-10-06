// Prints this computer's address on the office network (one IPv4 address per line), for start-canon.bat to show
// "Open http://192.168.1.20:3000 from other computers". Private addresses on real network adapters come first;
// virtual adapters (Hyper-V, WSL, VirtualBox, VMware, Docker, VPNs) are left out. Prints nothing if there is none.
import os from 'node:os';

// (macOS: bridge* = Internet Sharing / virtual machines, utun* = VPNs, awdl / llw = AirDrop)
const VIRTUAL = /vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn|tap|tun|bluetooth|bridge|awdl|llw|anpi/i;
const isPrivate = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

const found = [];
for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
  if (VIRTUAL.test(name)) continue;
  for (const a of addrs ?? []) {
    if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
    found.push(a.address);
  }
}
const sorted = [...new Set(found)].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
for (const ip of sorted.slice(0, 3)) console.log(ip);
