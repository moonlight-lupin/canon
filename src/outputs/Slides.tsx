// Full-screen projector view with keyboard control, overview grid and a synced presenter window.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg, useLatest } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { RenderedService } from '../types-client.ts';
import { useApproved } from './approved.tsx';
import type { SlideTheme } from '../../shared/slide-theme.ts';
import { Bi, biText, langOptions, langsFor, modeFor, type LangMode } from './content.tsx';
import { buildSlides, mapSlideIndex, slideText, type SlideDef } from './slideModel.ts';
import './outputs.css';
import { PresenterView, toggleFullscreen } from './PresenterView.tsx';
import { SlideOrBlank, useDeckSizes } from './SlideFace.tsx';
import { type Blank, DeckSizeCtx, sigOf, SlideThemeCtx, Stage, type SyncState } from './slide-fit.tsx';

export default function Slides() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const presenter = sp.get('presenter') === '1';
  const { t, lt } = useI18n();
  // an approved version (?approved=…) is drawn from the copy kept when it was approved, its template's CSS too
  const { approvedId, approval, error: apError } = useApproved(id);
  const live = useApi<RenderedService>(approvedId ? null : `/services/${id}/render`);
  const liveThemes = useApi<SlideTheme[]>(approvedId ? null : '/slide-themes');
  const r = approvedId ? approval?.snapshot.render : live.data;
  const error = apError ?? live.error;
  const themes = approvedId ? (approval ? (approval.snapshot.slide_theme ? [approval.snapshot.slide_theme] : []) : undefined) : liveThemes.data;
  const themesError = approvedId ? null : liveThemes.error;

  const [state, setState] = useState<SyncState>({ idx: 0, blank: 'none', mode: 'both', split: false, theme: null });
  const [modeInit, setModeInit] = useState(false);
  const [overview, setOverview] = useState(false);

  // Slide theme: the one picked in the bar (this session only), else the service's (service → church default → Ink).
  const themeId = state.theme ?? r?.slide_theme_id ?? null;
  const theme = themes?.find((x) => x.id === themeId);
  const [css, setCss] = useState<{ id: number; css: string } | null>(null);
  useEffect(() => {
    if (themeId == null) return;
    if (approval && themeId === approval.snapshot.render.slide_theme_id) {
      setCss({ id: themeId, css: approval.snapshot.slide_css });
      return;
    }
    let live = true;
    fetch(`/api/slide-themes/${themeId}/css`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.text() : ''))
      .catch(() => '')
      .then((text) => live && setCss({ id: themeId, css: text }));
    return () => {
      live = false;
    };
  }, [themeId, theme?.updated_at, approval]);
  const themeCss = css && css.id === themeId ? css.css : null;
  const themeCtx = useMemo(() => ({ id: themeId ? String(themeId) : '', sig: sigOf(themeCss ?? ''), aspect: theme?.vars.aspect }), [themeId, themeCss, theme?.vars.aspect]);

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
            {themes.filter((x) => !x.hidden || x.id === themeId || x.id === r.slide_theme_id).map((x) => <option key={x.id} value={x.id}>{lt(x.name)}{x.id === r.slide_theme_id ? ' ✓' : ''}</option>)}
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
