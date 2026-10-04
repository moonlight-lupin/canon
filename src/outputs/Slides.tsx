// Full-screen projector view with keyboard control, overview grid and a synced presenter window.
import { Fragment, createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg, useLatest } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { L10n, Lang, RenderedService } from '../types-client.ts';
import { blockImageUrl, blockQrUrl, type SlideTheme } from '../../shared/presentation.ts';
import type { RenderedSlideBlock } from '../../shared/render-types.ts';
import { Bi, LANG_ATTR, biParts, biText, dateParts, hasAny, langOptions, langsFor, modeFor, speaker, timeRange, type LangMode } from './content.tsx';
import { logoUrl, useLogo } from '../components/brand.tsx';
import { postureL10n } from '../../shared/labels.ts';
import { buildSlides, mapSlideIndex, slideText, type SlideDef, type SlideLine, type SlideType } from './slideModel.ts';
import { LOW_FONT_WARN, MIN_FONT, deckFit, largestFitting, scaledCap } from './deckFit.ts';
import './outputs.css';

const W = 1920;
const H = 1080;
type Blank = 'none' | 'black' | 'white';
interface SyncState {
  idx: number;
  blank: Blank;
  mode: LangMode;
  split: boolean;
  /** slide theme chosen in the bar for this session (null = the service's theme) */
  theme: number | null;
}

/**
 * The slide theme every <Stage> below uses: `id` becomes data-theme on the stage (the theme's CSS is scoped to
 * `.slide-stage[data-theme="<id>"]`), `sig` changes whenever that CSS changes so auto-fit measures again.
 */
export const SlideThemeCtx = createContext<{ id: string; sig: string }>({ id: '', sig: '' });

/** Short hash of a string (theme CSS → auto-fit cache key). */
export function sigOf(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- stage & auto-fit

/** A 1920×1080 logical stage scaled to the width of its container, carrying the slide theme. */
export function Stage({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const theme = useContext(SlideThemeCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`sl-stage slide-stage ${className ?? ''}`} data-theme={theme.id || undefined} onClick={onClick}>
      <div className="sl-stage-inner" style={{ width: W, height: H, transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

const MAX_FONT: Record<SlideDef['type'], number> = { title: 112, section: 112, sermon: 104, item: 100, lyrics: 80, scripture: 64, text: 68, blocks: 56 };
const fitCache = new Map<string, number>();

/** Does the content fit its box at the font size it has now? */
const fitsBox = (box: HTMLElement, fit: HTMLElement) => fit.scrollHeight <= box.clientHeight + 1 && fit.scrollWidth <= box.clientWidth + 1;

/**
 * Largest font size (binary search) at which the content fits its box. The theme's --slide-scale scales the maximum.
 * With a deck size (`deck`) the slide uses it as is (it was measured to fit every slide of the deck); `skip` leaves
 * the size alone (the deck is still being measured, or this face is the measuring copy).
 */
function useAutoFit(key: string, maxBase: number, deck: number | null = null, skip = false) {
  const boxRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const fit = fitRef.current;
    if (!box || !fit || skip) return;
    const scale = parseFloat(getComputedStyle(box).getPropertyValue('--slide-scale'));
    const max = scaledCap(maxBase, scale);
    const ok = (size: number) => {
      fit.style.fontSize = `${size}px`;
      return fitsBox(box, fit);
    };
    if (deck != null) {
      // the deck size fits every slide; shrinking is only a safety net (it never lets the words overflow)
      if (!ok(deck)) fit.style.fontSize = `${largestFitting(ok, MIN_FONT, deck)}px`;
      return;
    }
    // A cached size is reused only while it still fits (styles or fonts may have changed).
    const cached = fitCache.get(key);
    if (cached && ok(cached) && (cached >= max || !ok(cached + 1))) {
      fit.style.fontSize = `${cached}px`;
      return;
    }
    let best = max;
    if (!ok(max)) {
      let lo = 14;
      let hi = max;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ok(mid)) lo = mid;
        else hi = mid;
      }
      best = lo;
    }
    fit.style.fontSize = `${best}px`;
    fitCache.set(key, best);
  }, [key, maxBase, deck, skip]);
  return { boxRef, fitRef };
}

// ---------------------------------------------------------------- one text size for the whole deck

/** Sizes shared by every slide of a deck: hymn / scripture / liturgy words, and service title / section titles. */
export interface DeckSizes {
  body: number | null;
  title: number | null;
}
type FitGroup = keyof DeckSizes;
/** Which deck size a slide uses (null = it fits on its own: sermon, item title and QR slides). */
export const fitGroup = (t: SlideType): FitGroup | null =>
  t === 'lyrics' || t === 'scripture' || t === 'text' ? 'body' : t === 'title' || t === 'section' ? 'title' : null;
const GROUP_MAX: Record<FitGroup, number> = { body: 80, title: 112 };

/** The deck sizes for the slides below; `pending` while they are measured. No provider = each slide fits on its own. */
export const DeckSizeCtx = createContext<{ pending: boolean; sizes: DeckSizes } | null>(null);

const deckCache = new Map<string, DeckSizes>();

/** Measure the hidden copies: per group, the largest size at which every slide fits (capped by the theme's size). */
function measureDeck(root: HTMLElement): DeckSizes {
  const stage = root.querySelector<HTMLElement>('.slide-stage');
  const scale = stage ? parseFloat(getComputedStyle(stage).getPropertyValue('--slide-scale')) : 1;
  const out: DeckSizes = { body: null, title: null };
  for (const g of ['body', 'title'] as FitGroup[]) {
    const faces = [...root.querySelectorAll<HTMLElement>(`.sl-measure-face[data-group="${g}"]`)]
      .map((f) => ({ key: f.dataset.key ?? '', box: f.querySelector<HTMLElement>('.sl-box'), fit: f.querySelector<HTMLElement>('.sl-fit') }))
      .filter((f): f is { key: string; box: HTMLElement; fit: HTMLElement } => !!f.box && !!f.fit);
    if (!faces.length) continue;
    const { size, binding } = deckFit(faces, (f, n) => {
      f.fit.style.fontSize = `${n}px`;
      return fitsBox(f.box, f.fit);
    }, scaledCap(GROUP_MAX[g], scale), MIN_FONT);
    out[g] = size;
    if (g === 'body' && size < LOW_FONT_WARN) {
      console.warn(`[slides] One text size for every slide: ${size}px is small for a projector; the longest slide is ${faces[binding]?.key ?? '?'}. Lower "Lines per slide" in the slide template, or turn off "Same text size on every slide".`);
    }
  }
  return out;
}

/** Hidden full-size copies of the deck's word and title slides, measured once (and again when fonts or pictures load). */
function DeckMeasurer({ slides, langs, split, r, themeId, onSizes }: {
  slides: SlideDef[];
  langs: Lang[];
  split: boolean;
  r: RenderedService;
  themeId: string;
  onSizes: (sizes: DeckSizes, done: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    const waiting = [...root.querySelectorAll('img')].filter((i) => !i.complete);
    let left = waiting.length;
    let fontsReady = typeof document === 'undefined' || !document.fonts || document.fonts.status === 'loaded';
    const run = () => {
      if (live) onSizes(measureDeck(root), fontsReady && left === 0);
    };
    const imgDone = () => {
      left--;
      run();
    };
    waiting.forEach((i) => {
      i.addEventListener('load', imgDone, { once: true });
      i.addEventListener('error', imgDone, { once: true });
    });
    if (!fontsReady) {
      document.fonts.ready.then(() => {
        fontsReady = true;
        run();
      });
    }
    run();
    return () => {
      live = false;
      waiting.forEach((i) => {
        i.removeEventListener('load', imgDone);
        i.removeEventListener('error', imgDone);
      });
    };
  }, [onSizes]);
  return (
    <div ref={ref} className="sl-measure" aria-hidden="true">
      <div className="sl-stage slide-stage" data-theme={themeId || undefined}>
        {slides.map((s) => {
          const g = fitGroup(s.type);
          return g ? (
            <div key={s.key} className="sl-stage-inner sl-measure-face" data-group={g} data-key={s.key}>
              <SlideFace s={s} langs={langs} split={split} r={r} measuring />
            </div>
          ) : null;
        })}
      </div>
    </div>
  );
}

/**
 * One text size for the deck (the theme's "Same text size on every slide"): returns the context value for
 * <DeckSizeCtx.Provider> and the hidden measuring element to render inside the theme provider (null when done).
 * Measured again when the theme CSS, the languages, the layout or the slides change; cached by that signature.
 */
export function useDeckSizes({ slides, langs, split, r, theme, enabled }: {
  slides: SlideDef[];
  langs: Lang[];
  split: boolean;
  r: RenderedService | null | undefined;
  theme: { id: string; sig: string };
  enabled: boolean;
}) {
  const logoVersion = useLogo();
  const sig = useMemo(() => {
    if (!enabled || !r) return '';
    const content = slides.filter((s) => fitGroup(s.type)).map((s) => [s.type, s.lines, s.verses, s.big, s.sub, s.meta]);
    return sigOf(JSON.stringify([theme.id, theme.sig, langs, split, r.date, r.start_time, r.end_time, r.has_logo ? logoVersion : 0, content]));
  }, [enabled, r, slides, langs, split, theme.id, theme.sig, logoVersion]);
  const [st, setSt] = useState<{ sig: string; sizes: DeckSizes; done: boolean } | null>(null);
  const cached = sig ? deckCache.get(sig) : undefined;
  const sizes = cached ?? (st && st.sig === sig ? st.sizes : null);
  const done = !!cached || (!!st && st.sig === sig && st.done);
  const onSizes = useCallback(
    (sz: DeckSizes, d: boolean) => {
      if (d) deckCache.set(sig, sz);
      setSt((prev) => (prev && prev.sig === sig && prev.done === d && prev.sizes.body === sz.body && prev.sizes.title === sz.title ? prev : { sig, sizes: sz, done: d }));
    },
    [sig],
  );
  const ctx = useMemo(() => (enabled && r ? { pending: !sizes, sizes: sizes ?? { body: null, title: null } } : null), [enabled, r, sizes]);
  const measurer = enabled && r && !done ? <DeckMeasurer key={sig} slides={slides} langs={langs} split={split} r={r} themeId={theme.id} onSizes={onSizes} /> : null;
  return { ctx, measurer };
}

/**
 * Lines of one language. Speaker labels (Leader / People) show when the item has more than one speaker: on the first
 * line of each speaker, and again at the top of a slide that continues a line or a speaker from the slide before.
 */
function Lines({ lines, lang, speakers }: { lines: SlideLine[]; lang: Lang; speakers: boolean }) {
  let prev: SlideLine['who'] | undefined;
  return (
    <>
      {lines.map((ln, i) => {
        const show = speakers && ln.who && ln.who !== prev;
        prev = ln.who;
        return (
          <div key={i} className={`sl-line${ln.who === 'C' || ln.who === 'A' ? ' strong' : ''}${ln.cont ? ' cont' : ''}`}>
            {show && <span className="sl-who slide-who">{speaker(ln.who!, lang)}</span>}
            {ln.text}
          </div>
        );
      })}
    </>
  );
}

/**
 * One slide. Besides its layout classes (sl-*), it carries the stable hooks a slide theme's CSS can target:
 * .slide, .kind-<kind>, .slide-section, .slide-heading, .slide-title, .slide-sub, .slide-lyrics, .slide-scripture,
 * .slide-text, .slide-stanza-label, .slide-verse-num, .slide-who, .lang-<code>, .slide-footer, .slide-ref,
 * .slide-church, .slide-number, .slide-blocks, .slide-block, .slide-qr, .slide-block-caption, .slide-block-text
 * (see SLIDE_CLASS_HOOKS in shared/presentation.ts).
 */
export function SlideFace({ s, langs, split, r, num, measuring }: { s: SlideDef; langs: Lang[]; split: boolean; r: RenderedService; num?: number; measuring?: boolean }) {
  const logoVersion = useLogo();
  const theme = useContext(SlideThemeCtx);
  const deck = useContext(DeckSizeCtx);
  const group = fitGroup(s.type);
  const deckPx = deck && group ? deck.sizes[group] : null;
  const logo = s.type === 'title' && r.has_logo && logoVersion ? logoUrl(logoVersion) : null;
  const key = `${JSON.stringify(s)}|${langs.join()}|${split}|${logo ?? ''}|${theme.id}:${theme.sig}`;
  const { boxRef, fitRef } = useAutoFit(key, MAX_FONT[s.type], deckPx, !!measuring || (!!deck && !!group && deck.pending));
  const big = (v: L10n | undefined, cls: string) =>
    biParts(v, langs).map((p) => (
      <div key={p.lang} className={`${cls} lang-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</div>
    ));

  let body: ReactNode;
  if (s.lines || s.verses) {
    const present = langs.filter((l) => (s.lines?.[l]?.length ?? 0) + (s.verses?.[l]?.length ?? 0) > 0);
    const hook = s.verses ? 'slide-scripture' : s.type === 'lyrics' ? 'slide-lyrics' : 'slide-text';
    body = (
      <div
        className={`sl-langs ${hook} ${split && present.length > 1 ? 'sl-side' : 'sl-stacked'}${s.verses ? ' verses' : ''}${s.refrain ? ' refrain' : ''}${present.length > 2 ? ' three' : ''}`}
        style={split && present.length > 1 ? { gridTemplateColumns: `repeat(${present.length}, minmax(0, 1fr))` } : undefined}
      >
        {present.map((l, i) => (
          <Fragment key={l}>
            {i > 0 && !split && <div className="sl-divider" />}
            <div className={`sl-lang lang-${l}`} lang={LANG_ATTR[l]}>
              {s.lines?.[l] && <Lines lines={s.lines[l]!} lang={l} speakers={!!s.speakers} />}
              {s.verses?.[l] && (
                <p className="sl-verses">
                  {s.verses[l]!.map((v, vi) => (
                    <Fragment key={vi}>
                      {v.n && <sup className="slide-verse-num">{v.n}</sup>}
                      {v.text}{' '}
                    </Fragment>
                  ))}
                </p>
              )}
            </div>
          </Fragment>
        ))}
      </div>
    );
  } else if (s.blocks) {
    body = (
      <div className="sl-blocks-wrap">
        {s.big && big(s.big, 'sl-big sl-blocks-title slide-title')}
        {/* codes and pictures side by side; notes underneath, across the slide */}
        {s.blocks.some((b) => b.kind !== 'text') && (
          <div className={`sl-blocks slide-blocks n${s.blocks.filter((b) => b.kind !== 'text').length}`}>
            {s.blocks.filter((b) => b.kind !== 'text').map((b) => <SlideBlock key={b.id} b={b} langs={langs} />)}
          </div>
        )}
        {s.blocks.filter((b) => b.kind === 'text').map((b) => <SlideBlock key={b.id} b={b} langs={langs} />)}
      </div>
    );
  } else if (s.type === 'title') {
    const d = dateParts(r.date, langs);
    body = (
      <div className="sl-titlebox">
        {logo && <img className="sl-logo" src={logo} alt="" />}
        {big(s.big, 'sl-big slide-title')}
        <div className="sl-rule" />
        {langs.map((l) => <div key={l} className={`sl-meta slide-meta lang-${l}`} lang={LANG_ATTR[l]}>{d[l]}</div>)}
        <div className="sl-meta slide-meta">{timeRange(r)}</div>
        {s.sub && big(s.sub, 'sl-sub slide-sub')}
      </div>
    );
  } else {
    body = (
      <div className="sl-titlebox">
        {big(s.big, 'sl-big slide-title')}
        {s.type !== 'item' && <div className="sl-rule" />}
        {s.sub && big(s.sub, 'sl-sub slide-sub')}
        {s.meta?.map((m, i) => <div key={i} className="sl-meta slide-meta">{m}</div>)}
      </div>
    );
  }

  const cls = `sl-face slide t-${s.type}${s.kind ? ` kind-${s.kind}` : ''}${s.type === 'section' ? ' slide-section' : ''}${r.season.color ? ' seasonal' : ''}`;
  return (
    <div className={cls} style={r.season.color ? ({ '--s-season': r.season.color } as CSSProperties) : undefined}>
      <div className="sl-head slide-heading">
        {s.heading && <Bi v={s.heading} langs={langs} sep="  ·  " />}
        {s.label && <span className="sl-label slide-stanza-label">{biText(s.label, langs, ' ')}</span>}
        {s.cont && s.type === 'lyrics' && <span className="sl-cont slide-cont" aria-label="continued">…</span>}
        {s.posture && <span className="sl-posture slide-posture">{biText(postureL10n(s.posture, langs), langs, ' · ')}</span>}
      </div>
      <div className="sl-box" ref={boxRef}>
        <div className="sl-fit" ref={fitRef}>{body}</div>
      </div>
      <div className="sl-foot slide-footer">
        <span className="slide-church"><Bi v={r.church.name} langs={langs.slice(0, 1)} /></span>
        <span className="slide-ref">{s.footer && biParts(s.footer, langs).map((p) => <span key={p.lang} className={`lang-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</span>)}</span>
        {num != null && <span className="slide-number">{num}</span>}
      </div>
    </div>
  );
}

/**
 * Caption / note lines in the slide languages, one language after the other; a line that is the same in two
 * languages (a UEN, a phone number, a web address) is shown once.
 */
function blockLines(v: L10n | undefined, langs: Lang[]): { lang: Lang; text: string }[] {
  const seen = new Set<string>();
  const out: { lang: Lang; text: string }[] = [];
  const from = langs.some((l) => v?.[l]?.trim()) ? langs : biParts(v, langs).map((p) => p.lang);
  for (const l of from) {
    for (const raw of (v?.[l] ?? '').split(/\r?\n/)) {
      const text = raw.trim();
      if (text && !seen.has(text)) {
        seen.add(text);
        out.push({ lang: l, text });
      }
    }
  }
  return out;
}

/** One QR code / picture (on a white card, so it scans on dark themes) or note, with its caption. */
function SlideBlock({ b, langs }: { b: RenderedSlideBlock; langs: Lang[] }) {
  const lines = (v: L10n | undefined, cls: string) =>
    blockLines(v, langs).map((p, i) => <div key={i} className={`${cls} lang-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</div>);
  return (
    <div className={`sl-block slide-block block-${b.kind}`}>
      {b.kind === 'qr' && <div className="sl-qr slide-qr"><img src={blockQrUrl(b.id, b.v)} alt="" /></div>}
      {b.kind === 'image' && b.has_image && <div className="sl-qr slide-qr"><img src={blockImageUrl(b.id, b.v)} alt="" /></div>}
      {b.kind === 'text' && <div className={`sl-block-text slide-block-text${b.bold ? ' b' : ''}`}>{lines(b.text, 'sl-block-line')}</div>}
      {b.kind !== 'text' && hasAny(b.caption) && <div className="sl-block-cap slide-block-caption">{lines(b.caption, 'sl-block-line')}</div>}
    </div>
  );
}

export function SlideOrBlank({ s, blank, ...rest }: { s: SlideDef | undefined; blank: Blank; langs: Lang[]; split: boolean; r: RenderedService; num?: number }) {
  if (blank === 'black') return <div className="sl-black" />;
  if (blank === 'white' || !s) return <div className="sl-face slide sl-clear" />;
  return <SlideFace s={s} {...rest} />;
}

// ---------------------------------------------------------------- screen

export default function Slides() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const presenter = sp.get('presenter') === '1';
  const { t, lt } = useI18n();
  const { data: r, error } = useApi<RenderedService>(`/services/${id}/render`);
  const { data: themes, error: themesError } = useApi<SlideTheme[]>('/slide-themes');

  const [state, setState] = useState<SyncState>({ idx: 0, blank: 'none', mode: 'both', split: false, theme: null });
  const [modeInit, setModeInit] = useState(false);
  const [overview, setOverview] = useState(false);

  // Slide theme: the one picked in the bar (this session only), else the service's (service → church default → Ink).
  const themeId = state.theme ?? r?.slide_theme_id ?? null;
  const theme = themes?.find((x) => x.id === themeId);
  const [css, setCss] = useState<{ id: number; css: string } | null>(null);
  useEffect(() => {
    if (themeId == null) return;
    let live = true;
    fetch(`/api/slide-themes/${themeId}/css`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : ''))
      .catch(() => '')
      .then((text) => live && setCss({ id: themeId, css: text }));
    return () => {
      live = false;
    };
  }, [themeId, theme?.updated_at]);
  const themeCss = css && css.id === themeId ? css.css : null;
  const themeCtx = useMemo(() => ({ id: themeId ? String(themeId) : '', sig: sigOf(themeCss ?? '') }), [themeId, themeCss]);

  useEffect(() => {
    if (r && !modeInit) {
      setModeInit(true);
      setState((s) => ({ ...s, mode: modeFor(r.languages) }));
    }
  }, [r, modeInit]);

  const langs = useMemo(() => langsFor(state.mode, r?.languages ?? ['en']), [state.mode, r]);
  // lines per slide come from the theme; the limit depends on how many languages are shown
  const vars = theme?.vars;
  const slides = useMemo(() => (r ? buildSlides(r, langs, vars) : []), [r, langs, vars]);
  const deck = useDeckSizes({ slides, langs, split: state.split, r, theme: themeCtx, enabled: vars?.uniform_size ?? true });
  const n = slides.length;
  const idx = Math.min(state.idx, Math.max(0, n - 1));

  // ---- sync between the audience and presenter windows
  const chRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useLatest(state);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(`canon-slides-${id}`);
    chRef.current = ch;
    ch.onmessage = (e: MessageEvent) => {
      const m = e.data as { t: string } & Partial<SyncState>;
      if (m?.t === 'state') {
        setModeInit(true);
        setState({ idx: m.idx ?? 0, blank: m.blank ?? 'none', mode: m.mode ?? 'both', split: !!m.split, theme: m.theme ?? null });
      } else if (m?.t === 'hello') ch.postMessage({ t: 'state', ...stateRef.current });
    };
    ch.postMessage({ t: 'hello' });
    return () => {
      ch.close();
      chRef.current = null;
    };
  }, [id, stateRef]);

  const update = useCallback(
    (patch: Partial<SyncState>) => {
      const next = { ...stateRef.current, ...patch };
      stateRef.current = next; // visible to rapid key presses before the next render
      setState(next);
      chRef.current?.postMessage({ t: 'state', ...next });
    },
    [stateRef],
  );
  const go = useCallback((i: number) => update({ idx: Math.max(0, Math.min(n - 1, i)), blank: 'none' }), [update, n]);
  /** Another language mode re-chunks the slides (more lines fit with one language): stay on the same words. */
  const setMode = (m: LangMode) => {
    if (!r || m === state.mode) return;
    update({ mode: m, idx: mapSlideIndex(slides, idx, buildSlides(r, langsFor(m, r.languages), vars)) });
  };

  // ---- keyboard
  const [digits, setDigitsState] = useState('');
  const digitsRef = useRef('');
  const setDigits = useCallback((d: string) => {
    digitsRef.current = d;
    setDigitsState(d);
  }, []);
  const keyState = useLatest({ n, overview });
  useEffect(() => {
    let clear: ReturnType<typeof setTimeout> | undefined;
    const onKey = (e: KeyboardEvent) => {
      const tg = e.target;
      if (tg instanceof Element && tg.closest('input, select, textarea, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keyState.current;
      const cur = Math.min(stateRef.current.idx, Math.max(0, k.n - 1));
      const blank = stateRef.current.blank;
      const typed = digitsRef.current;
      const key = e.key;
      let handled = true;
      if (/^\d$/.test(key)) {
        setDigits((typed + key).slice(-4));
        clearTimeout(clear);
        clear = setTimeout(() => setDigits(''), 3000);
      } else if (key === 'Enter' && typed) {
        go(Number(typed) - 1);
        setDigits('');
        setOverview(false);
      } else if (key === 'ArrowRight' || key === ' ' || key === 'PageDown' || key === 'ArrowDown' || key === 'Enter') {
        go(cur + 1);
      } else if (key === 'ArrowLeft' || key === 'PageUp' || key === 'ArrowUp' || key === 'Backspace') {
        go(cur - 1);
      } else if (key === 'Home') go(0);
      else if (key === 'End') go(k.n - 1);
      else if (key === 'b' || key === 'B' || key === '.') update({ blank: blank === 'black' ? 'none' : 'black' });
      else if (key === 'w' || key === 'W' || key === ',') update({ blank: blank === 'white' ? 'none' : 'white' });
      else if (key === 'f' || key === 'F') toggleFullscreen();
      else if (key === 'o' || key === 'O') setOverview((o) => !o);
      else if (key === 'Escape') {
        if (k.overview) setOverview(false);
        else if (typed) setDigits('');
        else handled = false;
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(clear);
    };
  }, [go, update, keyState, stateRef, setDigits]);

  // ---- auto-hiding bar (audience view)
  const [barOn, setBarOn] = useState(true);
  useEffect(() => {
    if (presenter) return;
    let tm = setTimeout(() => setBarOn(false), 2000);
    const move = () => {
      setBarOn(true);
      clearTimeout(tm);
      tm = setTimeout(() => setBarOn(false), 2000);
    };
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      clearTimeout(tm);
    };
  }, [presenter]);

  useEffect(() => {
    if (r) document.title = `${biText(r.title, ['en'])} — ${presenter ? t('Presenter') : t('Slides')}`;
  }, [r, presenter, t]);

  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!r || (themeId != null && themeCss == null) || (!themes && !themesError)) return <Loading />;

  const cur = slides[idx];
  const next = slides[idx + 1];
  const curItem = cur?.itemId ? r.items.find((i) => i.id === cur.itemId) : undefined;
  const face = (s: SlideDef | undefined, blank: Blank = 'none') => (
    <SlideOrBlank s={s} blank={blank} langs={langs} split={state.split} r={r} num={s ? slides.indexOf(s) + 1 : undefined} />
  );
  const openPresenter = () => window.open(`/services/${id}/slides?presenter=1`, `canon-presenter-${id}`, 'width=1280,height=800');

  const controls = (
    <>
      <button className="btn sm icon" onClick={() => go(idx - 1)} aria-label={t('Previous slide')} title={t('Previous slide')}><Icon name="chevronLeft" /></button>
      <span className="sl-count">{idx + 1} / {n}</span>
      <button className="btn sm icon" onClick={() => go(idx + 1)} aria-label={t('Next slide')} title={t('Next slide')}><Icon name="chevronRight" /></button>
      <button className={`btn sm${state.blank === 'black' ? ' primary' : ''}`} onClick={() => update({ blank: state.blank === 'black' ? 'none' : 'black' })} title="B">{t('Black screen')}</button>
      <button className={`btn sm${state.blank === 'white' ? ' primary' : ''}`} onClick={() => update({ blank: state.blank === 'white' ? 'none' : 'white' })} title="W">{t('Clear text')}</button>
      <button className="btn sm" onClick={() => setOverview(true)} title="O">{t('Overview')}</button>
    </>
  );
  const options = (
    <>
      {r.languages.length > 1 && <Seg<LangMode> value={state.mode} onChange={setMode} options={langOptions(r.languages, t)} />}
      {langs.length > 1 && (
        <Seg<'stacked' | 'side'> value={state.split ? 'side' : 'stacked'} onChange={(v) => update({ split: v === 'side' })} options={[{ value: 'stacked', label: t('Stacked') }, { value: 'side', label: t('Side by side') }]} />
      )}
      {themes && themes.length > 1 && (
        <label className="out-ctl sl-theme-pick" title={t('Slide theme for this session only')}>
          <span>{t('Theme')}</span>
          <select value={themeId ?? ''} onChange={(e) => update({ theme: Number(e.target.value) || null })}>
            {themes.map((x) => <option key={x.id} value={x.id}>{lt(x.name)}{x.id === r.slide_theme_id ? ' ✓' : ''}</option>)}
          </select>
        </label>
      )}
    </>
  );

  const overviewGrid = overview && (
    <div className="sl-overview" onClick={() => setOverview(false)}>
      <div className="sl-ov-grid" onClick={(e) => e.stopPropagation()}>
        {slides.map((s, i) => (
          <button key={s.key} className={`sl-ov-item${i === idx ? ' on' : ''}`} onClick={() => { go(i); setOverview(false); }}>
            <Stage>{face(s)}</Stage>
            <span className="sl-ov-n">{i + 1}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const themeStyle = <style>{themeCss ?? ''}</style>;
  if (presenter) {
    return (
      <SlideThemeCtx.Provider value={themeCtx}>
      <DeckSizeCtx.Provider value={deck.ctx}>
      {themeStyle}
      {deck.measurer}
      <PresenterView
        r={r}
        nextFace={next ? face(next) : null}
        blank={state.blank}
        curFaceBlank={face(cur, state.blank)}
        item={curItem}
        idx={idx}
        n={n}
        controls={controls}
        options={options}
        slides={slides}
        langs={langs}
        go={go}
        overview={overviewGrid}
        digits={digits}
      />
      </DeckSizeCtx.Provider>
      </SlideThemeCtx.Provider>
    );
  }

  return (
    <SlideThemeCtx.Provider value={themeCtx}>
    <DeckSizeCtx.Provider value={deck.ctx}>
    {themeStyle}
    {deck.measurer}
    <div className={`sl-root${barOn ? '' : ' idle'}`} style={{ '--sl-root-bg': theme?.vars.bg ?? '#000' } as CSSProperties}>
      <div className="sl-main" onClick={() => !overview && go(idx + 1)}>
        <Stage className="sl-main-stage">
          <div key={`${cur?.key}|${state.blank}`} className="sl-fade">{face(cur, state.blank)}</div>
        </Stage>
      </div>
      {digits && <div className="sl-digits">{digits}</div>}
      <div className={`sl-bar${barOn ? '' : ' hidden'}`} onClick={(e) => e.stopPropagation()}>
        <Link to={`/services/${id}`} className="btn sm ghost" title={t('Back')}><Icon name="chevronLeft" /></Link>
        {controls}
        <div className="sl-bar-info">
          <div className="sl-bar-item">{curItem ? <Bi v={curItem.title} langs={langs} /> : biText(r.title, langs)}</div>
          <div className="sl-bar-next">{next ? `${t('Next slide')}: ${slideText(next, langs)}` : t('End of slides')}</div>
        </div>
        {options}
        <button className="btn sm" onClick={toggleFullscreen} title="F"><Icon name="monitor" />{t('Full screen')}</button>
        <button className="btn sm primary" onClick={openPresenter}>{t('Open presenter window')}</button>
      </div>
      {overviewGrid}
    </div>
    </DeckSizeCtx.Provider>
    </SlideThemeCtx.Provider>
  );
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);
  return now;
}

function PresenterView({
  r, curFaceBlank, nextFace, blank, item, idx, n, controls, options, slides, langs, go, overview, digits,
}: {
  r: RenderedService;
  nextFace: ReactNode;
  blank: Blank;
  curFaceBlank: ReactNode;
  item: RenderedService['items'][number] | undefined;
  idx: number;
  n: number;
  controls: ReactNode;
  options: ReactNode;
  slides: SlideDef[];
  langs: Lang[];
  go: (i: number) => void;
  overview: ReactNode;
  digits: string;
}) {
  const { t } = useI18n();
  const now = useClock();
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [idx]);
  return (
    <div className="sp-root">
      <div className="sp-top">
        <div className="sp-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {timeRange(r)}</span></div>
        <div className="row">{options}</div>
        <div className="sp-clock">{now.toLocaleTimeString('en-GB')}</div>
      </div>
      <div className="sp-main">
        <div className="sp-cur">
          <div className="sp-label">{t('Current slide')} {idx + 1} / {n}{blank !== 'none' && <span className="badge warn" style={{ marginLeft: 8 }}>{blank === 'black' ? t('Black screen') : t('Clear text')}</span>}</div>
          <Stage onClick={() => go(idx + 1)}>{curFaceBlank}</Stage>
          <div className="row sp-controls">{controls}{digits && <span className="kbd">{digits}</span>}</div>
        </div>
        <div className="sp-side">
          <div className="sp-label">{t('Next slide')}</div>
          {nextFace ? <Stage>{nextFace}</Stage> : <div className="sp-end">{t('End of slides')}</div>}
          {item && (
            <div className="sp-item">
              <div className="sp-item-time">{item.start}–{item.end} · {item.duration_min} {t('min')}</div>
              <div className="sp-item-title"><Bi v={item.title} langs={langs} /></div>
              {biText(item.subtitle, langs) && <div className="sp-item-sub"><Bi v={item.subtitle} langs={langs} sep="  ·  " /></div>}
              {(item.leader || item.role_name) && (
                <div className="sp-item-who">{item.role_name && <Bi v={item.role_name} langs={langs} />}{item.role_name && item.leader && ': '}{item.leader}</div>
              )}
              {item.notes && <div className="sp-notes">{item.notes}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="sp-strip" ref={stripRef}>
        {slides.map((s, i) => (
          <button key={s.key} className={`sp-strip-item${i === idx ? ' on' : ''}`} onClick={() => go(i)} title={slideText(s, langs)}>
            <span className="n">{i + 1}</span>
            <span className="txt">{slideText(s, langs, 40)}</span>
          </button>
        ))}
      </div>
      {overview}
    </div>
  );
}
