// Slides: what one slide shows, and measuring a whole deck off-screen to choose its text size.
import { Fragment, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { L10n, Lang, RenderedService } from '../types-client.ts';
import { backgroundUrl, blockImageUrl, blockQrSrc } from '../../shared/presentation.ts';
import type { SlideAspect } from '../../shared/slide-theme.ts';
import type { RenderedSlideBlock } from '../../shared/render-types.ts';
import { Bi, LANG_ATTR, biParts, biText, dateParts, hasAny, speaker, timeRange } from './content.tsx';
import { logoUrl, useLogo } from '../components/brand.tsx';
import { postureL10n } from '../../shared/labels.ts';
import type { SlideDef, SlideLine } from './slideModel.ts';
import { LOW_FONT_WARN, MIN_FONT, deckFit, scaledCap } from './deckFit.ts';
import {
  type Blank, deckCache, DeckSizeCtx, type DeckSizes, type FitGroup, fitGroup, fitsBox, GROUP_MAX, MAX_FONT, sigOf,
  SlideThemeCtx, stageWidth, useAutoFit,
} from './slide-fit.tsx';
import './outputs.css';

/**
 * Lines of one language. Speaker labels (Leader / People) show when the item has more than one speaker: on the first
 * line of each speaker, and again at the top of a slide that continues a line or a speaker from the slide before.
 */
export function Lines({ lines, lang, speakers }: { lines: SlideLine[]; lang: Lang; speakers: boolean }) {
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

  const cls = `sl-face slide t-${s.type}${s.corner ? ' has-corner' : ''}${s.kind ? ` kind-${s.kind}` : ''}${s.type === 'section' ? ' slide-section' : ''}${r.season.color ? ' seasonal' : ''}${s.bg ? ' item-bg' : ''}`;
  // an item's own background picture replaces the template's (faded with the template's background colour)
  const style: Record<string, string> = {};
  if (r.season.color) style['--s-season'] = r.season.color;
  if (s.bg) {
    style['--slide-bg-image'] = `url("${backgroundUrl(s.bg.id, s.bg.v)}")`;
    style['--slide-bg-size'] = 'cover';
    style['--slide-bg-repeat'] = 'no-repeat';
    style['--slide-bg-overlay'] = 'var(--slide-item-bg-overlay)';
  }
  return (
    <div className={cls} style={Object.keys(style).length ? (style as CSSProperties) : undefined}>
      <div className="sl-head slide-heading">
        {s.heading && <Bi v={s.heading} langs={langs} sep="  ·  " />}
        {s.label && <span className="sl-label slide-stanza-label">{biText(s.label, langs, ' ')}</span>}
        {s.cont && s.type === 'lyrics' && !s.label && <span className="sl-cont slide-cont" aria-label="continued">…</span>}
        {s.posture && <span className="sl-posture slide-posture">{biText(postureL10n(s.posture, langs), langs, ' · ')}</span>}
      </div>
      <div className="sl-box" ref={boxRef}>
        <div className="sl-fit" ref={fitRef}>{body}</div>
      </div>
      {s.corner && (
        <div className="sl-corner slide-corner">
          <div className="sl-corner-qr"><img src={blockQrSrc(s.corner.id, s.corner.v, s.corner.value)} alt="" /></div>
          {hasAny(s.corner.caption) && <div className="sl-corner-cap">{blockLines(s.corner.caption, langs).map((p, i) => <div key={i} className={`lang-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</div>)}</div>}
        </div>
      )}
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
export function blockLines(v: L10n | undefined, langs: Lang[]): { lang: Lang; text: string }[] {
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
export function SlideBlock({ b, langs }: { b: RenderedSlideBlock; langs: Lang[] }) {
  const lines = (v: L10n | undefined, cls: string) =>
    blockLines(v, langs).map((p, i) => <div key={i} className={`${cls} lang-${p.lang}`} lang={LANG_ATTR[p.lang]}>{p.text}</div>);
  return (
    <div className={`sl-block slide-block block-${b.kind}`}>
      {b.kind === 'qr' && <div className="sl-qr slide-qr"><img src={blockQrSrc(b.id, b.v, b.value)} alt="" /></div>}
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

/** Measure the hidden copies: per group, the largest size at which every slide fits (capped by the theme's size). */
export function measureDeck(root: HTMLElement): DeckSizes {
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
export function DeckMeasurer({ slides, langs, split, r, themeId, aspect, onSizes }: {
  slides: SlideDef[];
  langs: Lang[];
  split: boolean;
  r: RenderedService;
  themeId: string;
  aspect?: SlideAspect;
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
            <div key={s.key} className="sl-stage-inner sl-measure-face" data-group={g} data-key={s.key} style={{ width: stageWidth(aspect) }}>
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
  theme: { id: string; sig: string; aspect?: SlideAspect };
  enabled: boolean;
}) {
  const logoVersion = useLogo();
  const sig = useMemo(() => {
    if (!enabled || !r) return '';
    const content = slides.filter((s) => fitGroup(s.type)).map((s) => [s.type, s.lines, s.verses, s.big, s.sub, s.meta]);
    return sigOf(JSON.stringify([theme.id, theme.sig, theme.aspect, langs, split, r.date, r.start_time, r.end_time, r.has_logo ? logoVersion : 0, content]));
  }, [enabled, r, slides, langs, split, theme.id, theme.sig, theme.aspect, logoVersion]);
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
  const measurer = enabled && r && !done ? <DeckMeasurer key={sig} slides={slides} langs={langs} split={split} r={r} themeId={theme.id} aspect={theme.aspect} onSizes={onSizes} /> : null;
  return { ctx, measurer };
}
