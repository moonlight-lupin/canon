// Keep an opened menu or popover inside the window (phones especially): shift it sideways when it would stick out on
// the left or right, narrow it to the window when it is wider, and let it scroll inside when it would run past the
// top or bottom.
import { createElement, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';

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

/**
 * Paper-sized previews (bulletin, run sheet, sheet music, declarations, labels) on a phone: zoom the content down
 * so the page fits the screen's width, instead of the page running off the edge. Never when printing (CSS).
 */
export function useFitWidth<T extends HTMLElement>(deps: unknown[] = []) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.setProperty('--fit-zoom', '1');
      // centred pages overflow on both sides, which scrollWidth doesn't count: take the widest child too
      const natural = Math.max(el.scrollWidth, ...Array.from(el.children).map((c) => c.getBoundingClientRect().width));
      // the screen, not a layout viewport a phone may have widened to fit the page
      const screenW = window.matchMedia('(pointer: coarse)').matches && window.screen?.width ? window.screen.width : Infinity;
      // inside the parent's padding
      const parent = el.parentElement;
      const ps = parent ? getComputedStyle(parent) : null;
      const parentW = parent && ps ? parent.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight) : Infinity;
      const avail = Math.min(parentW || Infinity, document.documentElement.clientWidth - 8, screenW - 8);
      el.style.setProperty('--fit-zoom', natural > avail + 1 ? String(Math.max(0.25, avail / natural)) : '1');
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** A block that zooms its paper-sized content to the screen's width (see useFitWidth). */
export function FitToScreen({ children, deps = [], className }: { children: ReactNode; deps?: unknown[]; className?: string }) {
  const ref = useFitWidth<HTMLDivElement>(deps);
  return createElement('div', { ref, className: className ? `${className} fit-w` : 'fit-w' }, children);
}
