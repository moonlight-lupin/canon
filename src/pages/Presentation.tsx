// "Bulletin & slides": how slides look on the projector (slide themes: colours, fonts, background picture,
// custom CSS) and what the printed bulletin includes (bulletin templates: what to print for each kind of item).
// Both previews use the real renderers (SlideFace, the bulletin's BulletinPages) on a small sample service.
import { useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useContentLangs, useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Field, L10nInput, Loading, PageHead, Seg, confirmAction, useAction, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { DeckSizeCtx, SlideFace, SlideThemeCtx, Stage, sigOf, useDeckSizes } from '../outputs/Slides.tsx';
import { buildSlides, type SlideDef } from '../outputs/slideModel.ts';
import { COVER_LABEL, PAPERS, PAPER_ORDER } from '../outputs/Bulletin.tsx';
import { BulletinSample, PageLayoutEditor } from './BulletinLayoutEditor.tsx';
import {
  COVER_STYLES, CSS_EXAMPLE, DEFAULT_THEME_VARS, FONT_PRESETS, LIGHT_THEME_COLOURS, SLIDE_CLASS_HOOKS,
  compileThemeCss, themeBgUrl,
  type BulletinOptions, type BulletinTemplate,
  type FontScript, type HymnNumberStyle, type SlideTheme, type SlideThemeVars,
} from '../../shared/presentation.ts';
import { sampleLangs, sampleService } from './presentation-sample.ts';
import { Card } from './Blocks.tsx';
import type { L10n, Lang, RenderedService } from '../types-client.ts';
import '../outputs/outputs.css';
import './presentation.css';

/** Service Planner → Bulletin templates: what the printed bulletin includes. (QR codes and notes live in the Library.) */
export function BulletinTemplatesPage() {
  const { t } = useI18n();
  // old links to the QR codes tab go to the Library
  if (new URLSearchParams(location.search).get('tab') === 'blocks') return <Navigate to="/library?tab=blocks" replace />;
  return (
    <div className="page">
      <PageHead eyebrow={t('Service Planner')} title={t('Bulletin templates')} sub={t('What each printed bulletin includes: paper, cover, which items print in full, rosters and QR codes.')} />
      <p className="small muted" style={{ margin: '-6px 0 14px' }}>
        <Icon name="qr" width={14} height={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('QR codes and notes are kept in Library → QR codes & notes and can be used on bulletins and slides.')}{' '}
        <Link to="/library?tab=blocks">{t('Open')} →</Link>
      </p>
      <TemplatesTab />
    </div>
  );
}

/** Service Planner → Slide templates: colours, background, fonts and custom CSS of the projector slides. */
export function SlideTemplatesPage() {
  const { t } = useI18n();
  return (
    <div className="page">
      <PageHead eyebrow={t('Service Planner')} title={t('Slide templates')} sub={t('How the slides look on the projector: colours, background, fonts and custom CSS.')} />
      <ThemesTab />
    </div>
  );
}

/** Old /presentation links (and ?tab=…) go to the matching new page. */
export default function Presentation() {
  const q = new URLSearchParams(location.search).get('tab');
  return <Navigate to={q === 'bulletin' ? '/bulletin-templates' : q === 'blocks' ? '/library?tab=blocks' : '/slide-templates'} replace />;
}

function Badges({ builtin, isDefault }: { builtin: boolean; isDefault: boolean }) {
  const { t } = useI18n();
  if (!builtin && !isDefault) return null;
  return (
    <div className="pr-badges">
      {isDefault && <span className="badge reed"><Icon name="check" width={12} height={12} />{t('Church default')}</span>}
      {builtin && <span className="badge">{t('Built-in')}</span>}
    </div>
  );
}

const sameDraft = <T extends object>(a: T | null, b: T | null, keys: (keyof T)[]) =>
  !!a && !!b && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

// ================================================================= slide themes

const bgOf = (x: Pick<SlideTheme, 'id' | 'vars'>) => (x.vars.bg_image ? themeBgUrl(x.id, x.vars.bg_image) : null);

/** Compile a theme for the browser; a CSS or font problem falls back to the settings alone (error returned). */
function compileSafe(scope: string, vars: SlideThemeVars, css: string, bg: string | null): { css: string; error: string | null } {
  try {
    return { css: compileThemeCss(scope, vars, css, bg), error: null };
  } catch (e) {
    const error = (e as Error).message;
    try {
      return { css: compileThemeCss(scope, vars, '', bg), error };
    } catch {
      return { css: compileThemeCss(scope, DEFAULT_THEME_VARS, '', bg), error };
    }
  }
}

function useSample() {
  const { settings } = useSession();
  const church = useContentLangs();
  const langs = useMemo(() => sampleLangs(church), [church]);
  const r = useMemo(() => sampleService(langs, settings?.church_name ?? { en: 'Our Church' }, settings?.season_colours !== false), [langs, settings]);
  return { langs, r };
}

function ThemesTab() {
  const { t } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data: themes, error, reload } = useApi<SlideTheme[]>('/slide-themes');
  const { run, busy } = useAction();
  const { langs, r } = useSample();
  const slides = useMemo(() => buildSlides(r, langs), [r, langs]);

  const legacy = settings?.slide_theme === 'light' ? 'papyrus' : 'ink';
  const defaultId = themes?.find((x) => x.id === settings?.default_slide_theme_id)?.id ?? themes?.find((x) => x.builtin === legacy)?.id ?? null;
  const [selId, setSelId] = useState<number | null>(null);
  const sel = themes?.find((x) => x.id === selId) ?? themes?.find((x) => x.id === defaultId) ?? themes?.[0] ?? null;
  const [draft, setDraft] = useState<SlideTheme | null>(null);
  // a fresh draft whenever another theme is selected
  if (sel && draft?.id !== sel.id) setDraft(structuredClone(sel));
  const dirty = !!draft && !!sel && !sameDraft(draft, sel, ['name', 'base', 'vars', 'css']);

  const listCss = useMemo(() => (themes ?? []).map((x) => compileSafe(String(x.id), x.vars, x.css, bgOf(x)).css).join('\n'), [themes]);

  const select = (id: number) => {
    if (id === sel?.id) return;
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
    setSelId(id);
    setDraft(null);
  };
  const afterChange = async (id?: number) => {
    await reload();
    if (id) {
      setSelId(id);
      setDraft(null);
    }
  };
  const create = async () => {
    const th = await run(() => api.post<SlideTheme>('/slide-themes', { name: { en: 'New theme', zh: '新主题' }, base: 'dark', vars: DEFAULT_THEME_VARS, css: '' }));
    if (th) await afterChange(th.id);
  };

  if (error) return <ErrorBox error={error} />;
  if (!themes) return <Loading />;
  return (
    <div className="pr-split">
      <style>{listCss}</style>
      <div className="pr-list">
        {canEdit && <button className="btn" onClick={create} disabled={busy}><Icon name="plus" />{t('New theme')}</button>}
        {themes.map((x) => (
          <Card key={x.id} on={x.id === sel?.id} onSelect={() => select(x.id)}>
            <SlideThemeCtx.Provider value={{ id: String(x.id), sig: sigOf(x.updated_at + x.css) }}>
              <Stage><SlideFace s={slides[0]} langs={langs} split={false} r={r} num={1} /></Stage>
            </SlideThemeCtx.Provider>
            <div className="pr-card-name"><Bi v={x.name} /></div>
            <Badges builtin={!!x.builtin} isDefault={x.id === defaultId} />
          </Card>
        ))}
      </div>
      {draft && sel && (
        <ThemeEditor
          key={draft.id}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          isDefault={draft.id === defaultId}
          canEdit={canEdit}
          isAdmin={isAdmin}
          langs={langs}
          r={r}
          onSaved={async (th) => {
            setDraft(structuredClone(th));
            await reload();
          }}
          onPicture={async (th) => {
            setDraft((d) => (d ? { ...d, vars: { ...d.vars, bg_image: th.vars.bg_image } } : d));
            await reload();
          }}
          onDuplicated={(th) => afterChange(th.id)}
          onDeleted={async () => {
            setSelId(null);
            setDraft(null);
            await reload();
            reloadSettings();
          }}
          onDefault={reloadSettings}
        />
      )}
    </div>
  );
}

const PREVIEW_CAPTION: Record<string, string> = {
  title: 'Title slide',
  lyrics: 'Hymn words',
  scripture: 'Bible reading',
  text: 'Responsive liturgy',
};

function ThemeEditor({
  draft, setDraft, dirty, isDefault, canEdit, isAdmin, langs, r, onSaved, onPicture, onDuplicated, onDeleted, onDefault,
}: {
  draft: SlideTheme;
  setDraft: (f: SlideTheme | ((d: SlideTheme | null) => SlideTheme | null)) => void;
  dirty: boolean;
  isDefault: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  langs: Lang[];
  r: RenderedService;
  onSaved: (t: SlideTheme) => Promise<void>;
  onPicture: (t: SlideTheme) => Promise<void>;
  onDuplicated: (t: SlideTheme) => void;
  onDeleted: () => Promise<void>;
  onDefault: () => void;
}) {
  const { t, lt } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const ro = !canEdit || !!draft.builtin;
  const v = draft.vars;
  const setV = (p: Partial<SlideThemeVars>) => setDraft({ ...draft, vars: { ...draft.vars, ...p } });
  const bg = bgOf(draft);
  const compiled = useMemo(() => compileSafe('draft', draft.vars, draft.css, bg), [draft.vars, draft.css, bg]);
  // the sample service cut with this theme's lines per slide, and its one text size (as the projector computes it)
  const slides = useMemo(() => buildSlides(r, langs, draft.vars), [r, langs, draft.vars]);
  const previewTheme = useMemo(() => ({ id: 'draft', sig: sigOf(compiled.css) }), [compiled.css]);
  const deck = useDeckSizes({ slides, langs, split: false, r, theme: previewTheme, enabled: v.uniform_size });

  const preview = useMemo(() => {
    const lyrics = slides.find((s) => s.type === 'lyrics' && Object.keys(s.lines ?? {}).length > 1) ?? slides.find((s) => s.type === 'lyrics');
    return [slides[0], lyrics, slides.find((s) => s.type === 'scripture'), slides.find((s) => s.type === 'text')].filter((s): s is SlideDef => !!s);
  }, [slides]);

  const save = async () => {
    const { bg_image: _b, ...vars } = draft.vars;
    const th = await run(() => api.patch<SlideTheme>(`/slide-themes/${draft.id}`, { name: draft.name, base: draft.base, vars, css: draft.css }), t('Saved.'));
    if (th) await onSaved(th);
  };
  const duplicate = async () => {
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
    const th = await run(() => api.post<SlideTheme>(`/slide-themes/${draft.id}/duplicate`), t('Copy made — you can edit it now.'));
    if (th) onDuplicated(th);
  };
  const remove = async () => {
    if (!confirmAction(t('Delete this theme? Services using it go back to the church default.'))) return;
    if (await run(() => api.del(`/slide-themes/${draft.id}`), t('Deleted.'))) await onDeleted();
  };
  const makeDefault = async () => {
    if (await run(() => api.put('/presentation/defaults', { slide_theme_id: draft.id }), t('This is now the church default.'))) onDefault();
  };
  const upload = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast(t('Upload a PNG, JPEG or WebP picture'), true);
    if (file.size > 5 * 1024 * 1024) return toast(t('The picture must be 5 MB or smaller'), true);
    const th = await run(() => api.put<SlideTheme>(`/slide-themes/${draft.id}/background`, file), t('Picture saved.'));
    if (th) await onPicture(th);
  };
  const removePicture = async () => {
    const th = await run(() => api.del<SlideTheme>(`/slide-themes/${draft.id}/background`), t('Picture removed.'));
    if (th) await onPicture(th);
  };
  const setBase = (b: 'dark' | 'light') =>
    setDraft({ ...draft, base: b, vars: { ...v, ...(b === 'light' ? LIGHT_THEME_COLOURS : { bg: DEFAULT_THEME_VARS.bg, fg: DEFAULT_THEME_VARS.fg, accent: DEFAULT_THEME_VARS.accent, heading: DEFAULT_THEME_VARS.heading }) } });

  const colour = (k: 'bg' | 'fg' | 'accent' | 'heading', label: string, hint?: string) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <span className="pr-colour">
        <input type="color" value={v[k]} onChange={(e) => setV({ [k]: e.target.value })} />
        <code>{v[k]}</code>
      </span>
    </Field>
  );
  const range = (label: string, value: number, min: number, max: number, step: number, fmt: (n: number) => string, on: (n: number) => void, hint?: string) => (
    <Field label={t(label)} hint={hint ? t(hint) : undefined}>
      <span className="pr-range">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
        <output>{fmt(value)}</output>
      </span>
    </Field>
  );

  return (
    <div className="card">
      <div className="pr-head">
        <h2><Bi v={draft.name} /></h2>
        <Badges builtin={!!draft.builtin} isDefault={isDefault} />
        {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : undefined} onClick={makeDefault}><Icon name="check" />{t('Set as church default')}</button>}
        {canEdit && <button className="btn sm" disabled={busy} onClick={duplicate}><Icon name="copy" />{t('Duplicate')}</button>}
        {canEdit && !draft.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={remove}><Icon name="trash" />{t('Delete')}</button>}
        {canEdit && !draft.builtin && <button className="btn sm primary" disabled={busy || !dirty || !!compiled.error} title={compiled.error ? t('Fix the custom CSS first') : undefined} onClick={save}>{t('Save')}</button>}
      </div>
      {draft.builtin && canEdit && (
        <div className="callout" style={{ marginBottom: 14 }}>{t("Built-in themes can't be changed. Press Duplicate to make your own copy, then change that.")}</div>
      )}
      <div className="pr-editor">
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          <Field label={t('Name')}><L10nInput value={draft.name} onChange={(n) => setDraft({ ...draft, name: n })} /></Field>

          <div className="pr-sec">{t('Colours')}</div>
          <Field label={t('Starting point')} hint={t('Choosing one resets the four colours below.')}>
            <div><Seg<'dark' | 'light'> value={draft.base} onChange={setBase} options={[{ value: 'dark', label: t('Dark background') }, { value: 'light', label: t('Light background') }]} /></div>
          </Field>
          <div className="pr-grid">
            {colour('bg', 'Background')}
            {colour('fg', 'Words')}
            {colour('heading', 'Titles')}
            {colour('accent', 'Accent', 'Small headings, verse numbers, Leader / People')}
          </div>
          <label className="check"><input type="checkbox" checked={v.accent_from_season} onChange={(e) => setV({ accent_from_season: e.target.checked })} />{t('Accent follows the liturgical season colour (when season colours are on in Settings)')}</label>

          <div className="pr-sec">{t('Background picture')}</div>
          <div className="pr-bg">
            <div className="pr-bg-thumb" style={bg ? { backgroundImage: `url("${bg}")` } : undefined}>{!bg && t('No picture')}</div>
            <div className="stack" style={{ gap: 6 }}>
              <div className="row">
                <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" />{bg ? t('Replace picture') : t('Upload picture')}</button>
                {bg && <button type="button" className="btn sm ghost danger" disabled={busy} onClick={removePicture}><Icon name="trash" />{t('Remove')}</button>}
              </div>
              <span className="field-hint">{t('PNG, JPEG or WebP, up to 5 MB. A wide picture (1920 × 1080) looks best.')}</span>
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

          <div className="pr-sec">{t('Fonts')}</div>
          <div className="pr-grid">
            <FontField script="latin" label="English and other Latin-script text" value={v.font_latin} onChange={(f) => setV({ font_latin: f })} />
            <FontField script="sc" label="Simplified Chinese" value={v.font_sc} onChange={(f) => setV({ font_sc: f })} />
            <FontField script="tc" label="Traditional Chinese" value={v.font_tc} onChange={(f) => setV({ font_tc: f })} />
            <FontField script="other" label="Other scripts (Tamil, Korean, Japanese)" value={v.font_other} onChange={(f) => setV({ font_other: f })} />
          </div>
          <span className="field-hint">{t('Only fonts installed on the projector computer can be used.')}</span>

          <div className="pr-sec">{t('Text')}</div>
          <div className="pr-grid">
            {range('Text size', v.scale, 0.6, 1.5, 0.05, (n) => `${Math.round(n * 100)}%`, (n) => setV({ scale: n }), 'Long texts still shrink to fit.')}
            {range('Line spacing', v.line_height, 1, 2, 0.05, (n) => n.toFixed(2), (n) => setV({ line_height: n }))}
            <Field label={t('Alignment')}>
              <div><Seg<'center' | 'left'> value={v.align} onChange={(a) => setV({ align: a })} options={[{ value: 'center', label: t('Centred') }, { value: 'left', label: t('Left') }]} /></div>
            </Field>
          </div>
          <label className="check"><input type="checkbox" checked={v.uppercase_titles} onChange={(e) => setV({ uppercase_titles: e.target.checked })} />{t('Titles in capital letters')}</label>
          <Field label={t('Lines per slide')} hint={t('A line is a hymn line, or one sentence of a reading or the liturgy. The rest continues on the next slide, with every language kept together.')}>
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
          <label className="check"><input type="checkbox" checked={v.uniform_size} onChange={(e) => setV({ uniform_size: e.target.checked })} />{t('Same text size on every slide')}</label>
          <span className="field-hint">{t('Hymns, readings and liturgy all use the size that fits the fullest slide, so the words do not grow and shrink from slide to slide. Turn it off to make each slide as large as it can be.')}</span>

          <div className="pr-sec">{t('Footer')}</div>
          <div className="row" style={{ gap: 16 }}>
            <label className="check"><input type="checkbox" checked={v.footer_reference} onChange={(e) => setV({ footer_reference: e.target.checked })} />{t('Scripture reference')}</label>
            <label className="check"><input type="checkbox" checked={v.footer_church} onChange={(e) => setV({ footer_church: e.target.checked })} />{t('Church name')}</label>
            <label className="check"><input type="checkbox" checked={v.footer_number} onChange={(e) => setV({ footer_number: e.target.checked })} />{t('Slide number')}</label>
          </div>
          <label className="check"><input type="checkbox" checked={v.show_posture} onChange={(e) => setV({ show_posture: e.target.checked })} />{t('Show “All stand / 众立” on the first slide of an item that has a posture')}</label>

          <div className="pr-sec">{t('Custom CSS (advanced)')}</div>
          <Field label={t('Extra styling for this theme only')} hint={t('Every rule applies only to slides that use this theme. Pictures must be uploaded to Canon; links to other websites are not allowed.')}>
            <textarea className="pr-code" rows={9} spellCheck={false} value={draft.css} placeholder={CSS_EXAMPLE} onChange={(e) => setDraft({ ...draft, css: e.target.value })} />
          </Field>
          {compiled.error && <div className="callout pr-err">{compiled.error}</div>}
          <div className="row">
            <button type="button" className="btn sm" onClick={() => setDraft({ ...draft, css: (draft.css.trim() ? draft.css.trimEnd() + '\n\n' : '') + CSS_EXAMPLE })}><Icon name="wand" />{t('Insert example')}</button>
          </div>
          <CssHelp />
        </fieldset>

        <div className="pr-side">
          <div className="pr-sec" style={{ marginTop: 0 }}>{t('Live preview')}</div>
          <style>{compiled.css}</style>
          <SlideThemeCtx.Provider value={previewTheme}>
          <DeckSizeCtx.Provider value={deck.ctx}>
            {deck.measurer}
            <div className="pr-preview">
              {preview.map((s) => (
                <figure key={s.key}>
                  <Stage><SlideFace s={s} langs={langs} split={false} r={r} num={slides.indexOf(s) + 1} /></Stage>
                  <figcaption>{t(PREVIEW_CAPTION[s.type] ?? '')}</figcaption>
                </figure>
              ))}
            </div>
          </DeckSizeCtx.Provider>
          </SlideThemeCtx.Provider>
          <span className="field-hint">{dirty ? t('Showing your unsaved changes.') : lt({ en: 'Drawn exactly as the projector shows it.', zh: '与投影画面完全相同。' })}</span>
        </div>
      </div>
    </div>
  );
}

function FontField({ script, label, value, onChange }: { script: FontScript; label: string; value: string; onChange: (v: string) => void }) {
  const { t, lt } = useI18n();
  const presets = FONT_PRESETS[script];
  const [custom, setCustom] = useState(() => !presets.some((p) => p.stack === value));
  return (
    <Field label={t(label)}>
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

function CssHelp() {
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

function TemplatesTab() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data: list, error, reload } = useApi<BulletinTemplate[]>('/bulletin-templates');
  const { run, busy } = useAction();
  const defaultId = list?.find((x) => x.id === settings?.default_bulletin_template_id)?.id ?? list?.find((x) => x.builtin === 'full')?.id ?? null;
  const [selId, setSelId] = useState<number | null>(null);
  const sel = list?.find((x) => x.id === selId) ?? list?.find((x) => x.id === defaultId) ?? list?.[0] ?? null;
  const [draft, setDraft] = useState<BulletinTemplate | null>(null);
  if (sel && draft?.id !== sel.id) setDraft(structuredClone(sel));
  const dirty = !!draft && !!sel && !sameDraft(draft, sel, ['name', 'description', 'options']);

  const select = (id: number) => {
    if (id === sel?.id) return;
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
    setSelId(id);
    setDraft(null);
  };
  const go = async (id: number) => {
    await reload();
    setSelId(id);
    setDraft(null);
  };
  const create = async () => {
    const x = await run(() => api.post<BulletinTemplate>('/bulletin-templates', { name: { en: 'New template', zh: '新模板' }, description: {} }));
    if (x) await go(x.id);
  };

  if (error) return <ErrorBox error={error} />;
  if (!list) return <Loading />;
  return (
    <div className="pr-split">
      <div className="pr-list">
        {canEdit && <button className="btn" onClick={create} disabled={busy}><Icon name="plus" />{t('New template')}</button>}
        {list.map((x) => (
          <Card key={x.id} on={x.id === sel?.id} onSelect={() => select(x.id)}>
            <div className="pr-card-name"><Bi v={x.name} /></div>
            {lt(x.description) && <div className="pr-card-desc">{lt(x.description)}</div>}
            <Badges builtin={!!x.builtin} isDefault={x.id === defaultId} />
          </Card>
        ))}
      </div>
      {draft && (
        <TemplateEditor
          key={draft.id}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          isDefault={draft.id === defaultId}
          canEdit={canEdit}
          isAdmin={isAdmin}
          onSaved={async (x) => {
            setDraft(structuredClone(x));
            await reload();
          }}
          onDuplicated={(x) => go(x.id)}
          onDeleted={async () => {
            setSelId(null);
            setDraft(null);
            await reload();
            reloadSettings();
          }}
          onDefault={reloadSettings}
        />
      )}
    </div>
  );
}

type PrintKey = keyof BulletinOptions['print'];
const PRINT_ROWS: { key: PrintKey; label: string; hint: string; choices: { value: string; label: string }[] }[] = [
  {
    key: 'song', label: 'Hymns and songs', hint: 'Hymns, psalms and the doxology',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'first_stanza', label: 'First verse only' }, { value: 'title', label: 'Title only' }],
  },
  {
    key: 'scripture', label: 'Bible readings', hint: 'Scripture readings',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'reference', label: 'Reference only' }],
  },
  {
    key: 'text', label: 'Creeds and liturgy', hint: 'Creeds, catechism, call to worship, responsive readings',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'title', label: 'Title only' }],
  },
  {
    key: 'other', label: 'Prayers and other items', hint: 'Prayers, offering, announcements — when they have words',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'title', label: 'Title only' }],
  },
];
const PRINT_COLUMNS = [
  { value: 'full', label: 'All the words' },
  { value: 'first_stanza', label: 'First verse only' },
  { value: 'title', label: 'Title or reference only' },
];
const colOf = (v: string) => (v === 'reference' ? 'title' : v);

function TemplateEditor({
  draft, setDraft, dirty, isDefault, canEdit, isAdmin, onSaved, onDuplicated, onDeleted, onDefault,
}: {
  draft: BulletinTemplate;
  setDraft: (d: BulletinTemplate) => void;
  dirty: boolean;
  isDefault: boolean;
  canEdit: boolean;
  isAdmin: boolean;
  onSaved: (x: BulletinTemplate) => Promise<void>;
  onDuplicated: (x: BulletinTemplate) => void;
  onDeleted: () => Promise<void>;
  onDefault: () => void;
}) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const ro = !canEdit || !!draft.builtin;
  const o = draft.options;
  const setO = (p: Partial<BulletinOptions>) => setDraft({ ...draft, options: { ...o, ...p } });
  const setPrint = (k: PrintKey, v: string) => setO({ print: { ...o.print, [k]: v } });

  const save = async () => {
    const x = await run(() => api.patch<BulletinTemplate>(`/bulletin-templates/${draft.id}`, { name: draft.name, description: draft.description, options: draft.options }), t('Saved.'));
    if (x) await onSaved(x);
  };
  const duplicate = async () => {
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
    const x = await run(() => api.post<BulletinTemplate>(`/bulletin-templates/${draft.id}/duplicate`), t('Copy made — you can edit it now.'));
    if (x) onDuplicated(x);
  };
  const remove = async () => {
    if (!confirmAction(t('Delete this template? Services using it go back to the church default.'))) return;
    if (await run(() => api.del(`/bulletin-templates/${draft.id}`), t('Deleted.'))) await onDeleted();
  };
  const makeDefault = async () => {
    if (await run(() => api.put('/presentation/defaults', { bulletin_template_id: draft.id }), t('This is now the church default.'))) onDefault();
  };

  return (
    <div className="card">
      <div className="pr-head">
        <h2><Bi v={draft.name} /></h2>
        <Badges builtin={!!draft.builtin} isDefault={isDefault} />
        {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : undefined} onClick={makeDefault}><Icon name="check" />{t('Set as church default')}</button>}
        {canEdit && <button className="btn sm" disabled={busy} onClick={duplicate}><Icon name="copy" />{t('Duplicate')}</button>}
        {canEdit && !draft.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={remove}><Icon name="trash" />{t('Delete')}</button>}
        {canEdit && !draft.builtin && <button className="btn sm primary" disabled={busy || !dirty} onClick={save}>{t('Save')}</button>}
      </div>
      {draft.builtin && canEdit && (
        <div className="callout" style={{ marginBottom: 14 }}>{t("Built-in templates can't be changed. Press Duplicate to make your own copy, then change that.")}</div>
      )}
      <div className="pr-editor">
        <div className="stack" style={{ minWidth: 0 }}>
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          <Field label={t('Name')}><L10nInput value={draft.name} onChange={(n) => setDraft({ ...draft, name: n })} /></Field>
          <Field label={t('Description')}><L10nInput value={draft.description} onChange={(n) => setDraft({ ...draft, description: n })} /></Field>

          <div className="pr-sec">{t('What to print')}</div>
          <div className="table-wrap">
            <table className="t pr-print">
              <thead>
                <tr><th />{PRINT_COLUMNS.map((c) => <th key={c.value}>{t(c.label)}</th>)}</tr>
              </thead>
              <tbody>
                {PRINT_ROWS.map((row) => (
                  <tr key={row.key}>
                    <td><div style={{ fontWeight: 600 }}>{t(row.label)}</div><div className="field-hint">{t(row.hint)}</div></td>
                    {PRINT_COLUMNS.map((c) => {
                      const choice = row.choices.find((x) => colOf(x.value) === c.value);
                      if (!choice) return <td key={c.value} className="na">—</td>;
                      return (
                        <td key={c.value}>
                          <input
                            type="radio"
                            name={`print-${row.key}`}
                            aria-label={`${t(row.label)}: ${t(choice.label)}`}
                            checked={o.print[row.key] === choice.value}
                            onChange={() => setPrint(row.key, choice.value)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <span className="field-hint">{t('In the service planner each item can still be set to “Full text” or “Title only”, whatever the template says.')}</span>

          <div className="pr-sec">{t('Paper and layout')}</div>
          <div className="pr-grid">
            <Field label={t('Paper')}>
              <select value={o.paper} onChange={(e) => setO({ paper: e.target.value as BulletinOptions['paper'] })}>
                {PAPER_ORDER.map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
              </select>
            </Field>
            <Field label={t('Font size')}>
              <select value={o.font_pt ?? ''} onChange={(e) => setO({ font_pt: e.target.value ? Number(e.target.value) : null })}>
                <option value="">{t('Automatic')} ({PAPERS[o.paper].font}pt)</option>
                {[8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14, 15, 16].map((n) => <option key={n} value={n}>{n}pt</option>)}
              </select>
            </Field>
            <Field label={t('Cover')}>
              <select value={o.cover} onChange={(e) => setO({ cover: e.target.value as BulletinOptions['cover'] })}>
                <option value="default">{t('As chosen for the service, else the church default')}</option>
                {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
                <option value="banner">{t(COVER_LABEL.banner)}</option>
              </select>
            </Field>
          </div>
          <div className="pr-grid">
            <Field label={t('Languages')}>
              <div><Seg<BulletinOptions['languages']> value={o.languages} onChange={(l) => setO({ languages: l })} options={[{ value: 'service', label: t('All languages of the service') }, { value: 'primary', label: t('Main language only') }]} /></div>
            </Field>
            <Field label={t('Two languages')}>
              <div><Seg<BulletinOptions['layout']> value={o.layout} onChange={(l) => setO({ layout: l })} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('One after the other') }]} /></div>
            </Field>
          </div>

          <div className="pr-sec">{t('Page layout')}</div>
          <span className="field-hint">{t('The sections in print order. Drag them (or use ↑ ↓) to reorder; add page breaks where a new page should start. Weekly texts are typed in each service’s Bulletin tab.')}</span>
        </fieldset>
        <PageLayoutEditor layout={o.page_layout} onChange={(l) => setO({ page_layout: l })} readOnly={ro} />
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          <OrderOptions o={o} setO={setO} />
        </fieldset>
        </div>
        <div className="pr-side">
          <div className="pr-sec" style={{ marginTop: 0 }}>{t('Live preview')}</div>
          <BulletinSample options={o} />
          <span className="field-hint">{t('Every page of a sample service, drawn by the real bulletin. Your own services print the same way.')}</span>
        </div>
      </div>
    </div>
  );
}

// ================================================================= template editor: the order of service

const HYMN_NUMBER_LABEL: Record<HymnNumberStyle, string> = {
  abbr: 'Hymnal and number: HP 123 · Title',
  number: 'Number only: 123 Title',
  none: 'Title only',
};

/** Banner colours and how the order of service is printed. */
function OrderOptions({ o, setO }: { o: BulletinOptions; setO: (p: Partial<BulletinOptions>) => void }) {
  const { t } = useI18n();
  return (
    <>
      <div className="pr-sec">{t('Order of service')}</div>
      {o.cover === 'banner' && (
        <div className="pr-grid">
          <Field label={t('Banner background')}>
            <span className="pr-colour"><input type="color" value={o.banner.bg} onChange={(e) => setO({ banner: { ...o.banner, bg: e.target.value } })} /><code>{o.banner.bg}</code></span>
          </Field>
          <Field label={t('Banner text')}>
            <span className="pr-colour"><input type="color" value={o.banner.fg} onChange={(e) => setO({ banner: { ...o.banner, fg: e.target.value } })} /><code>{o.banner.fg}</code></span>
          </Field>
        </div>
      )}
      <Field label={t('Layout')} hint={t('A table has three columns: the item, what (hymn, reading, sermon title) and who leads it.')}>
        <div><Seg<BulletinOptions['order_style']> value={o.order_style} onChange={(v) => setO({ order_style: v })} options={[{ value: 'list', label: t('List') }, { value: 'table', label: t('Table with shaded rows') }]} /></div>
      </Field>
      <div className="pr-grid">
        <Field label={t('Hymn numbers')}>
          <select value={o.hymn_number} onChange={(e) => setO({ hymn_number: e.target.value as HymnNumberStyle })}>
            {(Object.keys(HYMN_NUMBER_LABEL) as HymnNumberStyle[]).map((k) => <option key={k} value={k}>{t(HYMN_NUMBER_LABEL[k])}</option>)}
          </select>
        </Field>
      </div>
      <div className="pr-grid">
        <label className="check"><input type="checkbox" checked={o.show_posture} onChange={(e) => setO({ show_posture: e.target.checked })} />{t('Posture (All stand / 众立)')}</label>
        <label className="check"><input type="checkbox" checked={o.sermon_brackets} onChange={(e) => setO({ sermon_brackets: e.target.checked })} />{t('Sermon and creed titles in 【】')}</label>
        <label className="check"><input type="checkbox" checked={o.show_leaders} onChange={(e) => setO({ show_leaders: e.target.checked })} />{t('Names of those leading each item')}</label>
        <label className="check"><input type="checkbox" checked={o.show_times} onChange={(e) => setO({ show_times: e.target.checked })} />{t('Time of each item')}</label>
      </div>
    </>
  );
}
