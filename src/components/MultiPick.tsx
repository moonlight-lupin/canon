// A dropdown of tick boxes for a short list (e.g. who on the rota leads an item): the button shows what is ticked,
// the list opens in a layer above the page (like Combo), and each click ticks or unticks one.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface PickOption {
  value: number;
  label: string;
  hint?: string;
}

export function MultiPick({ value, options, onChange, placeholder, disabled, ariaLabel }: {
  value: number[];
  options: PickOption[];
  onChange: (value: number[]) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const chosen = options.filter((o) => value.includes(o.value));

  const place = () => {
    const r = button.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    const vw = document.documentElement.clientWidth;
    const width = Math.min(Math.max(r.width, 240), vw - 16);
    setRect({ left: Math.max(8, Math.min(r.left, vw - 8 - width)), top: up ? r.top - 4 : r.bottom + 4, width, up, max: Math.min(320, up ? above : below) });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!button.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes this first, not the dialog around it: heard before the dialog (capture) and marked handled
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });

  const toggle = (v: number) => onChange(value.includes(v) ? value.filter((x) => x !== v) : options.filter((o) => o.value === v || value.includes(o.value)).map((o) => o.value));
  return (
    <>
      <button
        ref={button}
        type="button"
        className="combo-input multipick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={chosen.length ? '' : 'muted'}>{chosen.length ? chosen.map((o) => o.label).join(', ') : placeholder}</span>
      </button>
      {open && rect && createPortal(
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          aria-multiselectable="true"
          className={`combo-list${rect.up ? ' up' : ''}`}
          style={{ left: rect.left, width: rect.width, maxHeight: rect.max, ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}
        >
          {options.map((o) => (
            <label key={o.value} role="option" aria-selected={value.includes(o.value)} className="combo-opt multipick-opt">
              <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
              <span className="combo-label">{o.label}</span>
              {o.hint && <span className="combo-hint">{o.hint}</span>}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
