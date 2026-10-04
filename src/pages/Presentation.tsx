// Service Planner → Slide templates and Bulletin templates.
// Each page opens on a gallery of templates (pick the church default, make a copy, hide the ones nobody uses) and
// edits one template at a time in a few numbered steps beside a large live preview. Built-in templates can't be
// changed or deleted: they open as a preview with "Make a copy to customise", and can be hidden instead.
// Both previews use the real renderers (SlideFace, the bulletin's BulletinPages) on a small sample service.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
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
  type FontScript, type HymnNumberStyle, type SlideAspect, type SlideTheme, type SlideThemeVars,
} from '../../shared/presentation.ts';
import { langInfo } from '../../shared/languages.ts';
import { sampleLangs, sampleService } from './presentation-sample.ts';
import { GuideLink, HowItWorks, InfoTip, SaveBar, Step, TemplateCard, TipLabel, useSteps, type CardAction } from './template-ui.tsx';
import type { L10n, Lang, RenderedService } from '../types-client.ts';
import '../outputs/outputs.css';
import './presentation.css';

/** Old /presentation links (and ?tab=…) go to the matching new page. */
export default function Presentation() {
  const q = new URLSearchParams(location.search).get('tab');
  return <Navigate to={q === 'bulletin' ? '/bulletin-templates' : q === 'blocks' ? '/library?tab=blocks' : '/slide-templates'} replace />;
}

function Badges({ builtin, isDefault, hidden }: { builtin: boolean; isDefault: boolean; hidden?: boolean }) {
  const { t } = useI18n();
  if (!builtin && !isDefault && !hidden) return null;
  return (
    <div className="pr-badges">
      {isDefault && <span className="badge reed" title={t('Services use this template unless they choose another.')}><Icon name="check" width={12} height={12} />{t('Church default')}</span>}
      {builtin && <span className="badge" title={t("Comes with Canon. It can't be changed or deleted, but you can copy it or hide it.")}>{t('Built-in')}</span>}
      {hidden && <span className="badge">{t('Hidden')}</span>}
    </div>
  );
}

const sameDraft = <T extends object>(a: T | null, b: T | null, keys: (keyof T)[]) =>
  !!a && !!b && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/** The template being edited, kept in the address (?edit=<id>) so Back and refresh work. */
function useEditParam(): [number | null, (id: number | null) => void] {
  const [sp, setSp] = useSearchParams();
  const id = Number(sp.get('edit')) || null;
  return [id, (next) => setSp(next ? { edit: String(next) } : {})];
}

/** Gallery actions shared by both pages. */
function useGalleryActions(kind: 'slide' | 'bulletin', reload: () => Promise<unknown>, reloadSettings: () => void, open: (id: number) => void) {
  const { t } = useI18n();
  const { run } = useAction();
  const base = kind === 'slide' ? '/slide-themes' : '/bulletin-templates';
  return {
    makeDefault: async (id: number) => {
      if (await run(() => api.put('/presentation/defaults', kind === 'slide' ? { slide_theme_id: id } : { bulletin_template_id: id }), t('This is now the church default.'))) {
        reloadSettings();
        await reload();
      }
    },
    copy: async (id: number) => {
      const x = await run(() => api.post<{ id: number }>(`${base}/${id}/duplicate`), t('Copy made — you can edit it now.'));
      if (x) {
        await reload();
        open(x.id);
      }
    },
    setHidden: async (id: number, hidden: boolean) => {
      if (await run(() => api.put(`${base}/${id}/hidden`, { hidden }), hidden ? t('Hidden. Find it under Hidden templates.') : t('Shown again.'))) await reload();
    },
    exportFile: (id: number) => {
      window.location.href = `/api${base}/${id}/export`;
    },
    remove: async (id: number) => {
      if (!confirmAction(t('Delete this template? Services using it go back to the church default.'))) return false;
      if (await run(() => api.del(`${base}/${id}`), t('Deleted.'))) {
        await reload();
        reloadSettings();
        return true;
      }
      return false;
    },
  };
}

/** The gallery's menu for one template. */
function cardActions(
  x: { id: number; builtin?: string | null; hidden?: boolean },
  isDefault: boolean,
  can: { edit: boolean; admin: boolean },
  a: ReturnType<typeof useGalleryActions>,
  t: (s: string) => string,
): CardAction[] {
  const out: CardAction[] = [];
  if (can.admin && !isDefault) out.push({ label: t('Set as church default'), onClick: () => a.makeDefault(x.id) });
  if (can.edit) out.push({ label: x.builtin ? t('Make a copy to customise') : t('Duplicate'), onClick: () => a.copy(x.id) });
  if (can.edit) {
    out.push(x.hidden
      ? { label: t('Show again'), onClick: () => a.setHidden(x.id, false) }
      : { label: t('Hide'), onClick: () => a.setHidden(x.id, true), disabled: isDefault, title: isDefault ? t('The church default cannot be hidden.') : t('Leave it out of the template lists. Services already using it keep it.') });
  }
  out.push({ label: t('Export to a file'), onClick: () => a.exportFile(x.id), title: t('Save this template as one file, to use on another computer or share with another church.') });
  if (can.edit && !x.builtin) out.push({ label: t('Delete'), onClick: () => a.remove(x.id), danger: true });
  return out;
}

/** "Import a template file…": makes a new template from a file exported by Canon (here or at another church). */
function ImportTemplateButton({ onImported }: { onImported: (r: { kind: 'slide' | 'bulletin'; id: number; added_blocks: string[] }) => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const ref = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (ref.current) ref.current.value = '';
    if (!file) return;
    const body = new File([await file.arrayBuffer()], file.name, { type: 'application/octet-stream' });
    const r = await run(() => api.post<{ kind: 'slide' | 'bulletin'; id: number; added_blocks: string[] }>('/template-files/import', body), t('Template imported.'));
    if (r) onImported(r);
  };
  return (
    <>
      <button type="button" className="btn sm" onClick={() => ref.current?.click()} disabled={busy} title={t('Add a template from a file exported by Canon, on this or another computer.')}>
        <Icon name="upload" />{t('Import a template file…')}
      </button>
      <input ref={ref} type="file" accept=".json,application/json" hidden onChange={(e) => pick(e.target.files?.[0])} />
    </>
  );
}

/** After an import: open the new template (on the other page when the file held the other kind). */
function useAfterImport(here: 'slide' | 'bulletin', reload: () => Promise<unknown>, open: (id: number) => void) {
  const toast = useToast();
  const { t } = useI18n();
  return async (r: { kind: 'slide' | 'bulletin'; id: number; added_blocks: string[] }) => {
    if (r.added_blocks.length) toast(`${t('Added to Library → QR codes & notes')}: ${r.added_blocks.join(', ')}`);
    if (r.kind !== here) {
      window.location.href = `/${r.kind === 'slide' ? 'slide' : 'bulletin'}-templates?edit=${r.id}`;
      return;
    }
    await reload();
    open(r.id);
  };
}

/** Visible templates, then a folded "Hidden templates (n)" group. */
function GalleryGrid<T extends { id: number; hidden?: boolean }>({ items, card, newCard }: { items: T[]; card: (x: T) => ReactNode; newCard?: ReactNode }) {
  const { t } = useI18n();
  const shown = items.filter((x) => !x.hidden);
  const hidden = items.filter((x) => x.hidden);
  return (
    <>
      <div className="tp-grid">
        {shown.map(card)}
        {newCard}
      </div>
      {hidden.length > 0 && (
        <details className="tp-hidden">
          <summary>{t('Hidden templates')} <span className="badge">{hidden.length}</span> <InfoTip text={t('Hidden templates are left out of the lists in the service planner. Services that already use one keep it. Use the ⋯ menu to show one again.')} /></summary>
          <div className="tp-grid">{hidden.map(card)}</div>
        </details>
      )}
    </>
  );
}

// ================================================================= slide templates

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

/** Service Planner → Slide templates: how the slides look on the projector (and in the PowerPoint download). */
export function SlideTemplatesPage() {
  const { t } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data: themes, error, reload } = useApi<SlideTheme[]>('/slide-themes');
  const [editId, setEditId] = useEditParam();
  const { run, busy } = useAction();
  const { langs, r } = useSample();
  const slides = useMemo(() => buildSlides(r, langs), [r, langs]);
  const acts = useGalleryActions('slide', reload, reloadSettings, setEditId);
  const afterImport = useAfterImport('slide', reload, setEditId);

  const legacy = settings?.slide_theme === 'light' ? 'papyrus' : 'ink';
  const defaultId = themes?.find((x) => x.id === settings?.default_slide_theme_id)?.id ?? themes?.find((x) => x.builtin === legacy)?.id ?? null;
  const listCss = useMemo(() => (themes ?? []).map((x) => compileSafe(String(x.id), x.vars, x.css, bgOf(x)).css).join('\n'), [themes]);

  const create = async () => {
    const th = await run(() => api.post<SlideTheme>('/slide-themes', { name: { en: 'New template', zh: '新模板' }, base: 'dark', vars: DEFAULT_THEME_VARS, css: '' }));
    if (th) {
      await reload();
      setEditId(th.id);
    }
  };

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!themes) return <div className="page"><Loading /></div>;
  const editing = editId ? themes.find((x) => x.id === editId) : null;

  return (
    <div className="page">
      <style>{listCss}</style>
      {editing ? (
        <ThemeEditor key={editing.id} theme={editing} isDefault={editing.id === defaultId} langs={langs} r={r} onBack={() => setEditId(null)} acts={acts} onSaved={reload} />
      ) : (
        <>
          <PageHead eyebrow={t('Service Planner')} title={t('Slide templates')} sub={t('How the slides look on the projector and in the PowerPoint download: colours, background, fonts, text size and screen shape.')}>
            <GuideLink anchor="slide-templates" />
            {canEdit && <ImportTemplateButton onImported={afterImport} />}
          </PageHead>
          <HowItWorks steps={[
            t('Pick the template most services should use and choose Set as church default (in the ⋯ menu).'),
            t('To change a built-in template, make a copy and edit the copy.'),
            t('A service can use another template: choose it in the service’s details, or switch for one session on the slides.'),
          ]} />
          <GalleryGrid
            items={themes}
            card={(x) => (
              <TemplateCard
                key={x.id}
                muted={x.hidden}
                thumb={(
                  <SlideThemeCtx.Provider value={{ id: String(x.id), sig: sigOf(x.updated_at + x.css), aspect: x.vars.aspect }}>
                    <Stage><SlideFace s={slides[0]} langs={langs} split={false} r={r} num={1} /></Stage>
                  </SlideThemeCtx.Provider>
                )}
                name={<Bi v={x.name} />}
                desc={x.vars.aspect === '4:3' ? t('4:3 screen') : undefined}
                badges={<Badges builtin={!!x.builtin} isDefault={x.id === defaultId} hidden={x.hidden} />}
                primary={x.builtin || !canEdit ? { label: t('Preview'), onClick: () => setEditId(x.id), icon: 'eye' } : { label: t('Edit'), onClick: () => setEditId(x.id), icon: 'edit' }}
                actions={cardActions(x, x.id === defaultId, { edit: canEdit, admin: isAdmin }, acts, t)}
              />
            )}
            newCard={canEdit && (
              <button type="button" className="tp-card tp-new" onClick={create} disabled={busy}>
                <Icon name="plus" />
                <span>{t('New template')}</span>
                <span className="tp-card-desc">{t('Starts from the dark Ink look')}</span>
              </button>
            )}
          />
        </>
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

/** Font scripts the church's languages need (Latin always; Chinese / other scripts only when used). */
function scriptsFor(langs: Lang[]): FontScript[] {
  const need = new Set<FontScript>(['latin']);
  for (const l of langs) {
    const f = langInfo(l).font;
    need.add(f === 'latin' ? 'latin' : f === 'sc' ? 'sc' : f === 'tc' ? 'tc' : 'other');
  }
  // Simplified and Traditional convert into each other, so a church with one may show the other
  if (need.has('sc') || need.has('tc')) {
    need.add('sc');
    need.add('tc');
  }
  return (['latin', 'sc', 'tc', 'other'] as FontScript[]).filter((s) => need.has(s));
}
const FONT_LABEL: Record<FontScript, string> = {
  latin: 'English and other Latin-script text',
  sc: 'Simplified Chinese',
  tc: 'Traditional Chinese',
  other: 'Other scripts (Tamil, Korean, Japanese)',
};

function ThemeEditor({ theme, isDefault, langs, r, onBack, acts, onSaved }: {
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

  const back = () => {
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
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
  const scripts = scriptsFor(church);

  // one-line summaries for folded steps
  const sum = {
    look: `${draft.base === 'light' ? t('Light background') : t('Dark background')}${bg ? ` · ${t('with picture')}` : ''}`,
    text: `${fontName('latin')} · ${Math.round(v.scale * 100)}% · ${v.align === 'left' ? t('Left') : t('Centred')}`,
    lines: `${t('{n} lines (two or more languages)').replace('{n}', String(v.max_lines_multi))} · ${t('{n} lines (one language)').replace('{n}', String(v.max_lines_single))}${v.uniform_size ? ` · ${t('same size')}` : ''}`,
    screen: [v.aspect === '4:3' ? '4:3' : '16:9', v.footer_reference && t('reference'), v.footer_church && t('church name'), v.footer_number && t('slide number')].filter(Boolean).join(' · '),
    css: draft.css.trim() ? t('Custom CSS in use') : t('None'),
  };

  const head = (
    <div className="tp-edit-head">
      <button type="button" className="btn sm ghost" onClick={back}><Icon name="chevronLeft" />{t('All slide templates')}</button>
      <h1><Bi v={draft.name} /></h1>
      <Badges builtin={!!theme.builtin} isDefault={isDefault} hidden={theme.hidden} />
      <div className="grow" />
      <GuideLink anchor="slide-templates" />
      {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : t('Services use this template unless they choose another.')} onClick={() => acts.makeDefault(theme.id)}><Icon name="check" />{t('Set as church default')}</button>}
      {canEdit && !theme.builtin && <button className="btn sm" disabled={busy} onClick={() => { if (!dirty || confirmAction(t('Discard your unsaved changes?'))) acts.copy(theme.id); }}><Icon name="copy" />{t('Duplicate')}</button>}
      {canEdit && !theme.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={async () => { if (await acts.remove(theme.id)) onBack(); }}><Icon name="trash" />{t('Delete')}</button>}
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
            <div className="pr-grid">
              {scripts.map((s) => <FontField key={s} script={s} label={FONT_LABEL[s]} value={v[`font_${s}`]} onChange={(f) => setV({ [`font_${s}`]: f } as Partial<SlideThemeVars>)} />)}
            </div>
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
const CHOICE_SHORT: Record<string, string> = { full: 'words', first_stanza: 'first verse', title: 'title', reference: 'reference' };

/** Service Planner → Bulletin templates: what the printed bulletin includes and how it is laid out. */
export function BulletinTemplatesPage() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data: list, error, reload } = useApi<BulletinTemplate[]>('/bulletin-templates');
  const [editId, setEditId] = useEditParam();
  const { run, busy } = useAction();
  const acts = useGalleryActions('bulletin', reload, reloadSettings, setEditId);
  const afterImport = useAfterImport('bulletin', reload, setEditId);
  // old links to the QR codes tab go to the Library
  if (new URLSearchParams(location.search).get('tab') === 'blocks') return <Navigate to="/library?tab=blocks" replace />;

  const defaultId = list?.find((x) => x.id === settings?.default_bulletin_template_id)?.id ?? list?.find((x) => x.builtin === 'full')?.id ?? null;
  const create = async () => {
    const x = await run(() => api.post<BulletinTemplate>('/bulletin-templates', { name: { en: 'New template', zh: '新模板' }, description: {} }));
    if (x) {
      await reload();
      setEditId(x.id);
    }
  };

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!list) return <div className="page"><Loading /></div>;
  const editing = editId ? list.find((x) => x.id === editId) : null;
  if (editing) {
    return (
      <div className="page">
        <TemplateEditor key={editing.id} tpl={editing} isDefault={editing.id === defaultId} onBack={() => setEditId(null)} acts={acts} onSaved={reload} />
      </div>
    );
  }

  const facts = (o: BulletinOptions) => [
    t(PAPERS[o.paper].label),
    `${t('Hymns')}: ${t(CHOICE_SHORT[o.print.song])}`,
    `${t('Readings')}: ${t(CHOICE_SHORT[o.print.scripture])}`,
  ];
  return (
    <div className="page">
      <PageHead eyebrow={t('Service Planner')} title={t('Bulletin templates')} sub={t('What each printed bulletin includes: paper, cover, which items print in full, and the order of its pages.')}>
        <GuideLink anchor="bulletin-templates" />
        {canEdit && <ImportTemplateButton onImported={afterImport} />}
      </PageHead>
      <HowItWorks steps={[
        t('Pick the template most services should use and choose Set as church default (in the ⋯ menu).'),
        t('To change a built-in template, make a copy and edit the copy.'),
        t('Each week, type the announcements in the service’s Bulletin tab, then print from Outputs → Bulletin.'),
      ]} />
      <p className="small muted" style={{ margin: '-4px 0 14px' }}>
        <Icon name="qr" width={14} height={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('QR codes and notes are kept in Library → QR codes & notes and can be used on bulletins and slides.')}{' '}
        <Link to="/library?tab=blocks">{t('Open')} →</Link>
      </p>
      <GalleryGrid
        items={list}
        card={(x) => (
          <TemplateCard
            key={x.id}
            muted={x.hidden}
            thumb={<BulletinThumb o={x.options} />}
            name={<Bi v={x.name} />}
            desc={lt(x.description) || facts(x.options).join(' · ')}
            badges={<Badges builtin={!!x.builtin} isDefault={x.id === defaultId} hidden={x.hidden} />}
            primary={x.builtin || !canEdit ? { label: t('Preview'), onClick: () => setEditId(x.id), icon: 'eye' } : { label: t('Edit'), onClick: () => setEditId(x.id), icon: 'edit' }}
            actions={cardActions(x, x.id === defaultId, { edit: canEdit, admin: isAdmin }, acts, t)}
          />
        )}
        newCard={canEdit && (
          <button type="button" className="tp-card tp-new" onClick={create} disabled={busy}>
            <Icon name="plus" />
            <span>{t('New template')}</span>
            <span className="tp-card-desc">{t('Starts from the full-words booklet')}</span>
          </button>
        )}
      />
    </div>
  );
}

/** A small drawing of a bulletin's paper and how much it prints (no rendering, so the gallery stays fast). */
function BulletinThumb({ o }: { o: BulletinOptions }) {
  const { t } = useI18n();
  const p = PAPERS[o.paper];
  const lines = o.print.song === 'full' ? 7 : o.print.song === 'first_stanza' ? 5 : 3;
  return (
    <div className="tp-bthumb" aria-hidden="true">
      <div className="tp-bthumb-page">
        {o.cover === 'banner' ? <div className="tp-bthumb-banner" style={{ background: o.banner.bg }} /> : <div className="tp-bthumb-cross">✝</div>}
        {Array.from({ length: lines }, (_, i) => <div key={i} className="tp-bthumb-line" style={{ width: `${55 + ((i * 17) % 40)}%` }} />)}
      </div>
      <span className="tp-bthumb-paper">{t(p.label)}</span>
    </div>
  );
}

function TemplateEditor({ tpl, isDefault, onBack, acts, onSaved }: {
  tpl: BulletinTemplate;
  isDefault: boolean;
  onBack: () => void;
  acts: ReturnType<typeof useGalleryActions>;
  onSaved: () => Promise<unknown>;
}) {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin } = useSession();
  const { run, busy } = useAction();
  const steps = useSteps(1);
  const [draft, setDraft] = useState<BulletinTemplate>(() => structuredClone(tpl));
  const ro = !canEdit || !!tpl.builtin;
  const dirty = !ro && !sameDraft(draft, tpl, ['name', 'description', 'options']);
  const o = draft.options;
  const setO = (p: Partial<BulletinOptions>) => setDraft((d) => ({ ...d, options: { ...d.options, ...p } }));
  const setPrint = (k: PrintKey, v: string) => setO({ print: { ...o.print, [k]: v } });

  const back = () => {
    if (dirty && !confirmAction(t('Discard your unsaved changes?'))) return;
    onBack();
  };
  const save = async () => {
    const x = await run(() => api.patch<BulletinTemplate>(`/bulletin-templates/${draft.id}`, { name: draft.name, description: draft.description, options: draft.options }), t('Saved.'));
    if (x) {
      setDraft(structuredClone(x));
      await onSaved();
    }
  };

  const sum = {
    paper: `${t(PAPERS[o.paper].label)} · ${o.font_pt ? `${o.font_pt}pt` : t('Automatic')} · ${o.languages === 'primary' ? t('Main language only') : o.layout === 'stacked' ? t('One after the other') : t('Side by side')}`,
    print: PRINT_ROWS.map((r) => `${t(r.label)}: ${t(CHOICE_SHORT[o.print[r.key]])}`).join(' · '),
    order: `${o.cover === 'default' ? t('Cover as chosen for the service') : t(COVER_LABEL[o.cover])} · ${o.order_style === 'table' ? t('Table') : t('List')}`,
    layout: t('{n} sections').replace('{n}', String(o.page_layout.length)),
  };

  const head = (
    <div className="tp-edit-head">
      <button type="button" className="btn sm ghost" onClick={back}><Icon name="chevronLeft" />{t('All bulletin templates')}</button>
      <h1><Bi v={draft.name} /></h1>
      <Badges builtin={!!tpl.builtin} isDefault={isDefault} hidden={tpl.hidden} />
      <div className="grow" />
      <GuideLink anchor="bulletin-templates" />
      {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : t('Services use this template unless they choose another.')} onClick={() => acts.makeDefault(tpl.id)}><Icon name="check" />{t('Set as church default')}</button>}
      {canEdit && !tpl.builtin && <button className="btn sm" disabled={busy} onClick={() => { if (!dirty || confirmAction(t('Discard your unsaved changes?'))) acts.copy(tpl.id); }}><Icon name="copy" />{t('Duplicate')}</button>}
      {canEdit && !tpl.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={async () => { if (await acts.remove(tpl.id)) onBack(); }}><Icon name="trash" />{t('Delete')}</button>}
    </div>
  );
  const previewPane = (
    <div className="tp-preview">
      <BulletinSample options={o} />
      <span className="field-hint">{t('Every page of a sample service, drawn by the real bulletin. Your own services print the same way.')}</span>
    </div>
  );

  if (ro) {
    return (
      <>
        {head}
        <div className="tp-editor">
          <div className="stack">
            <div className="callout">
              {tpl.builtin ? t('Built-in templates come with Canon and can’t be changed. Make a copy to change what prints or the page layout.') : t('You can look at this template, but only editors can change it.')}
            </div>
            {canEdit && tpl.builtin && <div><button className="btn primary" onClick={() => acts.copy(tpl.id)} disabled={busy}><Icon name="copy" />{t('Make a copy to customise')}</button></div>}
            {lt(tpl.description) && <p style={{ margin: 0 }}>{lt(tpl.description)}</p>}
            <dl className="tp-facts">
              <dt>{t('Paper and languages')}</dt><dd>{sum.paper}</dd>
              <dt>{t('What to print')}</dt><dd>{sum.print}</dd>
              <dt>{t('Cover and order of service')}</dt><dd>{sum.order}</dd>
              <dt>{t('Page layout')}</dt><dd>{sum.layout}</dd>
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
          <div className="pr-grid">
            <Field label={t('Template name')}><L10nInput value={draft.name} onChange={(n) => setDraft((d) => ({ ...d, name: n }))} /></Field>
            <Field label={<TipLabel label={t('Description')} tip={t('A short note shown in the template list, e.g. “Lord’s Supper Sundays”.')} />}><L10nInput value={draft.description} onChange={(n) => setDraft((d) => ({ ...d, description: n }))} /></Field>
          </div>

          <Step n={1} title={t('Paper and languages')} summary={sum.paper} open={steps.isOpen(1)} onToggle={() => steps.toggle(1)}>
            <div className="pr-grid">
              <Field label={<TipLabel label={t('Paper')} tip={t('A4 landscape, folded, makes an A5 booklet: print double-sided, flip on the short edge, then fold.')} />}>
                <select value={o.paper} onChange={(e) => setO({ paper: e.target.value as BulletinOptions['paper'] })}>
                  {PAPER_ORDER.map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
                </select>
              </Field>
              <Field label={<TipLabel label={t('Font size')} tip={t('Automatic picks a size that suits the paper. Choose a smaller size if pages overflow.')} />}>
                <select value={o.font_pt ?? ''} onChange={(e) => setO({ font_pt: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t('Automatic')} ({PAPERS[o.paper].font}pt)</option>
                  {[8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14, 15, 16].map((n) => <option key={n} value={n}>{n}pt</option>)}
                </select>
              </Field>
            </div>
            <div className="pr-grid">
              <Field label={t('Languages')}>
                <div><Seg<BulletinOptions['languages']> value={o.languages} onChange={(l) => setO({ languages: l })} options={[{ value: 'service', label: t('All languages of the service') }, { value: 'primary', label: t('Main language only') }]} /></div>
              </Field>
              <Field label={<TipLabel label={t('Two languages')} tip={t('Side by side keeps each line next to its translation; one after the other suits narrow paper.')} />}>
                <div><Seg<BulletinOptions['layout']> value={o.layout} onChange={(l) => setO({ layout: l })} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('One after the other') }]} /></div>
              </Field>
            </div>
          </Step>

          <Step n={2} title={t('What to print')} summary={sum.print} open={steps.isOpen(2)} onToggle={() => steps.toggle(2)}>
            <div className="table-wrap">
              <table className="t pr-print">
                <thead>
                  <tr><th />{PRINT_COLUMNS.map((c) => <th key={c.value}>{t(c.label)}</th>)}</tr>
                </thead>
                <tbody>
                  {PRINT_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td><div style={{ fontWeight: 600 }}>{t(row.label)} <InfoTip text={t(row.hint)} /></div></td>
                      {PRINT_COLUMNS.map((c) => {
                        const choice = row.choices.find((x) => colOf(x.value) === c.value);
                        if (!choice) return <td key={c.value} className="na">—</td>;
                        return (
                          <td key={c.value}>
                            <input type="radio" name={`print-${row.key}`} aria-label={`${t(row.label)}: ${t(choice.label)}`} checked={o.print[row.key] === choice.value} onChange={() => setPrint(row.key, choice.value)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="field-hint">{t('In the service planner each item can still be set to “Full text” or “Title only”, whatever the template says.')}</span>
          </Step>

          <Step n={3} title={t('Cover and order of service')} summary={sum.order} open={steps.isOpen(3)} onToggle={() => steps.toggle(3)}>
            <Field label={<TipLabel label={t('Cover')} tip={t('“As chosen for the service” follows the cover picked in each service, else the church default in Settings → Church.')} />}>
              <select value={o.cover} onChange={(e) => setO({ cover: e.target.value as BulletinOptions['cover'] })}>
                <option value="default">{t('As chosen for the service, else the church default')}</option>
                {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
                <option value="banner">{t(COVER_LABEL.banner)}</option>
              </select>
            </Field>
            <OrderOptions o={o} setO={setO} />
          </Step>

          <Step n={4} title={t('Page layout')} summary={sum.layout} open={steps.isOpen(4)} onToggle={() => steps.toggle(4)}>
            <span className="field-hint">{t('The sections in print order. Drag them (or use ↑ ↓) to reorder; add page breaks where a new page should start. Weekly texts are typed in each service’s Bulletin tab.')}</span>
            <PageLayoutEditor layout={o.page_layout} onChange={(l) => setO({ page_layout: l })} readOnly={false} />
          </Step>
        </div>
        {previewPane}
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => setDraft(structuredClone(tpl))} />
    </>
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
      <div className="pr-grid">
        <Field label={<TipLabel label={t('Order of service layout')} tip={t('A table has three columns: the item, what (hymn, reading, sermon title) and who leads it.')} />}>
          <div><Seg<BulletinOptions['order_style']> value={o.order_style} onChange={(v) => setO({ order_style: v })} options={[{ value: 'list', label: t('List') }, { value: 'table', label: t('Table with shaded rows') }]} /></div>
        </Field>
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
