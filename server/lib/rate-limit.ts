// A small in-memory sliding-window limiter for public pages (self-service sign-in codes, sign-in, OAuth, …): at most
// `max` hits per key within `windowMs`. Church Wi-Fi puts many people behind one address, so per-address limits stay
// generous. It holds at most `cap` keys: past that, the key used longest ago goes — never everyone's counts at once,
// which someone rotating through addresses could otherwise use to start everyone afresh (0.19.8 review).
export function makeLimiter(max: number, windowMs: number, cap = 10_000) {
  // Map order is the order keys were last used: the first one is the one to drop
  const hits = new Map<string, { t: number; tag?: string }[]>();
  const recent = (key: string, now: number) => (hits.get(key) ?? []).filter((h) => now - h.t < windowMs);
  const keep = (key: string, list: { t: number; tag?: string }[]) => {
    hits.delete(key);
    if (list.length) hits.set(key, list);
    while (hits.size > cap) hits.delete(hits.keys().next().value!);
  };
  return {
    /** Count a hit; true when the key is over the limit (the hit is not counted then). */
    limited(key: string): boolean {
      const now = Date.now();
      const list = recent(key, now);
      const over = list.length >= max;
      if (!over) list.push({ t: now });
      keep(key, list);
      return over;
    },
    /** Is the key over the limit? (Counts nothing.) */
    over: (key: string) => recent(key, Date.now()).length >= max,
    /** Count a hit (e.g. a failure), optionally labelled so that it can be forgiven later. */
    add(key: string, tag?: string) {
      const now = Date.now();
      keep(key, [...recent(key, now), { t: now, tag }]);
    },
    /** Forget the key's hits with this label (someone who got their own password right after a typo). */
    forgive(key: string, tag: string) {
      if (hits.has(key)) keep(key, recent(key, Date.now()).filter((h) => h.tag !== tag));
    },
    size: () => hits.size,
    reset: () => hits.clear(),
  };
}

/**
 * The key a visitor's address is counted under: an IPv4 address as it is; an IPv6 address by its /64 network, since a
 * home, a church or a server is given a whole /64 and can use any address in it.
 */
export function addressKey(ip: string | null | undefined): string {
  if (!ip) return '';
  const a = ip.toLowerCase().split('%')[0].replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  if (!a.includes(':')) return a;
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
