// Keep an opened menu or popover inside the window (phones especially): shift it sideways when it would stick out on
// the left or right, narrow it to the window when it is wider, and let it scroll inside when it would run past the
// top or bottom.
import { useLayoutEffect, type RefObject } from 'react';

const GAP = 8;

export function keepOnScreen(el: HTMLElement) {
  el.style.transform = '';
  el.style.maxWidth = '';
  el.style.maxHeight = '';
  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  if (el.getBoundingClientRect().width > W - 2 * GAP) el.style.maxWidth = `${W - 2 * GAP}px`;
  const r = el.getBoundingClientRect();
  const dx = r.left < GAP ? GAP - r.left : r.right > W - GAP ? W - GAP - r.right : 0;
  if (dx) el.style.transform = `translateX(${Math.round(dx)}px)`;
  if (r.bottom > H - GAP && r.top < H - GAP) {
    el.style.maxHeight = `${Math.max(140, H - GAP - Math.max(r.top, GAP))}px`;
    el.style.overflowY = 'auto';
  } else if (r.top < GAP && r.bottom > GAP) {
    el.style.maxHeight = `${Math.max(140, r.bottom - GAP)}px`;
    el.style.overflowY = 'auto';
  }
}

/** Run keepOnScreen on the element each time it opens (and when the window changes size while open). */
export function useKeepOnScreen(ref: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    keepOnScreen(el);
    const again = () => ref.current && keepOnScreen(ref.current);
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [open, ref]);
}
