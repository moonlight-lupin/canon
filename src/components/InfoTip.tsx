// A small "?" that explains a setting. The explanation is drawn in a layer above the page (a portal with fixed
// position), so tables and panels that scroll or clip their contents can't cut it off. It opens on hover and on
// keyboard focus, flips below the "?" near the top of the window and stays inside the window's edges.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
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
