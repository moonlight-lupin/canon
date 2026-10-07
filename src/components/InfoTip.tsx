// A small "?" that explains a setting. The explanation is drawn in a layer above the page (a portal with fixed
// position), so tables and panels that scroll or clip their contents can't cut it off. It opens on hover and on
// keyboard focus, flips below the "?" near the top of the window and stays inside the window's edges.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const GAP = 8;
const MARGIN = 8;

export function InfoTip({ text }: { text: string }) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);

  const place = useCallback(() => {
    const el = ref.current;
    const b = box.current;
    if (!el || !b) return;
    const r = el.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const below = r.top - GAP - h < MARGIN;
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - w / 2), window.innerWidth - MARGIN - w);
    setPos({ left, top: below ? r.bottom + GAP : r.top - GAP - h, below });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place, text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', close);
    };
  }, [open, place]);

  return (
    <>
      <span
        ref={ref}
        className="tp-tip"
        tabIndex={0}
        role="button"
        aria-label={text}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        // inside a <label>, a click would focus the field instead: keep it on the "?" (tap to show on phones)
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        ?
      </span>
      {open && createPortal(
        <div
          ref={box}
          id={id}
          role="tooltip"
          className={`tp-tipbox${pos?.below ? ' below' : ''}`}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * Shows `content` in a panel above (or below) its children while the pointer rests on them or they have keyboard
 * focus — the same on every system, unlike a browser's own title tooltip (slow on a Mac, cut short on Windows).
 * Long content scrolls inside the panel; the panel stays open while the pointer is on it.
 */
export function HoverTip({ content, children, lang, tap }: {
  content: ReactNode; children: ReactNode; lang?: string;
  /** a tap (or click) opens and closes it, for phones and tablets; tapping elsewhere closes it */
  tap?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const later = (v: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(v), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const place = useCallback(() => {
    const el = ref.current;
    const b = box.current;
    if (!el || !b) return;
    const r = el.getBoundingClientRect();
    const w = b.offsetWidth;
    const h = b.offsetHeight;
    const below = r.top - GAP - h < MARGIN;
    const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - MARGIN - w);
    setPos({ left, top: below ? r.bottom + GAP : r.top - GAP - h, below });
  }, []);
  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place, content]);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // a tap anywhere else closes a tapped-open panel
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !box.current?.contains(e.target as Node)) later(false, 0);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', close);
    if (tap) window.addEventListener('pointerdown', away);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', away);
    };
  }, [open, place, tap]);

  return (
    <>
      <span ref={ref} className={`hover-tip${tap ? ' tap' : ''}`} aria-describedby={open ? id : undefined}
        onMouseEnter={() => later(true, 250)} onMouseLeave={() => later(false, 150)}
        onFocus={() => later(true, 0)} onBlur={() => later(false, 0)}
        onClick={(e) => {
          if (!tap) return later(false, 0);
          e.preventDefault();
          window.clearTimeout(timer.current);
          setOpen((o) => !o);
        }}>
        {children}
      </span>
      {open && createPortal(
        <div ref={box} id={id} role="tooltip" lang={lang} className={`tp-tipbox hover-tipbox${pos?.below ? ' below' : ''}`}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: 'hidden' }}
          onMouseEnter={() => later(true, 0)} onMouseLeave={() => later(false, 150)}>
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
