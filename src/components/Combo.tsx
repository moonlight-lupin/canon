// A searchable dropdown for long lists (hymns, liturgy, people, roles…): type to filter, ↑ ↓ to move, Enter to
// choose, Esc to close. The list is drawn in a layer above the page (a portal), so dialogs and scrolling panels
// can't clip it. Short fixed choices should stay ordinary <select>s or segmented buttons.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n.tsx';

export interface ComboOption {
  /** '' is reserved for "nothing chosen" */
  value: string;
  label: string;
  /** a second line or right-hand note, e.g. "HP 123 · last sung 4 weeks ago" */
  hint?: string;
  /** extra words that should find this option (other-language titles, numbers, first lines…) */
  search?: string;
  /** heading this option is listed under */
  group?: string;
  /** exact keys (e.g. hymnal numbers "hp 12", "12"): an option whose key equals what was typed comes first */
  keys?: string[];
  disabled?: boolean;
}

/** Lower-case, accents removed, full-width forms folded: "Psalm 23" ≈ "psalm 23", "Ｈｐ１２" ≈ "hp12". */
export const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MAX_SHOWN = 120;

export function Combo({ value, options, onChange, placeholder, noneLabel, disabled, className, ariaLabel, footer }: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** shown as the first choice, value '' (omit when something must be chosen) */
  noneLabel?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** below the list, e.g. a "New…" link */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);

  const current = options.find((o) => o.value === value);
  const all = useMemo(() => (noneLabel !== undefined ? [{ value: '', label: noneLabel }, ...options] : options), [options, noneLabel]);
  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean);
    if (!words.length) return all;
    const hits = all.filter((o) => o.value !== '' && words.every((w) => fold(`${o.label} ${o.hint ?? ''} ${o.search ?? ''}`).includes(w)));
    // titles that start with what was typed first
    const first = fold(words.join(' '));
    const exact = (o: ComboOption) => !!o.keys?.some((k) => fold(k) === first || fold(k).replace(/\s+/g, '') === first.replace(/\s+/g, ''));
    const rank = (o: ComboOption) => (exact(o) ? 0 : fold(o.label).startsWith(first) ? 1 : 2);
    return hits.map((o, i) => ({ o, i, r: rank(o) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.o);
  }, [all, query]);
  const shown = matches.slice(0, MAX_SHOWN);

  const place = () => {
    const r = input.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    // at least 280px wide, but never wider than the window, and moved left when it would stick out (phones)
    const vw = document.documentElement.clientWidth;
    const width = Math.min(Math.max(r.width, 280), vw - 16);
    const left = Math.max(8, Math.min(r.left, vw - 8 - width));
    setRect({ left, top: up ? r.top - 4 : r.bottom + 4, width, up, max: Math.min(360, up ? above : below) });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open, shown.length]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!input.current?.contains(e.target as Node) && !list.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  });
  useEffect(() => {
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function openList() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, all.findIndex((o) => o.value === value)));
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setQuery('');
  }
  function choose(o: ComboOption | undefined) {
    if (!o || o.disabled) return;
    close();
    if (o.value !== value) onChange(o.value);
  }

  let lastGroup: string | undefined;
  return (
    <>
      <input
        ref={input}
        className={`combo-input${className ? ` ${className}` : ''}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${id}-${active}` : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        placeholder={open ? (current?.label ?? placeholder ?? t('Type to search…')) : placeholder ?? noneLabel ?? t('Type to search…')}
        value={open ? query : current?.label ?? (value ? value : '')}
        onFocus={openList}
        onClick={() => !open && openList()}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) openList();
            else setActive((a) => Math.min(shown.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            if (open) {
              e.preventDefault();
              choose(shown[active]);
            }
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              close();
            }
          } else if (e.key === 'Tab') {
            close();
          }
        }}
        autoComplete="off"
        spellCheck={false}
      />
      {open && rect && createPortal(
        <div
          ref={list}
          id={`${id}-list`}
          role="listbox"
          className={`combo-list${rect.up ? ' up' : ''}`}
          style={{ left: rect.left, width: rect.width, maxHeight: rect.max, ...(rect.up ? { bottom: window.innerHeight - rect.top } : { top: rect.top }) }}
        >
          {shown.length === 0 && <div className="combo-empty">{t('Nothing matches. Try fewer words.')}</div>}
          {shown.map((o, i) => {
            const heading = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <div key={`${o.value}-${i}`}>
                {heading && <div className="combo-group">{heading}</div>}
                <div
                  id={`${id}-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  className={`combo-opt${i === active ? ' active' : ''}${o.value === value ? ' chosen' : ''}${o.disabled ? ' disabled' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span className="combo-label">{o.label}</span>
                  {o.hint && <span className="combo-hint">{o.hint}</span>}
                </div>
              </div>
            );
          })}
          {matches.length > MAX_SHOWN && <div className="combo-empty">{t('{n} more — type to narrow the list').replace('{n}', String(matches.length - MAX_SHOWN))}</div>}
          {footer && <div className="combo-foot" onMouseDown={(e) => e.preventDefault()}>{footer}</div>}
        </div>,
        document.body,
      )}
    </>
  );
}
