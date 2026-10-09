// Building blocks shared by the Slide templates and Bulletin templates pages: a gallery card with its actions,
// numbered editor steps that fold away, a sticky save bar, small "?" tooltips and links into the user guide.
import { useKeepOnScreen } from '../components/onscreen.ts';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';

export { InfoTip };

/** A field label with an optional "?" tooltip. */
export const TipLabel = ({ label, tip }: { label: string; tip?: string }) => (
  <>
    {label}
    {tip && <> <InfoTip text={tip} /></>}
  </>
);

/** "How this works" → the matching section of the user guide. */
export function GuideLink({ anchor, label }: { anchor: string; label?: string }) {
  const { t } = useI18n();
  return (
    <Link className="btn sm ghost" to={`/guide#${anchor}`}>
      <Icon name="book" />
      {label ?? t('How this works')}
    </Link>
  );
}

/** One numbered step of a template editor; closed steps show a one-line summary of their settings. */
export function Step({ n, title, summary, open, onToggle, children }: {
  n: number;
  title: string;
  summary?: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`tp-step${open ? ' open' : ''}`}>
      <button type="button" className="tp-step-head" aria-expanded={open} onClick={onToggle}>
        <span className="tp-step-n">{n}</span>
        <span className="tp-step-title">{title}</span>
        {!open && summary && <span className="tp-step-sum">{summary}</span>}
        <Icon name={open ? 'chevronDown' : 'chevronRight'} width={18} height={18} />
      </button>
      {open && <div className="tp-step-body stack">{children}</div>}
    </section>
  );
}

/** Which steps are open; opening one keeps the others as they are. */
export function useSteps(first = 1) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([first]));
  return {
    isOpen: (n: number) => open.has(n),
    toggle: (n: number) => setOpen((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    }),
  };
}

/** Sticky bar at the bottom of an editor while there are unsaved changes. */
export function SaveBar({ dirty, busy, onSave, onDiscard, problem, message, saveLabel, className }: { dirty: boolean; busy: boolean; onSave: () => void; onDiscard: () => void; problem?: string | null; message?: string; saveLabel?: string; className?: string }) {
  const { t } = useI18n();
  if (!dirty) return null;
  return (
    <div className={`tp-savebar${className ? ` ${className}` : ''}`} role="region" aria-label={t('Unsaved changes')}>
      <span className="tp-savebar-msg">{problem ?? message ?? t('You have unsaved changes. The preview already shows them.')}</span>
      <button type="button" className="btn sm ghost" onClick={onDiscard} disabled={busy}>{t('Discard')}</button>
      <button type="button" className="btn sm primary" onClick={onSave} disabled={busy || !!problem}>{saveLabel ?? t('Save changes')}</button>
    </div>
  );
}

export interface CardAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

/** A gallery card: a picture of the template, its name and badges, a main button and a "⋯" menu of other actions. */
export function TemplateCard({ thumb, name, desc, badges, primary, actions, muted }: {
  thumb: ReactNode;
  name: ReactNode;
  desc?: ReactNode;
  badges?: ReactNode;
  primary: { label: string; onClick: () => void; icon?: Parameters<typeof Icon>[0]['name'] };
  actions: CardAction[];
  muted?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`tp-card${muted ? ' muted' : ''}`}>
      <button type="button" className="tp-card-thumb" onClick={primary.onClick} aria-label={primary.label}>{thumb}</button>
      <div className="tp-card-body">
        <div className="tp-card-name">{name}</div>
        {desc && <div className="tp-card-desc">{desc}</div>}
        {badges}
      </div>
      <div className="tp-card-foot">
        <button type="button" className="btn sm" onClick={primary.onClick}>{primary.icon && <Icon name={primary.icon} />}{primary.label}</button>
        {actions.length > 0 && <CardMenu label={t('More actions')} actions={actions} />}
      </div>
    </div>
  );
}

/**
 * A menu button: "⋯" by default (a template's other actions — archive, restore, church default, delete …), or a
 * labelled button (`trigger`, e.g. "Files ▾"). The list opens above the button, or below it with `down`.
 */
export function CardMenu({ label, actions, trigger, down, fixed }: { label: string; actions: CardAction[]; trigger?: ReactNode; down?: boolean; fixed?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useKeepOnScreen(listRef, open);
  // `fixed`: the list floats over the page (inside a scrolling table it would be cut off); placed below the button,
  // or above it near the bottom of the window
  const [at, setAt] = useState<CSSProperties | undefined>();
  const toggle = () => {
    if (!open && fixed && ref.current) {
      const b = ref.current.getBoundingClientRect();
      const right = window.innerWidth - b.right;
      setAt(b.bottom > window.innerHeight - 260 ? { position: 'fixed', right, bottom: window.innerHeight - b.top + 4, top: 'auto' } : { position: 'fixed', right, top: b.bottom + 4, bottom: 'auto' });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open || !fixed) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, fixed]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape closes this first, not the dialog around it: heard before the dialog (capture) and marked handled
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open]);
  return (
    <div className="tp-menu" ref={ref}>
      {trigger ? (
        <button type="button" className={`btn sm${open ? ' on' : ''}`} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>{trigger}</button>
      ) : (
        <button type="button" className={`tp-more${open ? ' on' : ''}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2.2" /><circle cx="12" cy="12" r="2.2" /><circle cx="19" cy="12" r="2.2" /></svg>
        </button>
      )}
      {open && (
        <div ref={listRef} className={`tp-menu-list${down ? ' down' : ''}`} role="menu" style={fixed ? at : undefined}>
          {actions.map((a) => (
            <button key={a.label} type="button" role="menuitem" className={a.danger ? 'danger' : ''} disabled={a.disabled} title={a.title}
              onClick={() => { setOpen(false); a.onClick(); }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The three steps every template page starts with, shown above the gallery. */
export function HowItWorks({ steps }: { steps: string[] }) {
  return (
    <ol className="tp-how">
      {steps.map((s, i) => <li key={i}><span className="tp-how-n">{i + 1}</span>{s}</li>)}
    </ol>
  );
}
