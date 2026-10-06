// A small in-memory sliding-window limiter for public pages (self-service sign-in codes, …): at most `max` hits per
// key within `windowMs`. Church Wi-Fi puts many people behind one address, so per-address limits stay generous.
export function makeLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Count a hit; true when the key is over the limit (the hit is not counted then). */
    limited(key: string): boolean {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
      return false;
    },
    reset: () => hits.clear(),
  };
}
