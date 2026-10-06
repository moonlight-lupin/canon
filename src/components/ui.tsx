// Shared UI primitives: modal, toast, fields, bilingual input, page header, confirm.
import { HoverTip } from './InfoTip.tsx';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { L10n, Lang, Role } from '../../shared/types.ts';
import type { Settings } from '../types-client.ts';
import { pickL10n, useContentLangs, useI18n } from '../i18n.tsx';
import { isChinese, langInfo } from '../../shared/languages.ts';
import { Icon } from './icons.tsx';
import type { Access, PermModule, RoleDef } from '../../shared/permissions.ts';

// ---------------------------------------------------------------- session

export interface SessionUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  lang: Lang;
  /** the member this account belongs to */
  person_id?: number | null;
  /** the groups that member leads (their meetings can be recorded with any account) */
  leads?: number[];
  /** what the account's role allows (shared/permissions.ts) */
  role_def?: RoleDef;
  /** two-step sign-in is on */
  totp_enabled?: boolean | number;
  /** the administrator who set Canon up (the one account that may stay unlinked to a member, with a reminder) */
  first_admin?: boolean;
}
interface Session {
  user: SessionUser;
  /** may the page being shown be edited (its module's access in the account's role) */
  canEdit: boolean;
  isAdmin: boolean;
  /** at least this access to a module */
  can: (module: PermModule, access: Access) => boolean;
  logout: () => void;
  /** church settings (languages, name, …); reloadSettings() after changing them */
  settings: Settings | undefined;
  reloadSettings: () => void;
  /** re-read the signed-in user (e.g. after a profile change) */
  refresh: () => Promise<void>;
}
export const SessionCtx = createContext<Session>(null!);
export const useSession = () => useContext(SessionCtx);

type MeetingLike = { kind?: string; group_id?: number | null; leader_id?: number | null } | null | undefined;
/**
 * May this account record this meeting (its record, details and next meeting)? Editors and administrators may;
 * so may the member who leads it, or who leads its group, even with a read-only account (the server checks too).
 */
export function useCanRecord() {
  const { user, canEdit } = useSession();
  return (m: MeetingLike) => canEdit || (!!m && m.kind === 'meeting' && !!user.person_id
    && (m.leader_id === user.person_id || (m.group_id != null && (user.leads ?? []).includes(m.group_id))));
}

// ---------------------------------------------------------------- toast

type Toast = { id: number; msg: string; err?: boolean };
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), err ? 6000 : 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts no-print" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.err ? ' err' : ''}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an async action, toasting errors; returns the result or undefined. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast((e as Error).message, true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy };
}

// ---------------------------------------------------------------- modal

export function Modal({
  title, onClose, children, footer, size,
}: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; size?: 'lg' }) {
  const { t } = useI18n();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${size ? ' ' + size : ''}`} role="dialog" aria-modal="true">
        <L10nEditScope>
          <div className="modal-head">
            <h2>{title}</h2>
            <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <L10nSwitcher />
              <button className="btn ghost icon" onClick={onClose} aria-label={t('Close')}><Icon name="x" /></button>
            </div>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </L10nEditScope>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- layout bits

export function PageHead({ eyebrow, title, sub, children }: { eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="page-head">
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {sub && <div className="sub">{sub}</div>}
        </div>
        {children && <div className="row">{children}</div>}
      </div>
      <div className="reed-rule" aria-hidden="true" />
    </>
  );
}

export const Loading = () => (
  <div className="loading"><div className="spinner" /></div>
);

export function ErrorBox({ error }: { error: string }) {
  return <div className="callout warn">{error}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {/* a message, not a section heading (it would break the page's heading order) */}
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- form fields

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`field${className ? ' ' + className : ''}`}>
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// ---------------------------------------------------------------- multilingual editing
//
// A dialog edits one language at a time: a switcher in its header (EN | 简 | 繁 …, or a dropdown for many
// languages) changes every multilingual field together and marks languages that still have gaps. While
// editing a non-primary language, each field shows the primary-language text underneath as a reference.
// "Side by side" (remembered per computer) shows all languages at once. Outside dialogs, each field has
// its own small language tabs.

type L10nMode = 'single' | 'side';
interface L10nEditCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  mode: L10nMode;
  setMode: (m: L10nMode) => void;
  langs: Lang[];
  /** per registered field: the languages that have text */
  filled: Record<string, Lang[]>;
  register: (id: string, langs: Lang[] | null) => void;
}
const L10nEdit = createContext<L10nEditCtx | null>(null);

const readMode = (): L10nMode => {
  try {
    return localStorage.getItem('canon.l10nMode') === 'side' ? 'side' : 'single';
  } catch {
    return 'single';
  }
};

/** Shared language state for all multilingual fields inside (Modal provides one). */
export function L10nEditScope({ children }: { children: ReactNode }) {
  const langs = useContentLangs();
  const { lang: uiLang } = useI18n();
  const [lang, setLang] = useState<Lang>(() => (langs.includes(uiLang) ? uiLang : langs[0]));
  const [mode, setModeState] = useState<L10nMode>(readMode);
  const [filled, setFilled] = useState<Record<string, Lang[]>>({});
  const register = useCallback((id: string, ls: Lang[] | null) => {
    setFilled((f) => {
      if (ls === null) {
        if (!(id in f)) return f;
        const rest = { ...f };
        delete rest[id];
        return rest;
      }
      const cur = f[id];
      if (cur && cur.length === ls.length && cur.every((x, i) => x === ls[i])) return f;
      return { ...f, [id]: ls };
    });
  }, []);
  const setMode = useCallback((m: L10nMode) => {
    setModeState(m);
    try {
      localStorage.setItem('canon.l10nMode', m);
    } catch {
      /* ignore */
    }
  }, []);
  const value = useMemo(() => ({ lang, setLang, mode, setMode, langs, filled, register }), [lang, mode, setMode, langs, filled, register]);
  return <L10nEdit.Provider value={value}>{children}</L10nEdit.Provider>;
}

/** A language counts as covered when it has text, or (Chinese) when the other script does — it converts automatically. */
const covered = (have: Lang[], l: Lang) =>
  have.includes(l) || (l === 'zh-Hant' && have.includes('zh')) || (l === 'zh' && have.includes('zh-Hant'));

/**
 * Which language a dialog's or a section's fields show — all of them at once — with gap markers and the
 * side-by-side toggle. On a page it appears once a section has `min` multilingual fields (default: any).
 */
export function L10nSwitcher({ min = 1 }: { min?: number }) {
  const ctx = useContext(L10nEdit);
  const { t } = useI18n();
  if (!ctx || ctx.langs.length < 2 || Object.keys(ctx.filled).length < min) return null;
  const fields = Object.values(ctx.filled);
  // a gap = a field that has text in some language but not this one
  const gaps = (l: Lang) => fields.filter((have) => have.length > 0 && !covered(have, l)).length;
  return (
    <div className="l10n-switch row" style={{ gap: 6, flexWrap: 'nowrap' }}>
      {ctx.mode === 'single' && (ctx.langs.length > 4 ? (
        <select value={ctx.lang} onChange={(e) => ctx.setLang(e.target.value)} aria-label={t('Editing language')} style={{ width: 'auto', minHeight: 30 }}>
          {ctx.langs.map((l) => <option key={l} value={l}>{langInfo(l).native}{gaps(l) ? ` (${gaps(l)} ${t('missing')})` : ''}</option>)}
        </select>
      ) : (
        <div className="seg" role="tablist" aria-label={t('Editing language')}>
          {ctx.langs.map((l) => (
            <button key={l} type="button" role="tab" aria-selected={ctx.lang === l} className={ctx.lang === l ? 'on' : ''}
              title={`${langInfo(l).name}${gaps(l) ? ` — ${gaps(l)} ${t('missing')}` : ''}`} onClick={() => ctx.setLang(l)}>
              {langInfo(l).short}{gaps(l) ? <span className="l10n-gap" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ))}
      <button type="button" className={`btn sm ghost${ctx.mode === 'side' ? ' on' : ''}`} aria-pressed={ctx.mode === 'side'}
        title={ctx.mode === 'side' ? t('One language at a time') : t('Side by side')}
        onClick={() => ctx.setMode(ctx.mode === 'side' ? 'single' : 'side')}>
        <Icon name="layout" />{ctx.mode === 'side' ? t('One at a time') : t('Side by side')}
      </button>
    </div>
  );
}

let l10nSeq = 0;

/** Multilingual input for the church's content languages (Settings → Languages). */
export function L10nInput({
  value, onChange, multiline, rows = 4, placeholder, serif, langs: only,
}: { value: L10n | undefined; onChange: (v: L10n) => void; multiline?: boolean; rows?: number; placeholder?: L10n; serif?: boolean; langs?: Lang[] }) {
  const church = useContentLangs();
  const ctx = useContext(L10nEdit);
  const { t } = useI18n();
  const langs = only ?? church;
  const v = value ?? {};
  const set = (lang: Lang, s: string) => onChange({ ...v, [lang]: s });
  // Keep values for languages that are no longer enabled visible, so nothing is silently lost.
  const extra = Object.keys(v).filter((l) => !langs.includes(l) && v[l]?.trim());
  const shown = [...langs, ...extra];
  const filledLangs = shown.filter((l) => v[l]?.trim());
  const [localLang, setLocalLang] = useState<Lang>(shown[0]);
  // inside a dialog or section with a language switch: this field's own tab overrides it until the switch is used again
  const [peek, setPeek] = useState<Lang | null>(null);
  const ctxLang = ctx?.lang;
  useEffect(() => setPeek(null), [ctxLang]);

  // Register with the dialog so its switcher can show gaps.
  const [id] = useState(() => `l10n-${++l10nSeq}`);
  const register = ctx?.register;
  const filledKey = filledLangs.join(',');
  useEffect(() => {
    register?.(id, filledKey ? filledKey.split(',') : []);
  }, [register, id, filledKey]);
  useEffect(() => () => register?.(id, null), [register, id]);

  const field = (lang: Lang, withTag: boolean) => {
    const info = langInfo(lang);
    const auto = !v[lang]?.trim() && ((lang === 'zh-Hant' && !!v.zh?.trim()) || (lang === 'zh' && !!v['zh-Hant']?.trim()));
    // empty here but written in another language: show that text faintly, so it is clear where the words are
    const other = !withTag && !v[lang]?.trim() ? filledLangs.find((l) => l !== lang) : undefined;
    const ph = auto
      ? `${t('Automatic from')} ${langInfo(lang === 'zh' ? 'zh-Hant' : 'zh').native}`
      : placeholder?.[lang] ?? (other ? `${langInfo(other).native}: ${v[other]!.trim().split('\n')[0]}` : undefined);
    return (
      <div key={lang} className="l10n-field">
        {withTag && <div className="tag" title={info.name}>{info.native}{extra.includes(lang) ? ' ·' : ''}</div>}
        {multiline ? (
          <textarea className={serif ? 'serif' : ''} rows={rows} value={v[lang] ?? ''} placeholder={ph} onChange={(e) => set(lang, e.target.value)} lang={info.htmlLang} />
        ) : (
          <input value={v[lang] ?? ''} placeholder={ph} onChange={(e) => set(lang, e.target.value)} lang={info.htmlLang} />
        )}
      </div>
    );
  };

  if (shown.length === 1) return <div className="l10n single">{field(shown[0], false)}</div>;

  // Side by side (a dialog where the user chose it)
  if (ctx && ctx.mode === 'side') {
    return (
      <div className="l10n" style={{ gridTemplateColumns: `repeat(${Math.min(shown.length, 3)}, minmax(0, 1fr))` }}>
        {shown.map((l) => field(l, true))}
      </div>
    );
  }

  // One language at a time: this field's own tab, else the dialog's or section's language, else the first
  const want = ctx ? peek ?? ctx.lang : localLang;
  const active = shown.includes(want) ? want : shown[0];
  // resting on a tab shows this field's whole text in that language, to check the wording without switching
  const tip = (l: Lang) => {
    const text = v[l]?.trim();
    return (
      <>
        <div className="hover-tip-head">{langInfo(l).name}</div>
        {text ? <div className="hover-tip-text">{text}</div> : <div className="hover-tip-text" style={{ opacity: 0.7, fontStyle: 'italic' }}>{t('(empty)')}</div>}
      </>
    );
  };
  return (
    <div className="l10n single">
      <div className="l10n-tabs" role="tablist">
        {shown.map((l) => (
          <HoverTip key={l} content={tip(l)} lang={langInfo(l).htmlLang}>
            <button type="button" role="tab" aria-selected={active === l} className={active === l ? 'on' : ''}
              aria-label={langInfo(l).name} onClick={() => (ctx ? setPeek(l) : setLocalLang(l))}>
              {langInfo(l).short}
              {filledLangs.length > 0 && !covered(filledLangs, l) && <span className="l10n-gap" aria-hidden="true" />}
            </button>
          </HoverTip>
        ))}
      </div>
      {field(active, false)}
    </div>
  );
}

/** A label in the UI language, followed by the church's next language when it differs. */
export function Bi({ v, className }: { v: L10n | null | undefined; className?: string }) {
  const { lang } = useI18n();
  const church = useContentLangs();
  if (!v) return null;
  const first = pickL10n(v, lang);
  const otherLang = church.find((l) => l !== lang && !(isChinese(l) && isChinese(lang)));
  const second = otherLang ? pickL10n({ [otherLang]: v[otherLang] }, otherLang) : '';
  return (
    <span className={className}>
      {first}
      {second && second !== first && <span className="zh muted" lang={langInfo(otherLang!).htmlLang} style={{ marginLeft: 6, fontWeight: 400 }}>{second}</span>}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="search">
      <Icon name="search" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('Search…')} aria-label={placeholder ?? t('Search…')} autoFocus={autoFocus} />
    </div>
  );
}

/** Debounce a changing value (e.g. a search box). */
export function useDebounced<T>(v: T, ms = 250) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

/** window.confirm wrapper so it can be swapped for a modal later. */
export const confirmAction = (msg: string) => window.confirm(msg);

/** Keep a stable ref to the latest value (for event handlers in effects). */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

// ---------------------------------------------------------------- formatting

export function fmtDate(d: string | null | undefined, lang: Lang, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  const dt = new Date(d + 'T00:00:00');
  const locale = lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : lang === 'en' ? 'en-GB' : langInfo(lang).htmlLang;
  return dt.toLocaleDateString(locale, opts);
}

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const addDays = (d: string, n: number) => {
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

/** Next Sunday on or after a date. */
export const nextSunday = (from = today()) => {
  const dt = new Date(from + 'T00:00:00');
  return addDays(from, (7 - dt.getDay()) % 7);
};
