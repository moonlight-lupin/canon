// One text size for a whole deck of slides (the slide theme's "Same text size on every slide"). Pure helpers, so
// the rule is unit-tested without a browser; Slides.tsx measures the real slides with them.

/** Smallest text size the slides go down to (px on the 1920×1080 stage). */
export const MIN_FONT = 14;
/** Below this deck size the console warns: some slide holds too much text to read from the back. */
export const LOW_FONT_WARN = 40;

/** Largest size in [lo, hi] for which `ok` holds (ok is true up to some size, false above it); `lo` if none. */
export function largestFitting(ok: (size: number) => boolean, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  if (ok(hi)) return hi;
  let a = lo;
  let b = hi;
  while (b - a > 1) {
    const mid = (a + b) >> 1;
    if (ok(mid)) a = mid;
    else b = mid;
  }
  return a;
}

/**
 * The deck size: the largest size at which EVERY item fits, i.e. the smallest of the sizes each item fits at,
 * capped at `cap` and never below `floor`. Items that already fit at the current best are not searched again.
 * `binding` is the index of the item that set the size (-1 when the cap did).
 */
export function deckFit<T>(items: T[], fits: (item: T, size: number) => boolean, cap: number, floor = MIN_FONT): { size: number; binding: number } {
  let best = Math.max(floor, Math.floor(cap));
  let binding = -1;
  items.forEach((it, i) => {
    if (best <= floor || fits(it, best)) return;
    best = largestFitting((n) => fits(it, n), floor, best - 1);
    binding = i;
  });
  return { size: best, binding };
}

/** The theme's largest size: a base size times the theme's text-size factor (--slide-scale, 0.6–1.5). */
export function scaledCap(base: number, scale: number): number {
  return Math.round(base * (scale > 0.2 && scale < 3 ? scale : 1));
}
