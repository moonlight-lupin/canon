// Template pages: the gallery of slide or bulletin templates and what its cards can do.
import { useMemo, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.ts';
import { useContentLangs, useI18n } from '../../i18n.tsx';
import { confirmAction, useAction, useSession, useToast } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { DEFAULT_THEME_VARS, compileThemeCss, themeBgUrl, type SlideTheme, type SlideThemeVars } from '../../../shared/slide-theme.ts';
import { sampleLangs, sampleService } from '../presentation-sample.ts';
import { InfoTip, type CardAction } from '../template-ui.tsx';
import '../../outputs/outputs.css';
import '../presentation.css';

export function Badges({ builtin, isDefault, hidden, refCode }: { builtin: boolean; isDefault: boolean; hidden?: boolean; refCode?: string | null }) {
  const { t } = useI18n();
  if (!builtin && !isDefault && !hidden && !refCode) return null;
  return (
    <div className="pr-badges">
      {isDefault && <span className="badge reed" title={t('Services use this template unless they choose another.')}><Icon name="check" width={12} height={12} />{t('Church default')}</span>}
      {builtin && <span className="badge" title={t("Comes with Canon. It can't be changed or deleted, but you can copy it or hide it.")}>{t('Built-in')}</span>}
      {hidden && <span className="badge">{t('Archived')}</span>}
      {refCode && <span className="badge lapis ref-badge" title={t('Reference')}>{refCode}</span>}
    </div>
  );
}

export const sameDraft = <T extends object>(a: T | null, b: T | null, keys: (keyof T)[]) =>
  !!a && !!b && keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));

/** The template being edited, kept in the address (?edit=<id>) so Back and refresh work. */
export function useEditParam(): [number | null, (id: number | null) => void] {
  const [sp, setSp] = useSearchParams();
  const id = Number(sp.get('edit')) || null;
  return [id, (next) => setSp(next ? { edit: String(next) } : {})];
}

/** Gallery actions shared by both pages. */
export function useGalleryActions(kind: 'slide' | 'bulletin', reload: () => Promise<unknown>, reloadSettings: () => void, open: (id: number) => void) {
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
      if (await run(() => api.put(`${base}/${id}/hidden`, { hidden }), hidden ? t('Archived. Find it under Archived templates.') : t('Restored.'))) await reload();
    },
    setRef: async (id: number, current: string | null | undefined) => {
      const v = window.prompt(t('Reference for this template, e.g. EN-001 (leave empty to remove):'), current ?? '');
      if (v === null) return;
      if (await run(() => api.put(`${base}/${id}/ref`, { ref: v.trim() || null }), t('Saved.'))) await reload();
    },
    exportFile: (id: number) => {
      window.location.href = `/api${base}/${id}/export`;
    },
    remove: async (id: number) => {
      if (!confirmAction(t('Delete this archived template for good? Services using it go back to the church default.'))) return false;
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
export function cardActions(
  x: { id: number; builtin?: string | null; hidden?: boolean; ref?: string | null },
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
      ? { label: t('Restore'), onClick: () => a.setHidden(x.id, false) }
      : { label: t('Archive'), onClick: () => a.setHidden(x.id, true), disabled: isDefault, title: isDefault ? t('The church default cannot be archived.') : t('Move it to Archived templates, out of the template lists. Services already using it keep it.') });
  }
  if (can.edit) out.push({ label: x.ref ? t('Change reference…') : t('Set reference…'), onClick: () => a.setRef(x.id, x.ref), title: t('Your own short code for it, e.g. EN-001, so people and AI assistants can name it.') });
  out.push({ label: t('Export to a file'), onClick: () => a.exportFile(x.id), title: t('Save this template as one file, to use on another computer or share with another church.') });
  // deleting: administrators, archived templates only, never Canon's built-in ones
  if (can.admin && x.hidden && !x.builtin) out.push({ label: t('Delete'), onClick: () => a.remove(x.id), danger: true });
  return out;
}

/** "Import a template file…": makes a new template from a file exported by Canon (here or at another church). */
export function ImportTemplateButton({ onImported }: { onImported: (r: { kind: 'slide' | 'bulletin'; id: number; added_blocks: string[] }) => void }) {
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
export function useAfterImport(here: 'slide' | 'bulletin', reload: () => Promise<unknown>, open: (id: number) => void) {
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
export function GalleryGrid<T extends { id: number; hidden?: boolean }>({ items, card, newCard }: { items: T[]; card: (x: T) => ReactNode; newCard?: ReactNode }) {
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
          <summary>{t('Archived templates')} <span className="badge">{hidden.length}</span> <InfoTip text={t('Archived templates are left out of the lists in the service planner; services that already use one keep it. Use the ⋯ menu to restore one; administrators can delete archived templates (not Canon’s built-in ones).')} /></summary>
          <div className="tp-grid">{hidden.map(card)}</div>
        </details>
      )}
    </>
  );
}

// ================================================================= slide templates

export const bgOf = (x: Pick<SlideTheme, 'id' | 'vars'>) => (x.vars.bg_image ? themeBgUrl(x.id, x.vars.bg_image) : null);

/** Compile a theme for the browser; a CSS or font problem falls back to the settings alone (error returned). */
export function compileSafe(scope: string, vars: SlideThemeVars, css: string, bg: string | null): { css: string; error: string | null } {
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

export function useSample() {
  const { settings } = useSession();
  const church = useContentLangs();
  const langs = useMemo(() => sampleLangs(church), [church]);
  const r = useMemo(() => sampleService(langs, settings?.church_name ?? { en: 'Our Church' }, settings?.season_colours !== false), [langs, settings]);
  return { langs, r };
}
