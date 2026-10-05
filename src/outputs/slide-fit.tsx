// Slides: the stage, and fitting text to it (one text size per deck).
import { createContext, useContext, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ASPECT_WIDTH, type SlideAspect } from '../../shared/slide-theme.ts';
import type { LangMode } from './content.tsx';
import type { SlideDef, SlideType } from './slideModel.ts';
import { MIN_FONT, largestFitting, scaledCap } from './deckFit.ts';
import './outputs.css';

export const H = 1080;

export type Blank = 'none' | 'black' | 'white';

/** Logical stage width for a screen shape (16:9 = 1920, 4:3 = 1440); the height is always 1080. */
export const stageWidth = (aspect?: SlideAspect) => ASPECT_WIDTH[aspect ?? '16:9'] ?? 1920;

export interface SyncState {
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
export const SlideThemeCtx = createContext<{ id: string; sig: string; aspect?: SlideAspect }>({ id: '', sig: '' });

/** Short hash of a string (theme CSS → auto-fit cache key). */
export function sigOf(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ---------------------------------------------------------------- stage & auto-fit

/** A 1920×1080 (16:9) or 1440×1080 (4:3) logical stage scaled to the width of its container, carrying the slide theme. */
export function Stage({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const theme = useContext(SlideThemeCtx);
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const W = stageWidth(theme.aspect);
  useLayoutEffect(() => {
    const el = ref.current!;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);
  return (
    <div ref={ref} className={`sl-stage slide-stage ${className ?? ''}`} data-theme={theme.id || undefined} data-aspect={theme.aspect ?? '16:9'} onClick={onClick}
      style={{ aspectRatio: `${W} / ${H}`, ['--stage-ratio' as string]: W / H } as CSSProperties}>
      <div className="sl-stage-inner" style={{ width: W, height: H, transform: `scale(${scale})` }}>{children}</div>
    </div>
  );
}

export const MAX_FONT: Record<SlideDef['type'], number> = { title: 112, section: 112, sermon: 104, item: 100, lyrics: 80, scripture: 64, text: 68, blocks: 56 };

export const fitCache = new Map<string, number>();

/** Does the content fit its box at the font size it has now? */
export const fitsBox = (box: HTMLElement, fit: HTMLElement) => fit.scrollHeight <= box.clientHeight + 1 && fit.scrollWidth <= box.clientWidth + 1;

/**
 * Largest font size (binary search) at which the content fits its box. The theme's --slide-scale scales the maximum.
 * With a deck size (`deck`) the slide uses it as is (it was measured to fit every slide of the deck); `skip` leaves
 * the size alone (the deck is still being measured, or this face is the measuring copy).
 */
export function useAutoFit(key: string, maxBase: number, deck: number | null = null, skip = false) {
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

export type FitGroup = keyof DeckSizes;

/** Which deck size a slide uses (null = it fits on its own: sermon, item title and QR slides). */
export const fitGroup = (t: SlideType): FitGroup | null =>
  t === 'lyrics' || t === 'scripture' || t === 'text' ? 'body' : t === 'title' || t === 'section' ? 'title' : null;

export const GROUP_MAX: Record<FitGroup, number> = { body: 80, title: 112 };

/** The deck sizes for the slides below; `pending` while they are measured. No provider = each slide fits on its own. */
export const DeckSizeCtx = createContext<{ pending: boolean; sizes: DeckSizes } | null>(null);

export const deckCache = new Map<string, DeckSizes>();
