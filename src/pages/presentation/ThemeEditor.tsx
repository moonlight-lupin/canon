// Slide templates: the step-by-step editor beside a live preview.
import { DEFAULT_CLOSING_TEXT, QR_CORNERS, type QrCorner, type QrSize } from '../../../shared/slide-theme.ts';
const QR_CORNER_LABEL: Record<QrCorner, string> = { 'bottom-left': 'Lower left', 'bottom-right': 'Lower right', 'top-left': 'Upper left', 'top-right': 'Upper right' };
import { useMemo, useRef, useState } from 'react';
import { api } from '../../api.ts';
import { useContentLangs, useI18n } from '../../i18n.tsx';
import { Bi, Field, L10nInput, Seg, confirmAction, useAction, useSession, useToast } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { SlideFace } from '../../outputs/SlideFace.tsx';
import { DeckSizeCtx, SlideThemeCtx, Stage, sigOf } from '../../outputs/slide-fit.tsx';
import { useDeckSizes } from '../../outputs/SlideFace.tsx';
import { buildSlides, type SlideDef } from '../../outputs/slideModel.ts';
import {
  CSS_EXAMPLE, DEFAULT_THEME_VARS, FONT_PRESETS, LIGHT_THEME_COLOURS, SLIDE_CLASS_HOOKS, type FontScript,
  type SlideAspect, type SlideTheme, type SlideThemeVars,
} from '../../../shared/slide-theme.ts';
import { langInfo } from '../../../shared/languages.ts';
import { GuideLink, InfoTip, SaveBar, Step, TipLabel, useSteps } from '../template-ui.tsx';
import type { L10n, Lang, RenderedService } from '../../types-client.ts';
import { Badges, bgOf, compileSafe, sameDraft, useGalleryActions } from './gallery.tsx';
import '../../outputs/outputs.css';
import '../presentation.css';

export const PREVIEW_CAPTION: Record<string, string> = {
  title: 'Title slide',
  lyrics: 'Hymn words',
  scripture: 'Bible reading',
  text: 'Responsive liturgy',
};

/** The font setting a language uses (languages of one script share it). */
export function scriptOfLang(l: Lang): FontScript {
  const f = langInfo(l).font;
  return f === 'latin' ? 'latin' : f === 'sc' ? 'sc' : f === 'tc' ? 'tc' : 'other';
}

export const FONT_LABEL: Record<FontScript, string> = {
  latin: 'English and other Latin-script text',
  sc: 'Simplified Chinese',
  tc: 'Traditional Chinese',
  other: 'Other scripts (Tamil, Korean, Japanese)',
};

export function ThemeEditor({ theme, isDefault, langs, r, onBack, acts, onSaved }: {
  theme: SlideTheme;
  isDefault: boolean;
  langs: Lang[];
  r: RenderedService;
  onBack: () => void;
  acts: ReturnType<typeof useGalleryActions>;
  onSaved: () => Promise<unknown>;
}) {
  const { t, lt } = useI18n();
  const toast = useToast();
  const { canEdit, isAdmin } = useSession();
  const church = useContentLangs();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const steps = useSteps(1);
  const [draft, setDraft] = useState<SlideTheme>(() => structuredClone(theme));
  const ro = !canEdit || !!theme.builtin;
  const dirty = !ro && !sameDraft(draft, theme, ['name', 'base', 'vars', 'css']);
  const v = draft.vars;
  const setV = (p: Partial<SlideThemeVars>) => setDraft((d) => ({ ...d, vars: { ...d.vars, ...p } }));
  const bg = bgOf(draft);
  const compiled = useMemo(() => compileSafe('draft', draft.vars, draft.css, bg), [draft.vars, draft.css, bg]);
  const slides = useMemo(() => buildSlides(r, langs, draft.vars), [r, langs, draft.vars]);
  const previewTheme = useMemo(() => ({ id: 'draft', sig: sigOf(compiled.css), aspect: draft.vars.aspect }), [compiled.css, draft.vars.aspect]);
  const deck = useDeckSizes({ slides, langs, split: false, r, theme: previewTheme, enabled: v.uniform_size });
  const preview = useMemo(() => {
    const lyrics = slides.find((s) => s.type === 'lyrics' && Object.keys(s.lines ?? {}).length > 1) ?? slides.find((s) => s.type === 'lyrics');
    return [slides[0], lyrics, slides.find((s) => s.type === 'scripture'), slides.find((s) => s.type === 'text')].filter((s): s is SlideDef => !!s);
  }, [slides]);
  const [big, setBig] = useState(1);
  const shown = preview[Math.min(big, preview.length - 1)];

  const back = async () => {
    if (dirty && !await confirmAction(t('Discard your unsaved changes?'))) return;
    onBack();
  };
  const save = async () => {
    const { bg_image: _b, ...vars } = draft.vars;
    const th = await run(() => api.patch<SlideTheme>(`/slide-themes/${draft.id}`, { name: draft.name, base: draft.base, vars, css: draft.css }), t('Saved.'));
    if (th) {
      setDraft(structuredClone(th));
      await onSaved();
    }
  };
  const upload = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast(t('Upload a PNG, JPEG or WebP picture'), true);
    if (file.size > 5 * 1024 * 1024) return toast(t('The picture must be 5 MB or smaller'), true);
    const th = await run(() => api.put<SlideTheme>(`/slide-themes/${draft.id}/background`, file), t('Picture saved.'));
    if (th) {
      setDraft((d) => ({ ...d, vars: { ...d.vars, bg_image: th.vars.bg_image } }));
      await onSaved();
    }
  };
  const removePicture = async () => {
    const th = await run(() => api.del<SlideTheme>(`/slide-themes/${draft.id}/background`), t('Picture removed.'));
    if (th) {
      setDraft((d) => ({ ...d, vars: { ...d.vars, bg_image: th.vars.bg_image } }));
      await onSaved();
    }
  };
  const setBase = (b: 'dark' | 'light') =>
    setDraft((d) => ({ ...d, base: b, vars: { ...d.vars, ...(b === 'light' ? LIGHT_THEME_COLOURS : { bg: DEFAULT_THEME_VARS.bg, fg: DEFAULT_THEME_VARS.fg, accent: DEFAULT_THEME_VARS.accent, heading: DEFAULT_THEME_VARS.heading }) } }));

  const colour = (k: 'bg' | 'fg' | 'accent' | 'heading', label: string, tip?: string) => (
    <Field label={<TipLabel label={t(label)} tip={tip ? t(tip) : undefined} />}>
      <span className="pr-colour">
        <input type="color" value={v[k]} onChange={(e) => setV({ [k]: e.target.value })} />
        <code>{v[k]}</code>
      </span>
    </Field>
  );
  const range = (label: string, value: number, min: number, max: number, step: number, fmt: (n: number) => string, on: (n: number) => void, tip?: string) => (
    <Field label={<TipLabel label={t(label)} tip={tip ? t(tip) : undefined} />}>
      <span className="pr-range">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
        <output>{fmt(value)}</output>
      </span>
    </Field>
  );
  const fontName = (s: FontScript) => {
    const label = lt(FONT_PRESETS[s].find((p) => p.stack === v[`font_${s}`])?.label ?? { en: v[`font_${s}`].split(',')[0].replace(/['"]/g, '') });
    // "Default (Georgia serif)" → "Georgia serif"; "Book serif (Palatino)" → "Book serif"
    const m = /[(（](.*)[)）]$/.exec(label);
    return m && !v[`font_${s}`] ? m[1] : label.replace(/\s*[(（].*[)）]$/, '');
  };
  // the template's languages (declared first; the fonts and sizes below follow them); none chosen = the church's
  const tplLangs = (v.langs?.length ? v.langs.filter((l) => church.includes(l)) : church) as Lang[];
  const shownLangs = tplLangs.length ? tplLangs : church;
  const toggleLang = (l: Lang) => {
    const next = church.filter((x) => (x === l ? !tplLangs.includes(l) : tplLangs.includes(x)));
    if (next.length) setV({ langs: next.length === church.length ? [] : next });
  };
  const sizeOf = (l: Lang) => v.lang_scale?.[l] ?? 1;

  // one-line summaries for folded steps
  const sum = {
    look: `${draft.base === 'light' ? t('Light background') : t('Dark background')}${bg ? ` · ${t('with picture')}` : ''}`,
    text: [fontName('latin'), `${Math.round(v.scale * 100)}%`, ...Object.entries(v.lang_scale ?? {}).map(([l, n]) => `${langInfo(l).short} ${Math.round(n * 100)}%`), v.align === 'left' ? t('Left') : t('Centred')].join(' · '),
    lines: `${t('{n} lines (two or more languages)').replace('{n}', String(v.max_lines_multi))} · ${t('{n} lines (one language)').replace('{n}', String(v.max_lines_single))}${v.uniform_size ? ` · ${t('same size')}` : ''}`,
    screen: [v.aspect === '4:3' ? '4:3' : '16:9', v.footer_reference && t('reference'), v.footer_church && t('church name'), v.footer_number && t('slide number'), (v.closing ?? true) && t('closing slide')].filter(Boolean).join(' · '),
    css: draft.css.trim() ? t('Custom CSS in use') : t('None'),
  };

  const head = (
    <div className="tp-edit-head">
      <button type="button" className="btn sm ghost" onClick={back}><Icon name="chevronLeft" />{t('All slide templates')}</button>
      <h1><Bi v={draft.name} /></h1>
      <Badges builtin={!!theme.builtin} isDefault={isDefault} hidden={theme.hidden} refCode={theme.ref} />
      <div className="grow" />
      <GuideLink anchor="slide-templates" />
      {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : t('Services use this template unless they choose another.')} onClick={() => acts.makeDefault(theme.id)}><Icon name="check" />{t('Set as church default')}</button>}
      {canEdit && !theme.builtin && <button className="btn sm" disabled={busy} onClick={async () => { if (!dirty || await confirmAction(t('Discard your unsaved changes?'))) acts.copy(theme.id); }}><Icon name="copy" />{t('Duplicate')}</button>}
      {isAdmin && theme.hidden && !theme.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={async () => { if (await acts.remove(theme.id)) onBack(); }}><Icon name="trash" />{t('Delete')}</button>}
    </div>
  );

  const previewPane = (
    <div className="tp-preview">
      <style>{compiled.css}</style>
      <SlideThemeCtx.Provider value={previewTheme}>
        <DeckSizeCtx.Provider value={deck.ctx}>
          {deck.measurer}
          {shown && <div className="tp-preview-big"><Stage><SlideFace s={shown} langs={langs} split={false} r={r} num={slides.indexOf(shown) + 1} /></Stage></div>}
          <div className="tp-preview-strip" role="tablist" aria-label={t('Sample slides')}>
            {preview.map((s, i) => (
              <button key={s.key} type="button" role="tab" aria-selected={i === big} className={i === big ? 'on' : ''} onClick={() => setBig(i)}>
                <Stage><SlideFace s={s} langs={langs} split={false} r={r} num={slides.indexOf(s) + 1} /></Stage>
                <span>{t(PREVIEW_CAPTION[s.type] ?? '')}</span>
              </button>
            ))}
          </div>
        </DeckSizeCtx.Provider>
      </SlideThemeCtx.Provider>
      <span className="field-hint">{dirty ? t('Showing your unsaved changes.') : t('Drawn exactly as the projector shows it.')}</span>
    </div>
  );

  if (ro) {
    return (
      <>
        {head}
        <div className="tp-editor">
          <div className="stack">
            <div className="callout">
              {theme.builtin ? t('Built-in templates come with Canon and can’t be changed. Make a copy to change the colours, fonts or text size.') : t('You can look at this template, but only editors can change it.')}
            </div>
            {canEdit && theme.builtin && <div><button className="btn primary" onClick={() => acts.copy(theme.id)} disabled={busy}><Icon name="copy" />{t('Make a copy to customise')}</button></div>}
            <dl className="tp-facts">
              <dt>{t('Look')}</dt><dd>{sum.look}</dd>
              <dt>{t('Text')}</dt><dd>{sum.text}</dd>
              <dt>{t('Lines per slide')}</dt><dd>{sum.lines}</dd>
              <dt>{t('Screen and footer')}</dt><dd>{sum.screen}</dd>
            </dl>
          </div>
          {previewPane}
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="tp-editor">
        <div className="tp-steps">
          <Field label={t('Template name')}><L10nInput value={draft.name} onChange={(n) => setDraft((d) => ({ ...d, name: n }))} /></Field>

          <Step n={1} title={t('Colours and background')} summary={sum.look} open={steps.isOpen(1)} onToggle={() => steps.toggle(1)}>
            <Field label={<TipLabel label={t('Starting point')} tip={t('Choosing one resets the four colours below.')} />}>
              <div><Seg<'dark' | 'light'> value={draft.base} onChange={setBase} options={[{ value: 'dark', label: t('Dark background') }, { value: 'light', label: t('Light background') }]} /></div>
            </Field>
            <div className="pr-grid">
              {colour('bg', 'Background')}
              {colour('fg', 'Words')}
              {colour('heading', 'Titles', 'Service title, section and sermon titles')}
              {colour('accent', 'Accent', 'Small headings, verse numbers, Leader / People')}
            </div>
            <label className="check"><input type="checkbox" checked={v.accent_from_season} onChange={(e) => setV({ accent_from_season: e.target.checked })} />{t('Accent follows the liturgical season colour')} <InfoTip text={t('Only when season colours are on in Settings → Church.')} /></label>
            <div className="pr-bg">
              <div className="pr-bg-thumb" style={{ ...(bg ? { backgroundImage: `url("${bg}")` } : {}), aspectRatio: v.aspect === '4:3' ? '4 / 3' : '16 / 9' }}>{!bg && t('No picture')}</div>
              <div className="stack" style={{ gap: 6 }}>
                <div className="row">
                  <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" />{bg ? t('Replace picture') : t('Background picture…')}</button>
                  {bg && <button type="button" className="btn sm ghost danger" disabled={busy} onClick={removePicture}><Icon name="trash" />{t('Remove')}</button>}
                  <InfoTip text={v.aspect === '4:3' ? t('PNG, JPEG or WebP, up to 5 MB. For a 4:3 screen, 1440 × 1080 looks best.') : t('PNG, JPEG or WebP, up to 5 MB. A wide picture (1920 × 1080) looks best.')} />
                </div>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
              </div>
            </div>
            {bg && (
              <div className="pr-grid">
                <Field label={t('Picture fit')}>
                  <select value={v.bg_fit} onChange={(e) => setV({ bg_fit: e.target.value as SlideThemeVars['bg_fit'] })}>
                    <option value="cover">{t('Fill the screen (may crop)')}</option>
                    <option value="contain">{t('Show the whole picture')}</option>
                    <option value="tile">{t('Repeat as a pattern')}</option>
                  </select>
                </Field>
                {range('Fade the picture', v.bg_dim, 0, 0.9, 0.05, (n) => `${Math.round(n * 100)}%`, (n) => setV({ bg_dim: n }), 'Lays the background colour over the picture so the words stay readable.')}
              </div>
            )}
          </Step>

          <Step n={2} title={t('Fonts and text size')} summary={sum.text} open={steps.isOpen(2)} onToggle={() => steps.toggle(2)}>
            <Field label={<TipLabel label={t('Languages on this template')} tip={t('The languages this template is for. The font and size of each one follow below.')} />}>
              <div className="row">
                {church.map((l) => (
                  <label key={l} className="check"><input type="checkbox" checked={tplLangs.includes(l)} onChange={() => toggleLang(l)} />{langInfo(l).native}</label>
                ))}
              </div>
            </Field>
            {shownLangs.map((l) => {
              const s = scriptOfLang(l);
              const shares = shownLangs.filter((x) => x !== l && scriptOfLang(x) === s);
              return (
                <div key={l} className="pr-grid pr-lang-row">
                  <FontField script={s} label={`${langInfo(l).native} — ${t('font')}`} value={v[`font_${s}`]} onChange={(f) => setV({ [`font_${s}`]: f } as Partial<SlideThemeVars>)}
                    hint={shares.length ? t('Shared with {langs} (the same script).').replace('{langs}', shares.map((x) => langInfo(x).native).join(', ')) : undefined} />
                  {range(`${langInfo(l).native} — ${t('size')}`, sizeOf(l), 0.6, 1.6, 0.05, (n) => `${Math.round(n * 100)}%`, (n) => setV({ lang_scale: { ...(v.lang_scale ?? {}), [l]: n } }),
                    'Against the other languages. At the same point size Chinese looks smaller than English, so e.g. 115% evens them out. Long texts still shrink to fit.')}
                </div>
              );
            })}
            <span className="field-hint">{t('Only fonts installed on the projector computer can be used.')}</span>
            <div className="pr-grid">
              {range('Text size', v.scale, 0.6, 1.5, 0.05, (n) => `${Math.round(n * 100)}%`, (n) => setV({ scale: n }), 'The largest size words may have. Long texts still shrink to fit.')}
              {range('Line spacing', v.line_height, 1, 2, 0.05, (n) => n.toFixed(2), (n) => setV({ line_height: n }))}
              <Field label={t('Alignment')}>
                <div><Seg<'center' | 'left'> value={v.align} onChange={(a) => setV({ align: a })} options={[{ value: 'center', label: t('Centred') }, { value: 'left', label: t('Left') }]} /></div>
              </Field>
            </div>
            <label className="check"><input type="checkbox" checked={v.uppercase_titles} onChange={(e) => setV({ uppercase_titles: e.target.checked })} />{t('Titles in capital letters')}</label>
          </Step>

          <Step n={3} title={t('How much on each slide')} summary={sum.lines} open={steps.isOpen(3)} onToggle={() => steps.toggle(3)}>
            <Field label={<TipLabel label={t('Lines per slide')} tip={t('A line is a hymn line, or one sentence of a reading or the liturgy. The rest continues on the next slide, with every language kept together.')} />}>
              <div className="row pr-lines">
                <label>
                  <span>{t('two or more languages')}</span>
                  <select value={v.max_lines_multi} onChange={(e) => setV({ max_lines_multi: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>
                  <span>{t('one language')}</span>
                  <select value={v.max_lines_single} onChange={(e) => setV({ max_lines_single: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            </Field>
            <label className="check">
              <input type="checkbox" checked={v.uniform_size} onChange={(e) => setV({ uniform_size: e.target.checked })} />{t('Same text size on every slide')}
              <InfoTip text={t('Hymns, readings and liturgy all use the size that fits the fullest slide, so the words do not grow and shrink from slide to slide. Turn it off to make each slide as large as it can be.')} />
            </label>
          </Step>

          <Step n={4} title={t('Screen shape and footer')} summary={sum.screen} open={steps.isOpen(4)} onToggle={() => steps.toggle(4)}>
            <Field label={<TipLabel label={t('Screen shape')} tip={t('Most projectors and TVs are widescreen (16:9). Choose 4:3 for an older, squarer projector. The PowerPoint download uses the same shape.')} />}>
              <div><Seg<SlideAspect> value={v.aspect ?? '16:9'} onChange={(a) => setV({ aspect: a })} options={[{ value: '16:9', label: t('Widescreen 16:9') }, { value: '4:3', label: t('Standard 4:3') }]} /></div>
            </Field>
            <div className="row" style={{ gap: 16 }}>
              <label className="check"><input type="checkbox" checked={v.footer_reference} onChange={(e) => setV({ footer_reference: e.target.checked })} />{t('Scripture reference')}</label>
              <label className="check"><input type="checkbox" checked={v.footer_church} onChange={(e) => setV({ footer_church: e.target.checked })} />{t('Church name')}</label>
              <label className="check"><input type="checkbox" checked={v.footer_number} onChange={(e) => setV({ footer_number: e.target.checked })} />{t('Slide number')}</label>
            </div>
            <label className="check"><input type="checkbox" checked={v.show_posture} onChange={(e) => setV({ show_posture: e.target.checked })} />{t('Show “All stand / 众立” on the first slide of an item that has a posture')}</label>
            <Field label={<TipLabel label={t('QR code on the title slide')} tip={t('Where the bulletin link’s QR code sits on the title slide, and how big (Share → Bulletin for the congregation → Show the QR code on the title slide). The PowerPoint download uses the same.')} />}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <select value={v.qr_corner ?? 'bottom-right'} onChange={(e) => setV({ qr_corner: e.target.value as QrCorner })} aria-label={t('Position')}>
                  {QR_CORNERS.map((c) => <option key={c} value={c}>{t(QR_CORNER_LABEL[c])}</option>)}
                </select>
                <Seg<QrSize> value={v.qr_size ?? 'medium'} onChange={(z) => setV({ qr_size: z })} options={[{ value: 'small', label: t('Small') }, { value: 'medium', label: t('Medium') }, { value: 'large', label: t('Large') }]} />
              </div>
            </Field>
            <label className="check"><input type="checkbox" checked={v.closing ?? true} onChange={(e) => setV({ closing: e.target.checked })} />{t('A closing slide after the last item')}</label>
            {(v.closing ?? true) && (
              <Field label={t('Closing message')} hint={t('Shown with the church name. For a different message one week, add an item at the end of that service instead.')}>
                <L10nInput value={v.closing_text ?? DEFAULT_CLOSING_TEXT} onChange={(x) => setV({ closing_text: x })} />
              </Field>
            )}
          </Step>

          <Step n={5} title={t('Custom CSS (advanced)')} summary={sum.css} open={steps.isOpen(5)} onToggle={() => steps.toggle(5)}>
            <p className="small muted" style={{ margin: 0 }}>{t('Optional, for people who know CSS. Everything above works without it. It does not carry over to the PowerPoint download.')}</p>
            <Field label={<TipLabel label={t('Extra styling for this template only')} tip={t('Every rule applies only to slides that use this template. Pictures must be uploaded to Canon; links to other websites are not allowed.')} />}>
              <textarea className="pr-code" rows={9} spellCheck={false} value={draft.css} placeholder={CSS_EXAMPLE} onChange={(e) => setDraft((d) => ({ ...d, css: e.target.value }))} />
            </Field>
            {compiled.error && <div className="callout pr-err">{compiled.error}</div>}
            <div className="row">
              <button type="button" className="btn sm" onClick={() => setDraft((d) => ({ ...d, css: (d.css.trim() ? d.css.trimEnd() + '\n\n' : '') + CSS_EXAMPLE }))}><Icon name="wand" />{t('Insert example')}</button>
            </div>
            <CssHelp />
          </Step>
        </div>
        {previewPane}
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => setDraft(structuredClone(theme))} problem={compiled.error ? t('Fix the custom CSS first') : null} />
    </>
  );
}

export function FontField({ script, label, value, onChange, hint }: { script: FontScript; label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  const { t, lt } = useI18n();
  const presets = FONT_PRESETS[script];
  const [custom, setCustom] = useState(() => !presets.some((p) => p.stack === value));
  return (
    <Field label={t(label)} hint={hint}>
      <select
        value={custom ? '__custom' : value}
        onChange={(e) => {
          if (e.target.value === '__custom') setCustom(true);
          else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {presets.map((p) => <option key={p.stack} value={p.stack}>{lt(p.label)}</option>)}
        <option value="__custom">{t('Other font…')}</option>
      </select>
      {custom && <input className="pr-code" value={value} placeholder="'Font Name', Georgia, serif" onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function CssHelp() {
  const { t, lt } = useI18n();
  const vars: [string, L10n][] = [
    ['--slide-bg, --slide-fg', { en: 'background and word colours', zh: '背景与文字颜色' }],
    ['--slide-accent, --slide-heading', { en: 'accent and title colours', zh: '强调色与标题颜色' }],
    ['--slide-font-latin, --slide-font-sc, --slide-font-tc, --slide-font-other', { en: 'fonts per script', zh: '各文字的字体' }],
    ['--slide-scale, --slide-line-height', { en: 'text size and line spacing', zh: '字号与行距' }],
  ];
  return (
    <details className="pr-help">
      <summary>{t('Class names and settings you can use')}</summary>
      <table className="t">
        <tbody>
          {SLIDE_CLASS_HOOKS.map((h) => (
            <tr key={h.cls}><td>{h.cls}</td><td>{lt(h.what)}</td></tr>
          ))}
          {vars.map(([k, w]) => (
            <tr key={k}><td>{k}</td><td>{lt(w)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ marginTop: 8 }}>
        {t('Example: .slide-lyrics { font-size: 1.2em; } makes hymn words 20% larger. Use url(/api/assets/…) only for pictures uploaded to Canon.')}
      </p>
    </details>
  );
}

// ================================================================= bulletin templates
