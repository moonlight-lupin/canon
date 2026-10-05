// Service Planner → Slide templates and Bulletin templates.
// Each page opens on a gallery of templates (pick the church default, make a copy, hide the ones nobody uses) and
// edits one template at a time in a few numbered steps beside a large live preview. Built-in templates can't be
// changed or deleted: they open as a preview with "Make a copy to customise", and can be archived instead. Any
// template can be archived (Archived templates section); administrators delete archived ones that aren't built-in.
// Both previews use the real renderers (SlideFace, the bulletin's BulletinPages) on a small sample service.
import { useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, Loading, PageHead, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { SlideFace } from '../outputs/SlideFace.tsx';
import { SlideThemeCtx, Stage, sigOf } from '../outputs/slide-fit.tsx';
import { buildSlides } from '../outputs/slideModel.ts';
import { DEFAULT_THEME_VARS, type SlideTheme } from '../../shared/slide-theme.ts';
import { GuideLink, HowItWorks, TemplateCard } from './template-ui.tsx';
import '../outputs/outputs.css';
import './presentation.css';
import { ThemeEditor } from './presentation/ThemeEditor.tsx';
import {
  Badges, bgOf, cardActions, compileSafe, GalleryGrid, ImportTemplateButton, useAfterImport, useEditParam,
  useGalleryActions, useSample,
} from './presentation/gallery.tsx';

/** Old /presentation links (and ?tab=…) go to the matching new page. */
export default function Presentation() {
  const q = new URLSearchParams(location.search).get('tab');
  return <Navigate to={q === 'bulletin' ? '/bulletin-templates' : q === 'blocks' ? '/library?tab=blocks' : '/slide-templates'} replace />;
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
                badges={<Badges builtin={!!x.builtin} isDefault={x.id === defaultId} hidden={x.hidden} refCode={x.ref} />}
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
